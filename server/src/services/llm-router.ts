import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import OpenAI from 'openai';
import { logAudit, estimateCost, checkInputFilters, filterOutput, checkRateLimit } from '../middleware/governance.js';

// Lazy-initialized clients (env vars aren't available at import time)
let _anthropic: Anthropic;
let _genAI: GoogleGenerativeAI;
let _openai: OpenAI;

function getAnthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}
function getGenAI() {
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  return _genAI;
}
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface LLMRequest {
  model: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  userId?: string;
  userRole?: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  costUsd: number;
  toolCalls?: any[];
  finishReason?: string;
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'done' | 'error' | 'governance_warning' | 'grounding' | 'meta';
  content?: string;
  toolCall?: any;
  usage?: { tokensIn: number; tokensOut: number; costUsd: number; latencyMs: number };
  warnings?: string[];
  grounding?: any;
  model?: string;
  conversationId?: string;
  ragSources?: any[];
}

const MODEL_MAP: Record<string, { provider: string; modelId: string; fallback?: string }> = {
  'gemma-3-1b':   { provider: 'google', modelId: 'gemma-3-1b-it', fallback: 'gemma-4-26b' },
  'gemma-3-2b':   { provider: 'google', modelId: 'gemma-3n-e2b-it', fallback: 'gemma-4-26b' },
  'gemma-3-4b':   { provider: 'google', modelId: 'gemma-3-4b-it', fallback: 'gemma-4-26b' },
  'gemma-3-12b':  { provider: 'google', modelId: 'gemma-3-12b-it', fallback: 'gemma-4-26b' },
  'gemma-3-27b':  { provider: 'google', modelId: 'gemma-3-27b-it', fallback: 'gemma-4-26b' },
  'gemma-4-26b':  { provider: 'google', modelId: 'gemma-4-26b-a4b-it' },
  'gemma-4-31b':  { provider: 'google', modelId: 'gemma-4-31b-it' },
  'gemini-3.1-pro':        { provider: 'google', modelId: 'gemini-3.1-pro-preview' },
  'gemini-3.1-flash-lite': { provider: 'google', modelId: 'gemini-3.1-flash-lite-preview' },
  'gemini-2.5-flash-lite': { provider: 'google', modelId: 'gemini-2.5-flash-lite' },
};

/**
 * Stream LLM response using SSE.
 */
export async function* streamChat(request: LLMRequest): AsyncGenerator<StreamChunk> {
  const startTime = Date.now();
  const PRIMARY_MODELS = ['gemma-4-26b', 'gemma-4-31b', 'gemini-3.1-pro'];
  const FAILOVER_SEQUENCE = ['gemma-4-26b', 'gemma-4-31b', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];
  let selectedModel = request.model || 'auto';

  // --- CASCADE ROUTING LOGIC ---
  if (selectedModel === 'auto') {
    const lastUserMsg = request.messages.filter(m => m.role === 'user').pop();
    const totalContent = request.messages.reduce((sum, m) => sum + m.content.length, 0) + (request.systemPrompt?.length || 0);
    const hasTools = request.tools && request.tools.length > 0;
    const msgContent = lastUserMsg?.content.toLowerCase().trim() || '';

    const greetings = ['hey', 'hi', 'hello', 'yo', 'sup', 'ready', 'at the helm'];
    const kbKeywords = ['knowledge base', 'kb', 'vault', 'remember', 'save', 'commit', 'recall', 'search our', 'look up'];
    
    const isGreeting = greetings.includes(msgContent) || msgContent === 'hey' || msgContent === 'hi';
    
    if (isGreeting) {
      selectedModel = 'gemma-4-26b';
    } else if (kbKeywords.some(k => msgContent.includes(k)) || hasTools) {
      selectedModel = 'gemma-4-31b';
    } else {
      try {
        const classifier = getGenAI().getGenerativeModel({ model: 'gemma-4-26b-a4b-it' });
        const prompt = `Classify the intent complexity of this request:
        - LIGHT: Casual greetings (hey, hi), or simple housekeeping.
        - MEDIUM: Specific questions, requests for information.
        - MEMORY: Saving information, knowledge base updates, vault operations, or using tools.
        - COMPLEX: Technical research, deep analysis, or large context processing.
        
        Request: "${msgContent}"
        Output only the category (LIGHT, MEDIUM, MEMORY, or COMPLEX).`;
        
        const classResult = await classifier.generateContent(prompt);
        const category = classResult.response.text().trim().toUpperCase();
        
        if (category.includes('COMPLEX') || category.includes('MEMORY') || hasTools || totalContent > 50000) {
          selectedModel = 'gemma-4-31b';
        } else {
          selectedModel = 'gemma-4-26b';
        }
        console.log(`⚓ Cascade-Router: Intent: ${category}, Selected: ${selectedModel}`);
      } catch (e) {
        selectedModel = 'gemma-4-26b';
      }
    }
  }

  // Governance & Rate Limit checks
  const lastUserMsg = request.messages.filter(m => m.role === 'user').pop();
  if (lastUserMsg && request.userId && request.userRole) {
    const inputCheck = checkInputFilters(lastUserMsg.content);
    if (!inputCheck.allowed) {
      yield { type: 'error', content: inputCheck.warnings.join('; ') };
      return;
    }
    const rateCheck = checkRateLimit(request.userId, request.userRole);
    if (!rateCheck.allowed) {
      yield { type: 'error', content: rateCheck.message || 'Rate limit exceeded' };
      return;
    }
  }

  const mapping = MODEL_MAP[selectedModel] || { provider: 'google', modelId: selectedModel };
  
  try {
    yield* executeStream(mapping, request, selectedModel);
  } catch (error: any) {
    console.error(`⚓ Router Error [${selectedModel}]:`, error.message);
    
    logAudit({
      userId: request.userId || 'system',
      action: 'llm_call',
      model: selectedModel,
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: Date.now() - startTime,
      costUsd: 0,
      status: 'error',
      metadata: { 
        userRole: request.userRole || 'admin',
        error: error.message 
      }
    });

    // Transparent failover for Gemma 3 (if 404 or unsupported)
    if (mapping.fallback && (error.message.includes('404') || error.message.includes('not found'))) {
      console.warn(`⚓ Failover: ${selectedModel} -> ${mapping.fallback}`);
      yield { type: 'text', content: `\n\n> [!NOTE]\n> **Model Failover**: ${selectedModel} is currently unavailable on the API. We are failing over to **${mapping.fallback}** to maintain continuity.\n\n` };
      const fallbackMapping = MODEL_MAP[mapping.fallback];
      if (fallbackMapping) {
        yield* executeStream(fallbackMapping, request, mapping.fallback);
        return;
      }
    }
    
    yield { type: 'error', content: `LLM error: ${error.message}` };
  }
}

async function* executeStream(mapping: any, request: LLMRequest, modelName: string): AsyncGenerator<StreamChunk> {
  const startTime = Date.now();
  yield { type: 'meta', model: modelName };

  let fullContent = '';
  let tokensIn = 0;
  let tokensOut = 0;
  let toolCalls: any[] = [];
  const lastUserMsg = request.messages.filter(m => m.role === 'user').pop();

  switch (mapping.provider) {
    case 'anthropic': {
      const messages = request.messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const stream = getAnthropic().messages.stream({
        model: mapping.modelId,
        max_tokens: 4096,
        system: request.systemPrompt || 'You are a helpful AI assistant in the At The Helm cockpit.',
        messages,
        ...(request.tools?.length ? {
          tools: request.tools.map(t => ({
            name: t.name,
            description: t.description,
            input_schema: t.parameters as Anthropic.Tool.InputSchema,
          })),
        } : {}),
      });

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          const delta = event.delta as any;
          if (delta.type === 'text_delta') {
            fullContent += delta.text;
            yield { type: 'text', content: delta.text };
          }
        } else if (event.type === 'content_block_start') {
          const block = event.content_block as any;
          if (block.type === 'tool_use') {
            toolCalls.push({ id: block.id, name: block.name, input: '' });
          }
        }
      }

      const finalMsg = await stream.finalMessage();
      tokensIn = finalMsg.usage?.input_tokens || 0;
      tokensOut = finalMsg.usage?.output_tokens || 0;

      for (const block of finalMsg.content) {
        if (block.type === 'tool_use') {
          const existing = toolCalls.find(tc => tc.id === block.id);
          if (existing) existing.input = block.input;
          else toolCalls.push({ id: block.id, name: block.name, input: block.input });
          yield { type: 'tool_call', toolCall: { id: block.id, name: block.name, input: block.input } };
        }
      }
      break;
    }

    case 'google': {
      const isGemma3 = mapping.modelId.startsWith('gemma-3');
      const supportsTools = (mapping.modelId.startsWith('gemma-4') || mapping.modelId.startsWith('gemini'));
      const supportsSystem = !isGemma3;

      const model = getGenAI().getGenerativeModel({
        model: mapping.modelId,
        ...(supportsSystem && request.systemPrompt ? {
          systemInstruction: { role: 'system', parts: [{ text: request.systemPrompt }] },
        } : {}),
        ...(supportsTools && request.tools?.length ? {
          tools: [{
            functionDeclarations: request.tools.map(t => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters as any
            }))
          }]
        } : {})
      });

      const baseHistory = request.messages.slice(0, -1);
      const history = baseHistory.map((m, i) => {
        let content = m.content;
        if (i === 0 && !supportsSystem && request.systemPrompt) {
          content = `SYSTEM INSTRUCTION: ${request.systemPrompt}\n\nUSER MESSAGE: ${content}`;
        }
        return {
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: content }],
        };
      });

      const chat = model.startChat({ history: history as any });
      const lastMsg = request.messages[request.messages.length - 1];
      const result = await chat.sendMessageStream(lastMsg.content);

      for await (const chunk of result.stream) {
        try {
          const text = chunk.text();
          if (text) {
            fullContent += text;
            yield { type: 'text', content: text };
          }
        } catch (e) {}
      }

      const response = await result.response;
      const functionCalls = response.functionCalls();
      if (functionCalls) {
        for (const fc of functionCalls) {
          const tc = { id: Math.random().toString(36).substring(7), name: fc.name, input: fc.args };
          toolCalls.push(tc);
          yield { type: 'tool_call', toolCall: tc };
        }
      }
      const usage = response.usageMetadata;
      tokensIn = usage?.promptTokenCount || 0;
      tokensOut = usage?.candidatesTokenCount || 0;
      break;
    }

    case 'openai': {
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
      for (const m of request.messages) messages.push({ role: m.role as any, content: m.content });

      const stream = await getOpenAI().chat.completions.create({
        model: mapping.modelId,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        ...(request.tools?.length ? {
          tools: request.tools.map(t => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        } : {}),
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          fullContent += delta.content;
          yield { type: 'text', content: delta.content };
        }
        if (chunk.usage) {
          tokensIn = chunk.usage.prompt_tokens || 0;
          tokensOut = chunk.usage.completion_tokens || 0;
        }
      }
      break;
    }
  }

  const latencyMs = Date.now() - startTime;
  const costUsd = estimateCost(modelName, tokensIn, tokensOut);
  logAudit({
    userId: request.userId || 'system',
    action: 'llm_call',
    model: modelName,
    tokensIn,
    tokensOut,
    latencyMs,
    costUsd,
    status: 'success',
    metadata: { userRole: request.userRole || 'admin' }
  });

  yield {
    type: 'done',
    content: fullContent,
    usage: { tokensIn, tokensOut, costUsd, latencyMs },
    ...(toolCalls.length > 0 ? { toolCall: toolCalls } : {}),
  };
}

/**
 * Generate embeddings using Gemini.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const model = getGenAI().getGenerativeModel({ model: 'gemini-embedding-001' });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

/**
 * Get available models list.
 */
export function getAvailableModels() {
  return [
    { id: 'auto', name: 'Auto-Route (Dynamic)', provider: 'System', description: 'Automatically selects the best model for the task' },
    { id: 'gemma-3-1b', name: 'Gemma 3 1B', provider: 'Google', description: 'Tiny — ultra-fast for UI housekeeping' },
    { id: 'gemma-3-4b', name: 'Gemma 3 4B', provider: 'Google', description: 'Lightweight — balanced speed' },
    { id: 'gemma-3-12b', name: 'Gemma 3 12B', provider: 'Google', description: 'Medium — daily tasks' },
    { id: 'gemma-3-27b', name: 'Gemma 3 27B', provider: 'Google', description: 'Powerful — high-accuracy' },
    { id: 'gemma-4-26b', name: 'Gemma 4 26B (MoE)', provider: 'Google', description: 'Agentic Workhorse' },
    { id: 'gemma-4-31b', name: 'Gemma 4 31B (Dense)', provider: 'Google', description: 'Deep Researcher' },
    { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', provider: 'Google', description: 'Maximum Reasoning — Deep Intelligence' },
  ];
}
