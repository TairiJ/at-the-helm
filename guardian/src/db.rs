use anyhow::Result;
use rusqlite::{Connection, OpenFlags, params};
use std::path::Path;

/// Open the shared SQLite database in WAL mode.
/// We use read-write but NOT create — the DB is always created by Node.js first.
pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;

    // WAL for concurrent access (Node.js reads/writes simultaneously)
    conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;")?;

    Ok(conn)
}

/// A single pending backup job row
#[derive(Debug)]
pub struct BackupJob {
    pub id: i64,
    pub target_path: String,
    pub output_dir: String,
    pub label: Option<String>,
    pub triggered_by: Option<String>,
}

/// Fetch the oldest pending job (FIFO)
pub fn fetch_pending_job(conn: &Connection) -> Result<Option<BackupJob>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, target_path, output_dir, label, triggered_by \
         FROM backup_jobs WHERE status = 'pending' ORDER BY id ASC LIMIT 1",
    )?;

    let result = stmt.query_row([], |row| {
        Ok(BackupJob {
            id: row.get(0)?,
            target_path: row.get(1)?,
            output_dir: row.get(2)?,
            label: row.get(3)?,
            triggered_by: row.get(4)?,
        })
    });

    match result {
        Ok(job) => Ok(Some(job)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Mark a job as running
pub fn mark_running(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE backup_jobs SET status = 'running', started_at = datetime('now') WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

/// Mark a job as done
pub fn mark_done(conn: &Connection, id: i64) -> Result<()> {
    conn.execute(
        "UPDATE backup_jobs SET status = 'done', finished_at = datetime('now') WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

/// Mark a job as failed with an error message
pub fn mark_failed(conn: &Connection, id: i64, error: &str) -> Result<()> {
    conn.execute(
        "UPDATE backup_jobs SET status = 'failed', finished_at = datetime('now'), error = ?1 WHERE id = ?2",
        params![error, id],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE backup_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                target_path TEXT NOT NULL,
                output_dir TEXT NOT NULL,
                label TEXT,
                triggered_by TEXT,
                status TEXT DEFAULT 'pending',
                started_at TEXT,
                finished_at TEXT,
                error TEXT
            )",
            [],
        ).unwrap();
        conn
    }

    #[test]
    fn test_fetch_pending_job_empty() {
        let conn = setup_test_db();
        let job = fetch_pending_job(&conn).unwrap();
        assert!(job.is_none());
    }

    #[test]
    fn test_backup_job_lifecycle() {
        let conn = setup_test_db();
        
        // Insert a job
        conn.execute(
            "INSERT INTO backup_jobs (target_path, output_dir, label) VALUES (?, ?, ?)",
            params!["/src", "/dest", "test-label"],
        ).unwrap();

        // Fetch it
        let job = fetch_pending_job(&conn).unwrap().expect("Should have a job");
        assert_eq!(job.target_path, "/src");
        assert_eq!(job.status_in_db(&conn), "pending");

        // Mark running
        mark_running(&conn, job.id).unwrap();
        assert_eq!(job.status_in_db(&conn), "running");

        // Mark done
        mark_done(&conn, job.id).unwrap();
        assert_eq!(job.status_in_db(&conn), "done");
    }

    impl BackupJob {
        fn status_in_db(&self, conn: &Connection) -> String {
            conn.query_row(
                "SELECT status FROM backup_jobs WHERE id = ?",
                params![self.id],
                |row| row.get(0),
            ).unwrap()
        }
    }
}
