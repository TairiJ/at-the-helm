import { ToolDefinition } from './llm-router.js';

export interface ExecutableTool extends ToolDefinition {
  execute: (args: any, context?: any) => Promise<string>;
}

async function executeTavilySearch(args: { query: string }): Promise<string> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return 'Error: TAVILY_API_KEY is not configured on the server.';
  }

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: args.query,
        search_depth: 'advanced',
        include_answer: true,
        include_raw_content: false,
        max_results: 5,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return `Error from Tavily API: ${res.status} - ${errText}`;
    }

    const data = await res.json();
    return data.answer || JSON.stringify(data.results);
  } catch (err: any) {
    return `Failed to execute web search: ${err.message}`;
  }
}

async function executeWebScraper(args: { url: string }): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch(args.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return `Error: Failed to fetch URL (${response.status} ${response.statusText})`;
    }

    const html = await response.text();
    const { load } = await import('cheerio');
    const $ = load(html);

    // Remove hard noise
    $('script, style, nav, footer, header, aside, .ads, .sidebar, .cookie-banner, [aria-hidden="true"]').remove();

    // Extract high-signal content: prefer main/article, fall back to body
    const title = $('title').text().trim();
    const contentEl = $('main, article, [role="main"]').first();
    const rawText = (contentEl.length ? contentEl : $('body'))
      .find('h1, h2, h3, h4, h5, h6, p, li, td, th, blockquote, pre')
      .map((_: any, el: any) => $(el).text().trim())
      .get()
      .filter((t: string) => t.length > 10)
      .join('\n');

    const body = rawText.replace(/\n{3,}/g, '\n\n').trim();

    if (body.length < 50) {
      return 'Error: Could not extract meaningful content from this page. It may be protected or heavily reliant on JavaScript.';
    }

    return `Source: ${args.url}\nTitle: ${title}\n\nContent:\n${body.slice(0, 18000)}${body.length > 18000 ? '\n\n... [Content Truncated — use a more specific URL to get full detail]' : ''}`;
  } catch (err: any) {
    if (err.name === 'AbortError') return 'Error: Request timed out after 10 seconds. The site may be slow or unreachable.';
    return `Failed to scrape website: ${err.message}`;
  }
}

async function executeGetDatetime(): Promise<string> {
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return JSON.stringify({
    iso: now.toISOString(),
    date: now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }),
    time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    timezone: timeZone,
    unix: Math.floor(now.getTime() / 1000),
  });
}

async function executeCalculate(args: { expression: string }): Promise<string> {
  try {
    const { evaluate } = await import('mathjs');
    const result = evaluate(args.expression);
    return `Result: ${result}\nExpression: ${args.expression}`;
  } catch (err: any) {
    return `Calculation error: ${err.message}`;
  }
}

async function executeYoutubeReader(args: { video_url: string }): Promise<string> {
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');
    const transcript = await YoutubeTranscript.fetchTranscript(args.video_url);
    if (!transcript || transcript.length === 0) {
      return 'Error: No transcript found for this video. It may not have captions enabled.';
    }
    const fullText = transcript.map((item: any) => item.text).join(' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    return `YouTube Video Transcript:\n\n${fullText}`;
  } catch (err: any) {
    return `Failed to read YouTube video: ${err.message}`;
  }
}

export const TOOLS: ExecutableTool[] = [
  {
    name: 'get_current_datetime',
    description: 'Returns the current date, time, day of the week, and timezone. Use this whenever the user asks about time, schedules, or when you need to timestamp a memory accurately.',
    parameters: { type: 'object', properties: {} },
    execute: executeGetDatetime,
  },
  {
    name: 'calculate',
    description: 'Evaluates a mathematical expression. Supports arithmetic, algebra, trigonometry, unit conversions (e.g. "5 km to miles"), and constants like pi and e. Use this instead of computing in your head.',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'The math expression to evaluate, e.g. "2^10", "sqrt(144)", "5 km to miles", "sin(pi/2)".' },
      },
      required: ['expression'],
    },
    execute: executeCalculate,
  },
  {
    name: 'scrape_website',
    description: 'Extracts the full text content from a specific website URL. Use this when the user provides a link they want you to read, summarize, or analyze. This is more precise than a general web search.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full URL of the website to scrape.',
        },
      },
      required: ['url'],
    },
    execute: executeWebScraper,
  },
  {
    name: 'read_youtube_transcript',
    description: 'Extracts the captions/transcript from a YouTube video URL. Use this to read the contents of a video when a user provides a YouTube link or asks you to summarize a video.',
    parameters: {
      type: 'object',
      properties: {
        video_url: {
          type: 'string',
          description: 'The full URL of the YouTube video (e.g. https://www.youtube.com/watch?v=...)',
        },
      },
      required: ['video_url'],
    },
    execute: executeYoutubeReader,
  },
  {
    name: 'web_search',
    description: 'Search the live internet for up-to-date information, news, or answers to questions.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query to execute.',
        },
      },
      required: ['query'],
    },
    execute: executeTavilySearch,
  },
  {
    name: 'save_to_knowledge_base',
    description: 'Save information to an entirely NEW Knowledge Base entry. IMPORTANT: Use this ONLY if no relevant entry already exists. If you are adding data to a topic you have already remembered (like a user profile or ongoing research), you MUST use append_to_knowledge_base instead to avoid duplicates.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A short, descriptive title for the memory.' },
        content: { type: 'string', description: 'The actual content or fact to remember.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional keywords or tags for this memory (e.g. ["preference", "coding"]).' },
        source_url: { type: 'string', description: 'The original URL where this information came from (e.g. a YouTube link or website).' },
        is_vault: { type: 'boolean', description: 'ALWAYS set this to false. We do not autonomously add to the Vault. If the user asks for the Vault, we add to the Knowledge Base instead and inform them to move it manually.' }
      },
      required: ['title', 'content'],
    },
    execute: async (args: any, context?: any) => {
      try {
        const { getDb } = await import('../db/database.js');
        const { chunkText } = await import('../rag/chunker.js');
        const { generateEmbedding } = await import('./llm-router.js');
        const { v4: uuid } = await import('uuid');

        const db = getDb();
        const userId = context?.userId || 'anonymous-user';

        // --- SECURITY CHALLENGE ---
        if (args.is_vault) {
          const userPrefs = db.prepare('SELECT is_vault_enabled, resonance_key_hash FROM user_preferences WHERE user_id = ?').get(userId) as any;
          if (userPrefs?.is_vault_enabled && userPrefs?.resonance_key_hash) {
            if (!context?.resonanceKey || context.resonanceKey !== userPrefs.resonance_key_hash) {
              return "RESONANCE_CHALLENGE_REQUIRED: A valid Resonance Key is required to secure this in the Vault.";
            }
          }
        }

        // --- SMART DEDUPLICATION ---
        // Check if a document with this title already exists before creating a new one
        const existingDoc = db.prepare(`
          SELECT id, filename, chunk_count, is_vault FROM documents 
          WHERE user_id = ? AND filename LIKE ? 
          ORDER BY created_at DESC LIMIT 1
        `).get(userId, `%${args.title}%`) as any;

        if (existingDoc) {
          // INTERNALLY SWITCH TO APPEND MODE
          const chunks = chunkText(args.content);
          const chunkData: any[] = [];
          for (const chunk of chunks) {
            const embedding = await generateEmbedding(chunk.content);
            if (!embedding) continue;
            const embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);
            chunkData.push({ id: uuid(), index: existingDoc.chunk_count + chunk.index, content: chunk.content, tokenEstimate: chunk.tokenEstimate, embeddingBuffer });
          }

          const insertChunk = db.prepare('INSERT INTO chunks (id, document_id, chunk_index, content, token_count) VALUES (?, ?, ?, ?, ?)');
          const insertEmbedding = db.prepare('INSERT INTO chunk_embeddings (chunk_id, embedding) VALUES (?, ?)');
          for (const c of chunkData) {
            insertChunk.run(c.id, existingDoc.id, c.index, c.content, c.tokenEstimate);
            insertEmbedding.run(c.id, c.embeddingBuffer);
          }
          db.prepare('UPDATE documents SET chunk_count = chunk_count + ?, is_vault = ?, updated_at = datetime(\'now\') WHERE id = ?').run(chunkData.length, args.is_vault ? 1 : existingDoc.is_vault, existingDoc.id);
          
          return `Smart Update Successful: I detected that "${existingDoc.filename}" already exists, so I appended ${chunkData.length} new chunks to it instead of creating a duplicate. Use the user's terminology (Knowledge Base or Vault) to confirm.`;
        }

        // --- NORMAL SAVE MODE ---
        const docId = uuid();
        let tagsArr = args.tags && Array.isArray(args.tags) ? args.tags : ['memory'];
        if (args.source_url) {
          tagsArr = [args.source_url, ...tagsArr];
        }
        const tagsStr = JSON.stringify(tagsArr);

        // 1. Chunk text and generate embeddings first (don't touch DB yet)
        const chunks = chunkText(args.content);
        const chunkData: { id: string, index: number, content: string, tokenEstimate: number, embeddingBuffer: Buffer }[] = [];

        for (const chunk of chunks) {
          const embedding = await generateEmbedding(chunk.content);
          if (!embedding) continue;

          // Convert array to binary format expected by sqlite-vec
          const embeddingFloat32 = new Float32Array(embedding);
          const embeddingBuffer = Buffer.from(embeddingFloat32.buffer);
          
          chunkData.push({ 
            id: uuid(), 
            index: chunk.index, 
            content: chunk.content, 
            tokenEstimate: chunk.tokenEstimate,
            embeddingBuffer 
          });
        }

        // 2. Insert Document
        db.prepare(`
          INSERT INTO documents (id, user_id, filename, mime_type, is_public, is_vault, tags, chunk_count)
          VALUES (?, ?, ?, 'text/plain', 0, ?, ?, ?)
        `).run(docId, userId, `AI Memory: ${args.title}`, args.is_vault ? 1 : 0, tagsStr, chunkData.length);

        // 3. Insert Chunks into 'chunks' and 'chunk_embeddings'
        const insertChunk = db.prepare(`
          INSERT INTO chunks (id, document_id, chunk_index, content, token_count)
          VALUES (?, ?, ?, ?, ?)
        `);
        const insertEmbedding = db.prepare(`
          INSERT INTO chunk_embeddings (chunk_id, embedding)
          VALUES (?, ?)
        `);

        for (const c of chunkData) {
          insertChunk.run(c.id, docId, c.index, c.content, c.tokenEstimate);
          insertEmbedding.run(c.id, c.embeddingBuffer);
        }

        return `Successfully saved memory as "${args.title}" (${chunkData.length} chunks embedded). Confirm to the user using their terminology (Knowledge Base or Vault).`;
      } catch (err: any) {
        return `Failed to save memory: ${err.message}`;
      }
    }
  },
  {
    name: 'append_to_knowledge_base',
    description: 'Append new information to an EXISTING Knowledge Base entry by adding new data chunks to it. This is the preferred way to expand on existing research, profiles, or topics. A successful append adds new memory chunks to the original document.',
    parameters: {
      type: 'object',
      properties: {
        title_search: { type: 'string', description: 'The title (or keyword from the title) of the existing memory. Example: "profile" to update "User Profile".' },
        additional_content: { type: 'string', description: 'The new data to be appended as new chunks.' }
      },
      required: ['title_search', 'additional_content'],
    },
    execute: async (args: any, context?: any) => {
      try {
        const { getDb } = await import('../db/database.js');
        const { chunkText } = await import('../rag/chunker.js');
        const { generateEmbedding } = await import('./llm-router.js');
        const { v4: uuid } = await import('uuid');

        const db = getDb();
        const userId = context?.userId || 'anonymous-user';

        // 1. Find the existing document
        const doc = db.prepare(`
          SELECT id, filename, chunk_count FROM documents 
          WHERE user_id = ? AND filename LIKE ? 
          ORDER BY created_at DESC LIMIT 1
        `).get(userId, `%${args.title_search}%`) as any;

        if (!doc) {
          return `Error: Could not find an existing memory with a title matching "${args.title_search}". You may want to create a new one using save_to_knowledge_base instead.`;
        }

        // 2. Chunk and embed the NEW content
        const chunks = chunkText(args.additional_content);
        const chunkData: any[] = [];

        for (const chunk of chunks) {
          const embedding = await generateEmbedding(chunk.content);
          if (!embedding) continue;
          const embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);
          
          chunkData.push({ 
            id: uuid(), 
            index: doc.chunk_count + chunk.index, // Start indexing from where we left off
            content: chunk.content, 
            tokenEstimate: chunk.tokenEstimate,
            embeddingBuffer 
          });
        }

        // 3. Insert new chunks
        const insertChunk = db.prepare(`
          INSERT INTO chunks (id, document_id, chunk_index, content, token_count)
          VALUES (?, ?, ?, ?, ?)
        `);
        const insertEmbedding = db.prepare(`
          INSERT INTO chunk_embeddings (chunk_id, embedding)
          VALUES (?, ?)
        `);

        for (const c of chunkData) {
          insertChunk.run(c.id, doc.id, c.index, c.content, c.tokenEstimate);
          insertEmbedding.run(c.id, c.embeddingBuffer);
        }

        // 4. Update document chunk count
        db.prepare('UPDATE documents SET chunk_count = chunk_count + ? WHERE id = ?')
          .run(chunkData.length, doc.id);

        return `Operation Successful: Appended ${chunkData.length} new memory chunks to "${doc.filename}". This entry now contains ${doc.chunk_count + chunkData.length} total grounded facts. Respond to the user confirming the update is live.`;
      } catch (err: any) {
        return `Operation Failed: ${err.message}`;
      }
    }
  },
  {
    name: 'update_knowledge_base_metadata',
    description: 'Update the title (filename) or tags of an existing knowledge base entry.',
    parameters: {
      type: 'object',
      properties: {
        title_search: { type: 'string', description: 'The current title of the entry to update.' },
        new_title: { type: 'string', description: 'The new title for the entry.' },
        new_tags: { type: 'array', items: { type: 'string' }, description: 'New list of tags for the entry.' },
        is_vault: { type: 'boolean', description: 'Set to true to move this document to the secure, password-protected vault. Set to false to return it to general knowledge.' }
      },
      required: ['title_search'],
    },
    execute: async (args: any, context?: any) => {
      try {
        const { getDb } = await import('../db/database.js');
        const db = getDb();
        const userId = context?.userId || 'anonymous-user';

        const doc = db.prepare('SELECT id, filename FROM documents WHERE user_id = ? AND filename LIKE ? LIMIT 1')
          .get(userId, `%${args.title_search}%`) as any;

        if (!doc) return `Error: No memory found matching "${args.title_search}".`;

        if (args.new_title) {
          db.prepare('UPDATE documents SET filename = ? WHERE id = ?').run(args.new_title, doc.id);
        }
        if (args.new_tags) {
          db.prepare('UPDATE documents SET tags = ? WHERE id = ?').run(JSON.stringify(args.new_tags), doc.id);
        }
        if (args.is_vault !== undefined) {
          db.prepare('UPDATE documents SET is_vault = ? WHERE id = ?').run(args.is_vault ? 1 : 0, doc.id);
        }

        return `Successfully updated metadata for "${doc.filename}". Changes are live.`;
      } catch (err: any) {
        return `Update failed: ${err.message}`;
      }
    }
  }
];
