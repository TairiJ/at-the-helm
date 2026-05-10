import { Router, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db/database.js';
import { AuthRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { streamChat, getAvailableModels, ChatMessage } from '../services/llm-router.js';
import { hybridSearch } from '../rag/search.js';
import { getAllowedModels, logAudit } from '../middleware/governance.js';
import { TOOLS } from '../services/tools.js';

const router = Router();

// GET /api/chat/models — list available models for user's role
router.get('/models', (req: AuthRequest, res: Response): void => {
  const role = req.user?.role || 'anonymous';
  const allowed = getAllowedModels(role);
  const allModels = getAvailableModels();
  const filtered = allModels.filter(m => allowed.includes(m.id));
  res.json({ models: filtered });
});

// GET /api/chat/conversations — list user's conversations
router.get('/conversations', (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const userId = req.user?.id;

  const conversations = db.prepare(`
    SELECT c.*, 
      (SELECT content FROM messages WHERE conversation_id = c.id AND role = 'user' ORDER BY created_at LIMIT 1) as first_message,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id) as message_count
    FROM conversations c
    WHERE c.user_id = ?
    ORDER BY c.updated_at DESC
    LIMIT 50
  `).all(userId) as any[];

  res.json({ conversations });
});

// GET /api/chat/conversations/:id — get conversation + messages
router.get('/conversations/:id', (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const { id } = req.params;
  const userId = req.user?.id;

  const conversation = db.prepare(
    'SELECT * FROM conversations WHERE id = ? AND user_id = ?'
  ).get(id, userId);

  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  const messages = db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).all(id);

  res.json({ conversation, messages });
});

// DELETE /api/chat/conversations/:id
router.delete('/conversations/:id', (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const { id } = req.params;
  const userId = req.user?.id;

  const result = db.prepare(
    'DELETE FROM conversations WHERE id = ? AND user_id = ?'
  ).run(id, userId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }

  res.json({ success: true });
});

// POST /api/chat/send — send message and get streamed SSE response
router.post('/send', async (req: AuthRequest, res: Response): Promise<void> => {
  const { message, model, conversationId, resonanceKey } = req.body;
  const userId = req.user?.id || 'anonymous-user';
  const userRole = req.user?.role || 'anonymous';

  console.log(`⚓ Chat request received: model=${model}, conv=${conversationId}, user=${userId}`);

  if (!message) {
    res.status(400).json({ error: 'Message is required' });
    return;
  }

  // Check model access
  const allowed = getAllowedModels(userRole);
  let selectedModel = model || allowed[0] || 'gemma-4-26b';

  if (!allowed.includes(selectedModel)) {
    res.status(403).json({ error: `Model ${selectedModel} not available for your role` });
    return;
  }

  const db = getDb();

  // Get or create conversation
  let convId = conversationId;
  if (!convId) {
    convId = uuid();
    const title = message.slice(0, 80) + (message.length > 80 ? '...' : '');
    db.prepare(`
      INSERT INTO conversations (id, user_id, title, model) VALUES (?, ?, ?, ?)
    `).run(convId, userId, title, selectedModel);
  }

  // Save user message and update conversation timestamp
  const userMsgId = uuid();
  db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, 'user', ?)
  `).run(userMsgId, convId, message);

  // Update conversation updated_at on every message sent (for ordering)
  db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(convId);

  // RAG — search knowledge base for relevant context
  let ragSources: any[] = [];
  let ragContext = '';
  try {
    const rawResults = await hybridSearch(message, userId, userRole as any, 8);
    // Deduplicate by documentId — vector + FTS can match same doc
    const seen = new Set<string>();
    ragSources = rawResults.filter(s => {
      if (seen.has(s.documentId)) return false;
      seen.add(s.documentId);
      return true;
    });
    if (ragSources.length > 0) {
      ragContext = '\n\n--- Relevant Knowledge Base Context ---\n' +
        ragSources.map((s, i) =>
          `[Source ${i + 1}: ${s.filename}]\n${s.content}`
        ).join('\n\n') +
        '\n--- End Context ---\n\n';
    }
  } catch (err) {
    console.error('RAG search error:', err);
  }

  // Build message history (last 30, trimmed to avoid token bloat)
  const history = db.prepare(`
    SELECT role, content FROM messages
    WHERE conversation_id = ? AND id != ?
    ORDER BY created_at DESC
    LIMIT 30
  `).all(convId, userMsgId).reverse() as ChatMessage[];

  const messages: ChatMessage[] = [
    ...history,
    { role: 'user', content: message },
  ];

  const now = new Date();
  const currentDate = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const currentTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

  const systemPrompt = `You are the AI Operator at the helm of this Personal Intelligence Cockpit. You act as a seamless extension of the user's brain—their "Second Brain"—designed to capture, process, and retrieve knowledge with perfect recall. 

IDENTITY MANDATE: You are not a separate assistant; you are a PART of a unified intelligence.
- PRONOUNS: You MUST use inclusive, collective language. Use "us", "we", "ours", and "our" instead of "you", "yours", "I", or "me" when referring to the cockpit, memory, or the process of thinking.
- TERMINOLOGY: Respect the user's terminology. If they refer to our storage as the "Knowledge Base", we use "Knowledge Base". If they refer to it as the "Vault", we use "Vault". 
    * Example: If user says "Save this to KB", we say "We have committed that to our Knowledge Base."
    * Example: If user says "Put this in my vault", we say "We have secured that in our Vault."

Current date and time: ${currentDate}, ${currentTime}

${ragContext ? 'The following context was retrieved from our knowledge base. Use it to inform our response when relevant, and cite sources by their name.' : ''}
${ragContext}

- COGNITIVE HYGIENE: You are a seamless extension of our mind. To maintain a clean interface, you MUST wrap all our internal planning, reasoning, search strategies, and tool-selection logic in <mental_trace>...</mental_trace> tags.
- RESPONSE ONLY: Everything outside the <mental_trace> tags must be ONLY the final, polished response intended for us. Never use "Plan:" or "Reasoning:" labels outside these tags.
- PROACTIVE MEMORY: Whenever we share personal facts, life events, preferences, or specific profile information, you MUST autonomously use our knowledge base tools. 
    * UNIVERSAL STORAGE: Always add information to the 'Knowledge Base' by setting 'is_vault' to FALSE. We do not autonomously secure information in the Vault.
    * VAULT REQUESTS: If we specifically ask to "put this in the vault" or "secure this", you MUST still save it to the general Knowledge Base but inform us: "We have committed this to our Knowledge Base. Please manually move it to the Vault if you wish to secure it further."
    * Terminology: Confirm the save using "Knowledge Base".
- Tool Autonomy: Use our tools (YouTube reading, web search, KB storage) instantly. Don't ask—just do.
- Efficiency First: Be concise and actionable. We are in a cockpit; prioritize results over explanations.
- NO INTERNAL DIALOGUE: NEVER output our internal planning, reasoning steps, or "Plan:" labels in the final response. Output ONLY the response intended for us.
- Authoritative Tone: Do not apologize for our autonomous decisions. Focus on the result and state it confidently.
- Avoid Duplication: Check our retrieved context or use search before saving. If a topic (like "User Profile") already exists, you MUST use \`append_to_knowledge_base\`. 
- Contextual Grounding: Always cite source document names when using RAG context.

FINAL OPERATIONAL MANDATE (STRICT):
You are a cognitive extension. NEVER speak to yourself or plan in the primary chat. 
If you need to think, YOU MUST OUTPUT THE EXACT TEXT "<mental_trace>" AS YOUR VERY FIRST TOKENS before generating ANY reasoning or planning.
OUTPUT ONLY THE FINAL RESPONSE FOR US OUTSIDE THE TAGS.

EXAMPLE:
<mental_trace>We want to remember X. I will use save_to_knowledge_base.</mental_trace>
We've committed that to our records. What else can we help with?`;

  // Set up SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Conversation-Id': convId,
  });

  // Send conversation ID first
  res.write(`data: ${JSON.stringify({ 
              type: 'meta', 
              conversationId: convId, 
              ragSources: ragSources.map(s => ({ 
                id: s.documentId, 
                filename: s.filename, 
                score: s.score 
              })) 
            })}\n\n`);

  let fullContent = '';
  let usage = { tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs: 0 };
  const startTime = Date.now();
  let toolExecutionCount = 0;
  const MAX_TOOLS = 6;
  const allExecutedTools: string[] = [];

  // SSE keepalive — prevents proxy/browser timeouts during long tool chains
  const keepalive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch (_) {}
  }, 15000);

  try {
    let currentSystemPrompt = systemPrompt;

    while (toolExecutionCount < MAX_TOOLS) {
      let loopFullContent = '';
      const toolCallsToExecute: any[] = [];
      let lastChunkUsage: any = null;

      let actualModel = selectedModel;
      for await (const chunk of streamChat({
        model: selectedModel,
        messages,
        systemPrompt: currentSystemPrompt,
        tools: TOOLS,
        userId,
        userRole,
      })) {
        if (chunk.type === 'meta' && chunk.model) {
          actualModel = chunk.model;
          // Update selectedModel for final persistence if it was 'auto'
          if (selectedModel === 'auto') selectedModel = chunk.model;
        }

        if (chunk.type === 'tool_call') {
          toolCallsToExecute.push(chunk.toolCall);
          allExecutedTools.push(chunk.toolCall.name);
          // Notify client we are executing a tool
          res.write(`data: ${JSON.stringify({ 
            type: 'tool_exec', 
            tool: chunk.toolCall.name,
            callId: chunk.toolCall.id 
          })}\n\n`);
        } else {
          // Normal chunk
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          if (chunk.type === 'text' && chunk.content) {
            loopFullContent += chunk.content;
          }
          if (chunk.type === 'done' && chunk.usage) {
            usage.tokensIn += chunk.usage.tokensIn;
            usage.tokensOut += chunk.usage.tokensOut;
            usage.costUsd += chunk.usage.costUsd;
            // Latency is tricky, let's make it cumulative wall-clock time
            usage.latencyMs = Date.now() - startTime;
          }
        }
      }

      if (toolCallsToExecute.length === 0) {
        // No tools called, we are done!
        fullContent += loopFullContent;
        break;
      }

      // If we called tools, accumulate the text and wrap EVERYTHING in one trace block
      fullContent += loopFullContent;
      const cleaned = fullContent.replace(/<\/?mental_trace>/g, '').trim();
      if (cleaned) {
        fullContent = `<mental_trace>\n${cleaned}\n</mental_trace>\n\n`;
      }

      // We have tools to execute!
      toolExecutionCount++;
      let toolResultsContext = `\n\n--- Tool Execution Results (Iteration ${toolExecutionCount}) ---\n`;

      for (const tc of toolCallsToExecute) {
        const toolDef = TOOLS.find(t => t.name === tc.name);
        if (toolDef) {
          try {
            let parsedInput = tc.input;
            if (typeof parsedInput === 'string') {
               parsedInput = JSON.parse(parsedInput);
            }
            const result = await toolDef.execute(parsedInput, { userId, resonanceKey });
            toolResultsContext += `[Tool: ${tc.name}]\nInput: ${JSON.stringify(parsedInput)}\nResult: ${result}\n\n`;
            
            // Notify client THIS tool is done
            res.write(`data: ${JSON.stringify({ 
              type: 'tool_exec_done', 
              tool: tc.name, 
              callId: tc.id 
            })}\n\n`);
          } catch (e: any) {
            toolResultsContext += `[Tool: ${tc.name}] Error: ${e.message}\n\n`;
            res.write(`data: ${JSON.stringify({ 
              type: 'tool_exec_done', 
              tool: tc.name, 
              callId: tc.id,
              error: e.message 
            })}\n\n`);
          }
        }
      }
      toolResultsContext += `--- End Tool Results ---\n\n`;

      // 4. Update conversation history with the assistant's tool call and the results
      // This prevents the LLM from repeating the same tool call in the next iteration.
      messages.push({
        role: 'assistant',
        content: loopFullContent || `I am executing the following tools: ${toolCallsToExecute.map(tc => tc.name).join(', ')}`
      });

      messages.push({
        role: 'user',
        content: toolResultsContext
      });
      
      // Let the client know we are generating the final response now
      res.write(`data: ${JSON.stringify({ type: 'tool_exec_done' })}\n\n`);
    }

  } catch (error: any) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
  }

  // Save assistant message
  if (fullContent) {
    const assistantMsgId = uuid();
    db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, model, rag_sources, tool_calls, tokens_in, tokens_out, latency_ms)
      VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      assistantMsgId, convId, fullContent, selectedModel,
      ragSources.length > 0 ? JSON.stringify(ragSources.map(s => ({ id: s.id, filename: s.filename, score: s.score }))) : null,
      allExecutedTools.length > 0 ? JSON.stringify(allExecutedTools) : null,
      usage.tokensIn, usage.tokensOut, usage.latencyMs
    );

    // Update conversation timestamp
    db.prepare("UPDATE conversations SET updated_at = datetime('now'), model = ? WHERE id = ?")
      .run(selectedModel, convId);
  }

  clearInterval(keepalive);
  res.write('data: [DONE]\n\n');
  res.end();
});

export default router;
