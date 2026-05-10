/**
 * guardian.ts
 * 
 * Spawns the Rust `helm-guardian` binary as a detached background process,
 * monitors its heartbeat via the SQLite `guardian_heartbeat` table,
 * and respawns it if it dies.
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../../');
const GUARDIAN_BIN = path.join(
  PROJECT_ROOT,
  'guardian',
  'target',
  'release',
  process.platform === 'win32' ? 'helm-guardian.exe' : 'helm-guardian'
);

const HEARTBEAT_STALE_SECS = 30;  // respawn if no heartbeat for 30s
const CHECK_INTERVAL_MS   = 15_000; // check every 15s

let guardianProc: ChildProcess | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// ─── Public API ──────────────────────────────────────────────────────────────

export function startGuardian(): void {
  // Check if binary exists before attempting launch
  import('fs').then(({ existsSync }) => {
    if (!existsSync(GUARDIAN_BIN)) {
      console.warn(`⚙  Guardian binary not found at ${GUARDIAN_BIN}`);
      console.warn('⚙  Run: cd guardian && cargo build --release');
      return;
    }

    spawnGuardian();
    heartbeatTimer = setInterval(checkHeartbeat, CHECK_INTERVAL_MS);
    console.log(`⚙  Guardian monitor active — checking every ${CHECK_INTERVAL_MS / 1000}s`);
  });
}

export function stopGuardian(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (guardianProc) {
    guardianProc.kill('SIGTERM');
    guardianProc = null;
  }
}

/**
 * Queue a backup job in the DB. The Rust watcher will pick it up within 500ms.
 */
export function triggerBackup(
  label: string,
  targetPath: string,
  outputDir: string,
  triggeredBy: string = 'user'
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO backup_jobs (status, target_path, output_dir, label, triggered_by)
     VALUES ('pending', ?, ?, ?, ?)`
  ).run(targetPath, outputDir, label, triggeredBy);

  console.log(`📦 Backup job queued — label: "${label}"`);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function spawnGuardian(): void {
  console.log(`⚙  Spawning guardian: ${GUARDIAN_BIN}`);

  guardianProc = spawn(GUARDIAN_BIN, [], {
    cwd: PROJECT_ROOT,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, RUST_LOG: 'helm_guardian=info' },
  });

  guardianProc.unref(); // Don't keep Node.js alive just for guardian

  guardianProc.on('exit', (code, signal) => {
    console.warn(`⚙  Guardian exited (code=${code}, signal=${signal})`);
    guardianProc = null;
  });

  guardianProc.on('error', (err) => {
    console.error('⚙  Guardian spawn error:', err.message);
    guardianProc = null;
  });
}

async function checkHeartbeat(): Promise<void> {
  try {
    const db = getDb();
    const row = db.prepare(
      `SELECT pid, last_seen FROM guardian_heartbeat WHERE id = 1`
    ).get() as { pid: number; last_seen: string } | undefined;

    if (!row) {
      console.warn('⚙  No guardian heartbeat row found — respawning');
      spawnGuardian();
      return;
    }

    const lastSeen = new Date(row.last_seen + ' UTC');
    const staleSecs = (Date.now() - lastSeen.getTime()) / 1000;

    if (staleSecs > HEARTBEAT_STALE_SECS) {
      console.warn(`⚙  Guardian heartbeat stale (${staleSecs.toFixed(0)}s) — respawning`);
      if (guardianProc) guardianProc.kill('SIGKILL');
      guardianProc = null;
      spawnGuardian();
    }
  } catch (err) {
    console.error('⚙  Heartbeat check failed:', err);
  }
}
