import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/database.js';
import { AuthRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { chunkText, extractText } from '../rag/chunker.js';
import { hybridSearch } from '../rag/search.js';
import { generateEmbedding } from '../services/llm-router.js';
import { logAudit } from '../middleware/governance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(__dirname, '../../../data/uploads');

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB for books
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'text/plain', 'text/markdown', 'text/csv',
      'application/pdf', 'application/json',
      'application/epub+zip', 'application/epub',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(txt|md|pdf|csv|json|epub|docx)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Supported: .txt, .md, .pdf, .csv, .json, .epub, .docx'));
    }
  },
});

const router = Router();

// POST /api/rag/ingest — upload and process a document
router.post('/ingest', requireRole('user', 'admin'), upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  const file = req.file;
  const userId = req.user?.id || '';
  const { isPublic, isVault, tags } = req.body;

  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const startTime = Date.now();

  try {
    // Read file
    const fs = await import('fs/promises');
    const buffer = await fs.readFile(file.path);

    // Extract text
    const text = await extractText(buffer, file.mimetype, file.originalname);

    if (!text.trim()) {
      res.status(400).json({ error: 'Could not extract text from file' });
      return;
    }

    // Chunk text
    const chunks = chunkText(text, file.originalname);

    const db = getDb();
    const docId = uuid();

    // Insert document
    db.prepare(`
      INSERT INTO documents (id, user_id, filename, mime_type, content, is_public, is_vault, tags, chunk_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      docId, userId, file.originalname, file.mimetype, text,
      isPublic === 'true' || isPublic === true ? 1 : 0,
      isVault === 'true' || isVault === true ? 1 : 0,
      tags || '[]',
      chunks.length
    );

    // Process chunks — embed and store
    const insertChunk = db.prepare(`
      INSERT INTO chunks (id, document_id, content, chunk_index, token_count)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertFts = db.prepare(`
      INSERT INTO chunks_fts (content, chunk_id, document_id) VALUES (?, ?, ?)
    `);

    const insertVec = db.prepare(`
      INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)
    `);

    let processedChunks = 0;

    for (const chunk of chunks) {
      const chunkId = uuid();

      // Store chunk
      insertChunk.run(chunkId, docId, chunk.content, chunk.index, chunk.tokenEstimate);

      // Store in FTS5
      insertFts.run(chunk.content, chunkId, docId);

      // Generate and store embedding
      try {
        const embedding = await generateEmbedding(chunk.content);
        const embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);
        insertVec.run(chunkId, embeddingBuffer);
      } catch (err) {
        console.error(`Failed to embed chunk ${chunk.index}:`, err);
      }

      processedChunks++;
    }

    // Clean up uploaded file
    await fs.unlink(file.path).catch(() => {});

    const latencyMs = Date.now() - startTime;

    logAudit({
      userId,
      action: 'ingest',
      inputPreview: file.originalname,
      latencyMs,
      ragChunksUsed: processedChunks,
      status: 'success',
      metadata: { documentId: docId, chunkCount: processedChunks },
    });

    res.json({
      success: true,
      document: {
        id: docId,
        filename: file.originalname,
        chunkCount: processedChunks,
        processingTimeMs: latencyMs,
      },
    });
  } catch (error: any) {
    console.error('Ingest error:', error);
    res.status(500).json({ error: `Ingest failed: ${error.message}` });
  }
});

// GET /api/rag/documents — list documents
router.get('/documents', (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const role = req.user?.role || 'anonymous';
  const userId = req.user?.id || '';

  let query = `
    SELECT 
      d.id, d.filename, d.mime_type, d.is_public, d.is_vault, d.tags, d.created_at,
      (SELECT COUNT(*) FROM chunks WHERE document_id = d.id) as chunk_count
    FROM documents d
  `;
  let params: any[] = [];

  if (role === 'admin') {
    query += ' ORDER BY created_at DESC';
  } else if (role === 'user') {
    query += ' WHERE d.is_public = 1 OR d.user_id = ? ORDER BY created_at DESC';
    params = [userId];
  } else {
    query += ' WHERE d.is_public = 1 ORDER BY created_at DESC';
  }

  const documents = db.prepare(query).all(...params);
  res.json({ documents });
});

// GET /api/rag/documents/:id/preview — get document with chunk previews
router.get('/documents/:id/preview', (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const { id } = req.params;

  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  const chunks = db.prepare(
    'SELECT id, content, chunk_index, token_count FROM chunks WHERE document_id = ? ORDER BY chunk_index ASC'
  ).all(id);

  res.json({ document: doc, chunks });
});

// DELETE /api/rag/documents/:id
router.delete('/documents/:id', requireRole('user', 'admin'), (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const { id } = req.params;
  const userId = req.user?.id;
  const role = req.user?.role;

  // Check ownership
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as any;
  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  if (role !== 'admin' && doc.user_id !== userId) {
    res.status(403).json({ error: 'Not authorized to delete this document' });
    return;
  }

  // Delete embeddings, FTS entries, chunks, then document
  const chunkIds = db.prepare('SELECT id FROM chunks WHERE document_id = ?').all(id) as any[];
  for (const chunk of chunkIds) {
    db.prepare('DELETE FROM chunk_embeddings WHERE chunk_id = ?').run(chunk.id);
    db.prepare("DELETE FROM chunks_fts WHERE chunk_id = ?").run(chunk.id);
  }
  db.prepare('DELETE FROM chunks WHERE document_id = ?').run(id);
  db.prepare('DELETE FROM documents WHERE id = ?').run(id);

  logAudit({ userId, action: 'delete_document', inputPreview: doc.filename, status: 'success' });

  res.json({ success: true });
});

// PATCH /api/rag/documents/:id/tags — update tags and is_vault status
router.patch('/documents/:id/tags', requireRole('user', 'admin'), (req: AuthRequest, res: Response): void => {
  const { id } = req.params;
  const { tags, isVault } = req.body;
  const userId = req.user?.id || '';
  const role = req.user?.role || 'anonymous';

  const db = getDb();
  const doc = db.prepare('SELECT user_id, filename FROM documents WHERE id = ?').get(id) as any;

  if (!doc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  if (role !== 'admin' && doc.user_id !== userId) {
    res.status(403).json({ error: 'Not authorized to update this document' });
    return;
  }

  if (tags !== undefined) {
    db.prepare('UPDATE documents SET tags = ? WHERE id = ?').run(JSON.stringify(tags || []), id);
  }
  if (isVault !== undefined) {
    db.prepare('UPDATE documents SET is_vault = ? WHERE id = ?').run(isVault ? 1 : 0, id);
  }

  logAudit({ userId, action: 'update_tags', inputPreview: doc.filename, status: 'success' });

  res.json({ success: true });
});

// POST /api/rag/search — manual search endpoint
router.post('/search', async (req: AuthRequest, res: Response): Promise<void> => {
  const { query, topK } = req.body;
  const userId = req.user?.id || '';
  const role = req.user?.role || 'anonymous';

  if (!query) {
    res.status(400).json({ error: 'Query is required' });
    return;
  }

  const results = await hybridSearch(query, userId, role as any, topK || 5);

  logAudit({
    userId,
    action: 'rag_query',
    inputPreview: query,
    ragChunksUsed: results.length,
    status: 'success',
  });

  res.json({ results });
});

// POST /api/rag/ingest-url — fetch and process a URL
router.post('/ingest-url', requireRole('user', 'admin'), async (req: AuthRequest, res: Response): Promise<void> => {
  const { url, isPublic, isVault } = req.body;
  const userId = req.user?.id || '';

  if (!url) {
    res.status(400).json({ error: 'URL is required' });
    return;
  }

  const startTime = Date.now();

  try {
    // Fetch the URL
    const response = await fetch(url, {
      headers: { 'User-Agent': 'AtTheHelm/1.0 KnowledgeBot' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      res.status(400).json({ error: `Failed to fetch URL: ${response.status} ${response.statusText}` });
      return;
    }

    const html = await response.text();

    // Strip HTML tags to get text content
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!text || text.length < 50) {
      res.status(400).json({ error: 'Could not extract meaningful text from URL' });
      return;
    }

    // Extract title from HTML
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;
    const filename = `${pageTitle.slice(0, 60)} (${new URL(url).hostname})`;

    // Chunk text
    const chunks = chunkText(text, filename);

    const db = getDb();
    const docId = uuid();

    // Insert document
    db.prepare(`
      INSERT INTO documents (id, user_id, filename, mime_type, content, is_public, is_vault, tags, chunk_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      docId, userId, filename, 'text/html', text,
      isPublic ? 1 : 0,
      isVault ? 1 : 0,
      JSON.stringify([url]),
      chunks.length
    );

    // Process chunks
    const insertChunk = db.prepare(`
      INSERT INTO chunks (id, document_id, content, chunk_index, token_count)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare(`
      INSERT INTO chunks_fts (content, chunk_id, document_id) VALUES (?, ?, ?)
    `);
    const insertVec = db.prepare(`
      INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)
    `);

    let processedChunks = 0;
    for (const chunk of chunks) {
      const chunkId = uuid();
      insertChunk.run(chunkId, docId, chunk.content, chunk.index, chunk.tokenEstimate);
      insertFts.run(chunk.content, chunkId, docId);

      try {
        const embedding = await generateEmbedding(chunk.content);
        const embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);
        insertVec.run(chunkId, embeddingBuffer);
      } catch (err) {
        console.error(`Failed to embed URL chunk ${chunk.index}:`, err);
      }
      processedChunks++;
    }

    const latencyMs = Date.now() - startTime;

    logAudit({
      userId,
      action: 'ingest',
      inputPreview: url,
      latencyMs,
      ragChunksUsed: processedChunks,
      status: 'success',
      metadata: { documentId: docId, chunkCount: processedChunks, source: 'url' },
    });

    res.json({
      success: true,
      document: {
        id: docId,
        filename,
        url,
        chunkCount: processedChunks,
        processingTimeMs: latencyMs,
      },
    });
  } catch (error: any) {
    console.error('URL ingest error:', error);
    res.status(500).json({ error: `URL ingest failed: ${error.message}` });
  }
});

export default router;
