import { getDb } from './database.js';
import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';

export async function seedDatabase(): Promise<void> {
  const db = getDb();

  // Seed admin user if not exists
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('tizz');
  if (!adminExists) {
    const hash = await bcrypt.hash('122802', 12);
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, display_name)
      VALUES (?, ?, ?, 'admin', 'Tizz')
    `).run(uuid(), 'tizz', hash);
    console.log('✓ Seeded admin user: tizz');
  }

  // Seed anonymous user for unauthenticated access
  const anonExists = db.prepare('SELECT id FROM users WHERE username = ?').get('anonymous');
  if (!anonExists) {
    const hash = await bcrypt.hash(uuid(), 12); // random password, not used
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, display_name)
      VALUES (?, ?, ?, 'anonymous', 'Anonymous')
    `).run('anonymous-user', 'anonymous', hash);
    console.log('✓ Seeded anonymous user');
  }

  // Seed default governance policies
  const policies = [
    {
      id: 'input-pii-filter',
      name: 'PII Input Detection',
      type: 'input_filter',
      config: JSON.stringify({
        patterns: [
          { name: 'SSN', regex: '\\b\\d{3}-\\d{2}-\\d{4}\\b', action: 'warn' },
          { name: 'Credit Card', regex: '\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b', action: 'warn' },
        ],
        enabled: true,
      }),
    },
    {
      id: 'output-pii-filter',
      name: 'PII Output Detection',
      type: 'output_filter',
      config: JSON.stringify({
        patterns: [
          { name: 'SSN', regex: '\\b\\d{3}-\\d{2}-\\d{4}\\b', action: 'redact' },
          { name: 'Credit Card', regex: '\\b\\d{4}[- ]?\\d{4}[- ]?\\d{4}[- ]?\\d{4}\\b', action: 'redact' },
        ],
        enabled: true,
      }),
    },
    {
      id: 'rate-limit-anonymous',
      name: 'Anonymous Rate Limit',
      type: 'rate_limit',
      config: JSON.stringify({
        role: 'anonymous',
        max_requests_per_hour: 20,
        max_tokens_per_day: 10000,
      }),
    },
    {
      id: 'rate-limit-user',
      name: 'User Rate Limit',
      type: 'rate_limit',
      config: JSON.stringify({
        role: 'user',
        max_requests_per_hour: 100,
        max_tokens_per_day: 100000,
      }),
    },
    {
      id: 'model-access',
      name: 'Model Access Control',
      type: 'model_access',
      config: JSON.stringify({
        anonymous: ['auto', 'gemma-3-1b', 'gemma-3-2b'],
        user: ['auto', 'gemma-3-1b', 'gemma-3-2b', 'gemma-3-4b', 'gemma-3-12b', 'gemma-4-26b', 'gemma-3-27b', 'gemma-4-31b'],
        admin: ['auto', 'gemma-3-1b', 'gemma-3-2b', 'gemma-3-4b', 'gemma-3-12b', 'gemma-4-26b', 'gemma-3-27b', 'gemma-4-31b'],
      }),
    },
    {
      id: 'data-retention',
      name: 'Data Retention Policy',
      type: 'retention',
      config: JSON.stringify({
        audit_log_days: 90,
        anonymous_chat_days: 7,
        user_chat_days: 365,
      }),
    },
  ];

  const upsertPolicy = db.prepare(`
    INSERT OR REPLACE INTO governance_policies (id, name, type, config, enabled)
    VALUES (?, ?, ?, ?, 1)
  `);

  for (const policy of policies) {
    upsertPolicy.run(policy.id, policy.name, policy.type, policy.config);
  }
  console.log('✓ Governance policies seeded');
}
