import type { User, Conversation, Message, Model, Document, StreamChunk, GovernanceStats, AuditEntry } from '../types';

const API_BASE = import.meta.env.DEV ? `http://${window.location.hostname}:3000/api` : '/api';

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('helm_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// ─── Auth ───
export async function login(username: string, password: string): Promise<{ user: User; token: string }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Login failed');
  const data = await res.json();
  localStorage.setItem('helm_token', data.token);
  return data;
}

export async function register(username: string, password: string, displayName?: string): Promise<{ user: User; token: string }> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ username, password, displayName }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Registration failed');
  const data = await res.json();
  localStorage.setItem('helm_token', data.token);
  return data;
}

export async function getMe(): Promise<{ user: User }> {
  const res = await fetch(`${API_BASE}/auth/me`, { headers: getHeaders() });
  return res.json();
}

export function logout(): void {
  localStorage.removeItem('helm_token');
}

export async function getPreferences(): Promise<any> {
  const res = await fetch(`${API_BASE}/auth/preferences`, { headers: getHeaders() });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to fetch preferences' }));
    throw new Error(error.error || 'Failed to fetch preferences');
  }
  return res.json();
}

export async function updatePreferences(update: { resonance_key?: string; is_vault_enabled?: boolean; theme?: string; notifications_enabled?: boolean }): Promise<any> {
  const res = await fetch(`${API_BASE}/auth/preferences`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(update),
  });
  if (!res.ok) {
    let errorMsg = `Sync Error (${res.status})`;
    try {
      const error = await res.json();
      errorMsg = error.error || errorMsg;
    } catch (e) {
      const text = await res.text().catch(() => '');
      if (text) errorMsg = `${errorMsg}: ${text.substring(0, 50)}`;
    }
    throw new Error(errorMsg);
  }
  return res.json();
}

// ─── Chat ───
export async function getModels(): Promise<Model[]> {
  const res = await fetch(`${API_BASE}/chat/models`, { headers: getHeaders() });
  const data = await res.json();
  return data.models;
}

export async function getConversations(): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE}/chat/conversations`, { headers: getHeaders() });
  const data = await res.json();
  return data.conversations;
}

export async function getConversation(id: string): Promise<{ conversation: Conversation; messages: Message[] }> {
  const res = await fetch(`${API_BASE}/chat/conversations/${id}`, { headers: getHeaders() });
  return res.json();
}

export async function deleteConversation(id: string): Promise<void> {
  await fetch(`${API_BASE}/chat/conversations/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
}

export async function sendMessage(
  message: string,
  model: string,
  conversationId?: string,
  resonanceKey?: string,
  onChunk?: (chunk: StreamChunk) => void
): Promise<void> {
  const res = await fetch(`${API_BASE}/chat/send`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ message, model, conversationId, resonanceKey }),
  });

  if (!res.ok) throw new Error('Failed to send message');

  const reader = res.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) throw new Error('No response body');

  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          const chunk: StreamChunk = JSON.parse(data);
          onChunk?.(chunk);
        } catch {
          // ignore parse errors
        }
      }
    }
  }
}

// ─── RAG ───
export async function getDocuments(): Promise<Document[]> {
  const res = await fetch(`${API_BASE}/rag/documents`, { headers: getHeaders() });
  const data = await res.json();
  return data.documents;
}

export async function uploadDocument(file: File, isPublic: boolean = false, isVault: boolean = false): Promise<any> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('isPublic', String(isPublic));
  formData.append('isVault', String(isVault));

  const headers: Record<string, string> = {};
  const token = localStorage.getItem('helm_token');
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/rag/ingest`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
  return res.json();
}

export async function deleteDocument(id: string): Promise<void> {
  await fetch(`${API_BASE}/rag/documents/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
}

export async function updateDocumentMetadata(id: string, update: { tags?: string[]; isVault?: boolean }): Promise<void> {
  await fetch(`${API_BASE}/rag/documents/${id}/tags`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(update),
  });
}

export async function searchKnowledge(query: string): Promise<any> {
  const res = await fetch(`${API_BASE}/rag/search`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ query }),
  });
  return res.json();
}

export async function ingestUrl(url: string, isPublic: boolean = false, isVault: boolean = false): Promise<any> {
  const res = await fetch(`${API_BASE}/rag/ingest-url`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ url, isPublic, isVault }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'URL ingest failed');
  return res.json();
}

export async function getDocumentPreview(id: string): Promise<{ document: any; chunks: any[] }> {
  const res = await fetch(`${API_BASE}/rag/documents/${id}/preview`, { headers: getHeaders() });
  return res.json();
}

// ─── Governance ───
export async function getGovernanceStats(): Promise<GovernanceStats> {
  const res = await fetch(`${API_BASE}/governance/stats`, { headers: getHeaders() });
  return res.json();
}

export async function getAuditLog(params?: { action?: string; limit?: number; offset?: number }): Promise<{ entries: AuditEntry[]; total: number }> {
  const query = new URLSearchParams(params as any).toString();
  const res = await fetch(`${API_BASE}/governance/audit?${query}`, { headers: getHeaders() });
  return res.json();
}

export async function getGovernancePolicies(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/governance/policies`, { headers: getHeaders() });
  const data = await res.json();
  return data.policies;
}

export async function updatePolicy(id: string, update: { enabled?: boolean; config?: any }): Promise<any> {
  const res = await fetch(`${API_BASE}/governance/policies/${id}`, {
    method: 'PATCH',
    headers: getHeaders(),
    body: JSON.stringify(update),
  });
  return res.json();
}
