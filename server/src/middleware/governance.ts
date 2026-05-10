import { getDb } from '../db/database.js';
import { v4 as uuid } from 'uuid';

export interface AuditEntry {
  userId?: string;
  action: string;
  model?: string;
  inputPreview?: string;
  outputPreview?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  latencyMs?: number;
  toolName?: string;
  ragChunksUsed?: number;
  status?: string;
  metadata?: Record<string, any>;
}

/**
 * Log an action to the audit trail.
 */
export function logAudit(entry: AuditEntry): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO audit_log (user_id, action, model, input_preview, output_preview,
      tokens_in, tokens_out, cost_usd, latency_ms, tool_name, rag_chunks_used, status, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.userId || null,
    entry.action,
    entry.model || null,
    entry.inputPreview?.slice(0, 200) || null,
    entry.outputPreview?.slice(0, 200) || null,
    entry.tokensIn || 0,
    entry.tokensOut || 0,
    entry.costUsd || 0,
    entry.latencyMs || 0,
    entry.toolName || null,
    entry.ragChunksUsed || 0,
    entry.status || 'success',
    entry.metadata ? JSON.stringify(entry.metadata) : null
  );
}

/**
 * Estimate cost in USD for a given model and token usage.
 */
export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  // Approximate pricing per 1M tokens (as of 2026)
  const pricing: Record<string, { input: number; output: number }> = {
    'claude-sonnet-4':   { input: 3.0, output: 15.0 },
    'gemini-2.5-pro':    { input: 1.25, output: 10.0 },
    'gemini-2.5-flash':  { input: 0.15, output: 0.60 },
    'gpt-4.1-mini':      { input: 0.40, output: 1.60 },
  };

  const p = pricing[model] || { input: 1.0, output: 3.0 };
  return (tokensIn * p.input + tokensOut * p.output) / 1_000_000;
}

/**
 * Check governance policies for input filtering.
 * Returns { allowed: boolean, warnings: string[] }
 */
export function checkInputFilters(input: string): { allowed: boolean; warnings: string[] } {
  const db = getDb();
  const warnings: string[] = [];
  let allowed = true;

  const policies = db.prepare(
    "SELECT * FROM governance_policies WHERE type = 'input_filter' AND enabled = 1"
  ).all() as any[];

  for (const policy of policies) {
    const config = JSON.parse(policy.config);
    if (!config.enabled || !config.patterns) continue;

    for (const pattern of config.patterns) {
      const regex = new RegExp(pattern.regex, 'gi');
      if (regex.test(input)) {
        if (pattern.action === 'block') {
          allowed = false;
          warnings.push(`Blocked: ${pattern.name} detected in input`);
        } else if (pattern.action === 'warn') {
          warnings.push(`Warning: Possible ${pattern.name} detected in input`);
        }
      }
    }
  }

  return { allowed, warnings };
}

/**
 * Check governance policies for output filtering.
 * Returns potentially redacted output.
 */
export function filterOutput(output: string): { filtered: string; redactions: string[] } {
  const db = getDb();
  const redactions: string[] = [];
  let filtered = output;

  const policies = db.prepare(
    "SELECT * FROM governance_policies WHERE type = 'output_filter' AND enabled = 1"
  ).all() as any[];

  for (const policy of policies) {
    const config = JSON.parse(policy.config);
    if (!config.enabled || !config.patterns) continue;

    for (const pattern of config.patterns) {
      const regex = new RegExp(pattern.regex, 'gi');
      if (regex.test(filtered)) {
        if (pattern.action === 'redact') {
          filtered = filtered.replace(regex, '[REDACTED]');
          redactions.push(`Redacted: ${pattern.name}`);
        }
      }
    }
  }

  return { filtered, redactions };
}

/**
 * Check rate limits for a user role.
 */
export function checkRateLimit(userId: string, role: string): { allowed: boolean; message?: string } {
  const db = getDb();

  const policies = db.prepare(
    "SELECT * FROM governance_policies WHERE type = 'rate_limit' AND enabled = 1"
  ).all() as any[];

  for (const policy of policies) {
    const config = JSON.parse(policy.config);
    if (config.role !== role) continue;

    // Check requests per hour
    if (config.max_requests_per_hour) {
      const count = db.prepare(`
        SELECT COUNT(*) as cnt FROM audit_log
        WHERE user_id = ? AND action = 'llm_call'
        AND created_at > datetime('now', '-1 hour')
      `).get(userId) as any;

      if (count.cnt >= config.max_requests_per_hour) {
        return { allowed: false, message: `Rate limit exceeded: ${config.max_requests_per_hour} requests/hour` };
      }
    }

    // Check tokens per day
    if (config.max_tokens_per_day) {
      const usage = db.prepare(`
        SELECT COALESCE(SUM(tokens_in + tokens_out), 0) as total FROM audit_log
        WHERE user_id = ? AND action = 'llm_call'
        AND created_at > datetime('now', '-1 day')
      `).get(userId) as any;

      if (usage.total >= config.max_tokens_per_day) {
        return { allowed: false, message: `Daily token limit exceeded: ${config.max_tokens_per_day} tokens/day` };
      }
    }
  }

  return { allowed: true };
}

/**
 * Get allowed models for a given role.
 */
export function getAllowedModels(role: string): string[] {
  const db = getDb();

  const policy = db.prepare(
    "SELECT config FROM governance_policies WHERE id = 'model-access' AND enabled = 1"
  ).get() as any;

  if (!policy) {
    return ['claude-sonnet-4', 'gemini-2.5-pro', 'gpt-4.1-mini'];
  }

  const config = JSON.parse(policy.config);
  return config[role] || config['anonymous'] || [];
}
