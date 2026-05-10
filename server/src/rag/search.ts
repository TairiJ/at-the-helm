import { getDb } from '../db/database.js';
import { generateEmbedding } from '../services/llm-router.js';
import { ragAccessFilter } from '../middleware/rbac.js';

export interface SearchResult {
  chunkId: string;
  documentId: string;
  content: string;
  filename: string;
  score: number;
  source: 'vector' | 'fts' | 'hybrid';
}

/**
 * Hybrid search combining vector similarity and FTS5 keyword search.
 * Uses Reciprocal Rank Fusion to merge results.
 */
export async function hybridSearch(
  query: string,
  userId: string,
  role: 'anonymous' | 'user' | 'admin',
  topK: number = 5
): Promise<SearchResult[]> {
  const [vectorResults, ftsResults] = await Promise.all([
    vectorSearch(query, userId, role, topK * 2),
    ftsSearch(query, userId, role, topK * 2),
  ]);

  return reciprocalRankFusion(vectorResults, ftsResults, topK);
}

/**
 * Semantic vector search using sqlite-vec.
 */
async function vectorSearch(
  query: string,
  userId: string,
  role: 'anonymous' | 'user' | 'admin',
  topK: number
): Promise<SearchResult[]> {
  const db = getDb();

  try {
    // Check if we have any embeddings first
    const count = db.prepare('SELECT COUNT(*) as cnt FROM chunks').get() as any;
    if (!count || count.cnt === 0) return [];

    const queryEmbedding = await generateEmbedding(query);
    const embeddingBuffer = Buffer.from(new Float32Array(queryEmbedding).buffer);
    const access = ragAccessFilter(role, userId);

    // sqlite-vec KNN query: pass embedding as the first parameter to vec0 match
    const results = db.prepare(`
      SELECT
        ce.chunk_id,
        ce.distance,
        c.content,
        c.document_id,
        d.filename
      FROM chunk_embeddings ce
      JOIN chunks c ON c.id = ce.chunk_id
      JOIN documents d ON d.id = c.document_id
      WHERE ce.embedding MATCH ?
      AND k = ?
      AND ${access.clause}
    `).all(embeddingBuffer, topK, ...access.params) as any[];

    return results.map((r: any) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      content: r.content,
      filename: r.filename,
      score: 1 / (1 + r.distance),
      source: 'vector' as const,
    }));
  } catch (error) {
    console.error('Vector search error:', error);
    return [];
  }
}

/**
 * Full-text keyword search using FTS5.
 */
async function ftsSearch(
  query: string,
  userId: string,
  role: 'anonymous' | 'user' | 'admin',
  topK: number
): Promise<SearchResult[]> {
  const db = getDb();

  try {
    // Clean query for FTS5 syntax
    const ftsQuery = query
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
      .map(w => `"${w}"`)
      .join(' OR ');

    if (!ftsQuery) return [];

    const access = ragAccessFilter(role, userId);

    const results = db.prepare(`
      SELECT
        f.chunk_id,
        f.document_id,
        f.content,
        d.filename,
        bm25(chunks_fts) as rank
      FROM chunks_fts f
      JOIN documents d ON d.id = f.document_id
      WHERE chunks_fts MATCH ?
      AND ${access.clause}
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, ...access.params, topK) as any[];

    return results.map((r: any, i: number) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      content: r.content,
      filename: r.filename,
      score: 1 / (1 + Math.abs(r.rank)), // Normalize BM25 score
      source: 'fts' as const,
    }));
  } catch (error) {
    console.error('FTS search error:', error);
    return [];
  }
}

/**
 * Reciprocal Rank Fusion — merges results from multiple search strategies.
 * Higher k favors agreement between systems over any single system's ranking.
 */
function reciprocalRankFusion(
  vectorResults: SearchResult[],
  ftsResults: SearchResult[],
  topK: number,
  k: number = 60
): SearchResult[] {
  const scores = new Map<string, { score: number; result: SearchResult }>();

  // Score vector results
  vectorResults.forEach((r, rank) => {
    const rrf = 1 / (k + rank + 1);
    const existing = scores.get(r.chunkId);
    if (existing) {
      existing.score += rrf;
      existing.result.source = 'hybrid';
    } else {
      scores.set(r.chunkId, { score: rrf, result: { ...r, source: 'vector' } });
    }
  });

  // Score FTS results
  ftsResults.forEach((r, rank) => {
    const rrf = 1 / (k + rank + 1);
    const existing = scores.get(r.chunkId);
    if (existing) {
      existing.score += rrf;
      existing.result.source = 'hybrid';
    } else {
      scores.set(r.chunkId, { score: rrf, result: { ...r, source: 'fts' } });
    }
  });

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ score, result }) => ({ ...result, score }));
}
