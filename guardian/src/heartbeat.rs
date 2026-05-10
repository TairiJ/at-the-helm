use anyhow::Result;
use rusqlite::Connection;
use std::time::Duration;
use tokio::time::sleep;
use tracing::{info, warn};

/// Write initial heartbeat row (upsert so it's safe on restart)
pub fn init(conn: &Connection) -> Result<()> {
    let pid = std::process::id();
    let version = env!("CARGO_PKG_VERSION");

    conn.execute(
        "INSERT INTO guardian_heartbeat (id, pid, last_seen, version) VALUES (1, ?1, datetime('now'), ?2)
         ON CONFLICT(id) DO UPDATE SET pid = ?1, last_seen = datetime('now'), version = ?2",
        rusqlite::params![pid, version],
    )?;

    info!("💓 Heartbeat initialized — PID {pid}, version {version}");
    Ok(())
}

/// Update `last_seen` every `interval_secs` seconds.
/// This lets Node.js detect if the guardian has crashed.
pub async fn run(conn: &Connection, interval_secs: u64) -> Result<()> {
    loop {
        match conn.execute(
            "UPDATE guardian_heartbeat SET last_seen = datetime('now') WHERE id = 1",
            [],
        ) {
            Ok(_) => {}
            Err(e) => warn!("Heartbeat write failed: {e}"),
        }

        sleep(Duration::from_secs(interval_secs)).await;
    }
}
