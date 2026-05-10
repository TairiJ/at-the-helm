export interface User {
  id: string;
  username: string;
  role: 'anonymous' | 'user' | 'admin';
  displayName: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
  first_message?: string;
  message_count?: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  tool_calls?: string;
  rag_sources?: string;
  tokens_in?: number;
  tokens_out?: number;
  latency_ms?: number;
  created_at: string;
}

export interface Model {
  id: string;
  name: string;
  provider: string;
  description: string;
}

export interface Document {
  id: string;
  filename: string;
  mime_type: string;
  is_public: number;
  is_vault: number;
  tags: string;
  chunk_count: number;
  created_at: string;
}

export interface SearchResult {
  chunkId: string;
  documentId: string;
  content: string;
  filename: string;
  score: number;
  source: 'vector' | 'fts' | 'hybrid';
}

export interface StreamChunk {
  type: 'text' | 'tool_call' | 'done' | 'error' | 'governance_warning' | 'meta' | 'tool_exec' | 'tool_exec_done' | 'grounding';
  content?: string;
  toolCall?: any;
  tool?: string;
  callId?: string;
  usage?: { tokensIn: number; tokensOut: number; costUsd: number; latencyMs: number };
  warnings?: string[];
  conversationId?: string;
  ragSources?: { filename: string; score: number; source: string }[];
  grounding?: any;
  model?: string;
}

export interface GovernanceStats {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCost: number;
  todayRequests: number;
  todayCost: number;
  modelUsage: { model: string; count: number; tokens: number; cost: number }[];
  documents: number;
  chunks: number;
  users: number;
}

export interface AuditEntry {
  id: number;
  user_id: string;
  action: string;
  model?: string;
  input_preview?: string;
  output_preview?: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
  tool_name?: string;
  rag_chunks_used: number;
  status: string;
  created_at: string;
}
