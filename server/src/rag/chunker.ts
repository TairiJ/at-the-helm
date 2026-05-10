/**
 * Document chunker — splits text into overlapping chunks for RAG embedding.
 */

export interface Chunk {
  content: string;
  index: number;
  tokenEstimate: number;
}

const CHUNK_SIZE = 300;      // reduced for more granular chunks
const CHUNK_OVERLAP = 40;    // overlap tokens between chunks
const CHARS_PER_TOKEN = 4;   // rough estimate

/**
 * Split text into chunks with overlap.
 */
export function chunkText(text: string, contextPrefix?: string): Chunk[] {
  const chunks: Chunk[] = [];
  const charChunkSize = CHUNK_SIZE * CHARS_PER_TOKEN;
  const charOverlap = CHUNK_OVERLAP * CHARS_PER_TOKEN;

  // Clean the text
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();



  // Try to split on paragraph/section boundaries AND list items (including bolded ones like **1.)
  const segments = cleaned.split(/\n\n+|\n(?=\s*(?:\*\*|[\d*•-])\s*[\d.]*)/);
  let currentChunk = '';
  let chunkIndex = 0;

  for (const segment of segments) {
    const trimmed = segment.trim();
    // Match 1. or **1. or * or - or •
    const isNewListItem = /^(\*\*)?[\d*•-]+\.?\s/.test(trimmed);
    const shouldSplit = (currentChunk.length + segment.length > charChunkSize) || (isNewListItem && currentChunk.length > 30);

    if (shouldSplit && currentChunk.length > 0) {
      // Save current chunk
      const content = contextPrefix
        ? `${contextPrefix}\n\n${currentChunk.trim()}`
        : currentChunk.trim();

      chunks.push({
        content,
        index: chunkIndex++,
        tokenEstimate: Math.ceil(content.length / CHARS_PER_TOKEN),
      });

      // Start new chunk. We reduce overlap for list items to keep them distinct.
      const overlap = isNewListItem ? '' : currentChunk.slice(-charOverlap);
      currentChunk = (overlap ? overlap + '\n\n' : '') + segment;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + segment;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim()) {
    const content = contextPrefix
      ? `${contextPrefix}\n\n${currentChunk.trim()}`
      : currentChunk.trim();

    chunks.push({
      content,
      index: chunkIndex,
      tokenEstimate: Math.ceil(content.length / CHARS_PER_TOKEN),
    });
  }

  return chunks;
}

/**
 * Extract text from raw file content based on MIME type.
 */
export async function extractText(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  const ext = filename.split('.').pop()?.toLowerCase();

  if (mimeType === 'application/pdf' || ext === 'pdf') {
    const pdfParse = (await import('pdf-parse')).default;
    const result = await pdfParse(buffer);
    return result.text;
  }

  // EPUB — zip of XHTML files
  if (mimeType === 'application/epub+zip' || ext === 'epub') {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);
    const textParts: string[] = [];

    // Find content files (XHTML/HTML)
    const contentFiles = Object.keys(zip.files)
      .filter(f => f.match(/\.(xhtml|html|htm|xml)$/i) && !f.includes('toc') && !f.includes('nav'))
      .sort();

    for (const filepath of contentFiles) {
      const content = await zip.files[filepath].async('string');
      // Strip HTML tags
      const text = content
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 20) {
        textParts.push(text);
      }
    }
    return textParts.join('\n\n');
  }

  // DOCX — zip containing word/document.xml
  if (ext === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buffer);
    const docXml = zip.files['word/document.xml'];
    if (docXml) {
      const content = await docXml.async('string');
      const text = content
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return text;
    }
    return '';
  }

  // Plain text, markdown, CSV, JSON, etc.
  return buffer.toString('utf-8');
}

/**
 * Extract heading context from markdown-style text.
 */
export function extractHeadingContext(text: string, position: number): string {
  const lines = text.slice(0, position).split('\n');
  const headings: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)/);
    if (match) {
      const level = match[1].length;
      // Keep only headings at this level and above
      headings.splice(level - 1);
      headings[level - 1] = match[2].trim();
    }
  }

  return headings.filter(Boolean).join(' > ');
}
