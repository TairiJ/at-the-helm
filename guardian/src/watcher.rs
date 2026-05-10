use anyhow::Result;
use rusqlite::Connection;
use std::time::Duration;
use tokio::time::sleep;
use tracing::{debug, error, info};

use crate::{Config, db, backup};

/// Poll the backup_jobs table every 500ms for pending work.
/// Runs in a blocking thread — Connection is not Send.
pub async fn run(conn: &Connection, _config: &Config) -> Result<()> {
    info!("👁  Watcher online — polling backup_jobs every 500ms");

    loop {
        match db::fetch_pending_job(conn) {
            Ok(Some(job)) => {
                info!("📦 Backup job #{} found — label: {:?}", job.id, job.label);

                // Claim the job immediately to prevent double-processing
                if let Err(e) = db::mark_running(conn, job.id) {
                    error!("Failed to claim job #{}: {e}", job.id);
                    sleep(Duration::from_millis(500)).await;
                    continue;
                }

                let job_id = job.id;
                let target = job.target_path.clone();
                let out_dir = job.output_dir.clone();
                let label = job.label.clone().unwrap_or_else(|| format!("backup-{}", job_id));

                // Inline the backup synchronously — we're already on a blocking thread
                match backup::run_backup(&target, &out_dir, &label) {
                    Ok(zip_path) => {
                        info!("✅ Job #{} complete — {zip_path}", job_id);
                        if let Err(e) = db::mark_done(conn, job_id) {
                            error!("Failed to mark job #{job_id} done: {e}");
                        }
                    }
                    Err(e) => {
                        error!("❌ Job #{job_id} failed: {e}");
                        let _ = db::mark_failed(conn, job_id, &e.to_string());
                    }
                }
            }
            Ok(None) => {
                debug!("No pending jobs");
            }
            Err(e) => {
                error!("DB poll error: {e}");
            }
        }

        sleep(Duration::from_millis(500)).await;
    }
}
