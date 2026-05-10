import { Router, Response } from 'express';
import { getDb } from '../db/database.js';
import { AuthRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';

const router = Router();

// GET /api/governance/audit — get audit log entries (admin only)
router.get('/audit', requireRole('admin'), (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const { action, limit, offset, userId } = req.query;

  let query = 'SELECT * FROM audit_log WHERE 1=1';
  const params: any[] = [];

  if (action) {
    query += ' AND action = ?';
    params.push(action);
  }
  if (userId) {
    query += ' AND user_id = ?';
    params.push(userId);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit) || 50, Number(offset) || 0);

  const entries = db.prepare(query).all(...params);
  const total = db.prepare('SELECT COUNT(*) as count FROM audit_log').get() as any;

  res.json({ entries, total: total.count });
});

// GET /api/governance/stats — aggregated stats (admin only)
router.get('/stats', requireRole('admin'), (req: AuthRequest, res: Response): void => {
  const db = getDb();

  const totalRequests = db.prepare(
    "SELECT COUNT(*) as count FROM audit_log WHERE action = 'llm_call'"
  ).get() as any;

  const totalTokens = db.prepare(
    "SELECT COALESCE(SUM(tokens_in), 0) as input, COALESCE(SUM(tokens_out), 0) as output FROM audit_log WHERE action = 'llm_call'"
  ).get() as any;

  const totalCost = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) as total FROM audit_log WHERE action = 'llm_call'"
  ).get() as any;

  const modelUsage = db.prepare(
    "SELECT model, COUNT(*) as count, COALESCE(SUM(tokens_in + tokens_out), 0) as tokens, COALESCE(SUM(cost_usd), 0) as cost FROM audit_log WHERE action = 'llm_call' AND model IS NOT NULL GROUP BY model"
  ).all();

  const todayRequests = db.prepare(
    "SELECT COUNT(*) as count FROM audit_log WHERE action = 'llm_call' AND created_at > datetime('now', '-1 day')"
  ).get() as any;

  const todayCost = db.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) as total FROM audit_log WHERE action = 'llm_call' AND created_at > datetime('now', '-1 day')"
  ).get() as any;

  const ragStats = db.prepare(
    "SELECT COUNT(*) as documents FROM documents"
  ).get() as any;

  const chunkStats = db.prepare(
    "SELECT COUNT(*) as chunks FROM chunks"
  ).get() as any;

  const userCount = db.prepare(
    "SELECT COUNT(*) as count FROM users WHERE role != 'anonymous'"
  ).get() as any;

  res.json({
    totalRequests: totalRequests.count,
    totalTokensIn: totalTokens.input,
    totalTokensOut: totalTokens.output,
    totalCost: totalCost.total,
    todayRequests: todayRequests.count,
    todayCost: todayCost.total,
    modelUsage,
    documents: ragStats.documents,
    chunks: chunkStats.chunks,
    users: userCount.count,
  });
});

// GET /api/governance/policies — list governance policies (admin only)
router.get('/policies', requireRole('admin'), (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const policies = db.prepare('SELECT * FROM governance_policies ORDER BY type').all();
  res.json({ policies });
});

// PATCH /api/governance/policies/:id — update a policy (admin only)
router.patch('/policies/:id', requireRole('admin'), (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const { id } = req.params;
  const { enabled, config } = req.body;

  const policy = db.prepare('SELECT * FROM governance_policies WHERE id = ?').get(id);
  if (!policy) {
    res.status(404).json({ error: 'Policy not found' });
    return;
  }

  if (enabled !== undefined) {
    db.prepare('UPDATE governance_policies SET enabled = ?, updated_by = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(enabled ? 1 : 0, req.user?.id, id);
  }
  if (config) {
    db.prepare('UPDATE governance_policies SET config = ?, updated_by = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(JSON.stringify(config), req.user?.id, id);
  }

  const updated = db.prepare('SELECT * FROM governance_policies WHERE id = ?').get(id);
  res.json({ policy: updated });
});

// GET /api/governance/users — list users (admin only)
router.get('/users', requireRole('admin'), (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const users = db.prepare(
    "SELECT id, username, role, display_name, created_at, last_login FROM users WHERE role != 'anonymous' ORDER BY created_at DESC"
  ).all();
  res.json({ users });
});

// PATCH /api/governance/users/:id/role — update user role (admin only)
router.patch('/users/:id/role', requireRole('admin'), (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const { id } = req.params;
  const { role } = req.body;

  if (!['user', 'admin'].includes(role)) {
    res.status(400).json({ error: 'Invalid role' });
    return;
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  res.json({ success: true });
});

export default router;
