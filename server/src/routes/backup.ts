import { Router, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/database.js';
import { AuthRequest } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { triggerBackup } from '../services/guardian.js';

const router = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../../');
const DATA_DIR      = path.join(PROJECT_ROOT, 'data');
const BACKUP_DIR    = path.join(DATA_DIR, 'backups');

// POST /api/backup/trigger — queue a new backup job
router.post('/trigger', requireRole('admin'), (req: AuthRequest, res: Response): void => {
  const { label = 'manual-backup' } = req.body;

  triggerBackup(
    label,
    DATA_DIR,        // back up the entire data/ directory
    BACKUP_DIR,
    req.user?.id || 'system'
  );

  res.json({
    success: true,
    message: `Backup job "${label}" queued. The guardian will process it within seconds.`,
  });
});

// GET /api/backup/jobs — list recent backup jobs
router.get('/jobs', requireRole('admin'), (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const jobs = db.prepare(
    `SELECT id, status, label, triggered_by, created_at, started_at, finished_at, error
     FROM backup_jobs
     ORDER BY id DESC
     LIMIT 50`
  ).all();

  res.json({ jobs });
});

// GET /api/backup/guardian — guardian heartbeat status
router.get('/guardian', requireRole('admin'), (req: AuthRequest, res: Response): void => {
  const db = getDb();
  const heartbeat = db.prepare(
    `SELECT pid, last_seen, version FROM guardian_heartbeat WHERE id = 1`
  ).get() as any;

  if (!heartbeat) {
    res.json({ status: 'offline', heartbeat: null });
    return;
  }

  const staleSecs = (Date.now() - new Date(heartbeat.last_seen + ' UTC').getTime()) / 1000;
  const status = staleSecs < 30 ? 'online' : 'stale';

  res.json({ status, staleSecs: Math.round(staleSecs), heartbeat });
});

export default router;
