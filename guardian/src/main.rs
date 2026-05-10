mod db;
mod watcher;
mod backup;
mod watchdog;
mod heartbeat;

use anyhow::Result;
use std::path::PathBuf;
use tracing::{info, error};

/// Runtime configuration resolved from CLI args / env
#[derive(Debug, Clone)]
pub struct Config {
    pub db_path: PathBuf,
    pub data_dir: PathBuf,
    pub backup_dir: PathBuf,
    pub node_cmd: String,
    pub node_args: Vec<String>,
    pub node_cwd: PathBuf,
    pub heartbeat_interval_secs: u64,
    pub watchdog_poll_secs: u64,
}

impl Config {
    fn resolve() -> Result<Self> {
        let exe = std::env::current_exe()?;
        // guardian/target/release/helm-guardian.exe -> go up 4 levels to project root
        let project_root = exe
            .ancestors()
            .nth(4)
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| PathBuf::from("."));

        let data_dir = project_root.join("data");
        let backup_dir = data_dir.join("backups");
        std::fs::create_dir_all(&backup_dir)?;

        Ok(Config {
            db_path: data_dir.join("helm.db"),
            data_dir: data_dir.clone(),
            backup_dir,
            node_cmd: "npx".to_string(),
            node_args: vec!["tsx".to_string(), "src/index.ts".to_string()],
            node_cwd: project_root.join("server"),
            heartbeat_interval_secs: 10,
            watchdog_poll_secs: 5,
        })
    }
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_env("RUST_LOG")
                .unwrap_or_else(|_| "helm_guardian=info".parse().unwrap()),
        )
        .compact()
        .init();

    info!("⚙  Helm Guardian v{} starting", env!("CARGO_PKG_VERSION"));

    let config = Config::resolve()?;
    info!("📁 DB: {:?}", config.db_path);
    info!("📦 Backups: {:?}", config.backup_dir);

    // Wait for Node.js to create the DB and run migrations before we touch it.
    // Node.js may not be up yet when guardian starts — retry until tables exist.
    info!("⏳ Waiting for database to be ready...");
    let conn = loop {
        match db::open(&config.db_path) {
            Ok(c) => {
                // Check if our table exists yet
                let ready: bool = c
                    .query_row(
                        "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='guardian_heartbeat'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .unwrap_or(0) > 0;

                if ready {
                    break c;
                }
                info!("   DB exists but schema not ready — retrying in 1s...");
            }
            Err(_) => {
                info!("   DB not found yet — retrying in 1s...");
            }
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    };
    info!("✅ Database ready");

    heartbeat::init(&conn)?;

    // Each tokio task opens its OWN SQLite connection.
    // rusqlite::Connection is not Send, so we cannot share across spawn boundaries.

    let db_path_hb = config.db_path.clone();
    let hb_interval = config.heartbeat_interval_secs;

    let heartbeat_handle = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path_hb).expect("heartbeat: db open failed");
        // Run heartbeat on a blocking thread — it just sleeps + updates
        tokio::runtime::Handle::current().block_on(heartbeat::run(&conn, hb_interval))
    });

    let db_path_watcher = config.db_path.clone();
    let cfg_watcher = config.clone();

    let watcher_handle = tokio::task::spawn_blocking(move || {
        let conn = db::open(&db_path_watcher).expect("watcher: db open failed");
        tokio::runtime::Handle::current().block_on(watcher::run(&conn, &cfg_watcher))
    });

    let cfg_watchdog = config.clone();
    let watchdog_handle = tokio::spawn(async move {
        if let Err(e) = watchdog::run(&cfg_watchdog).await {
            error!("Watchdog task failed: {e}");
        }
    });

    // Wait for OS shutdown signal
    tokio::signal::ctrl_c().await?;
    info!("⚙  Guardian shutting down gracefully");

    heartbeat_handle.abort();
    watcher_handle.abort();
    watchdog_handle.abort();

    Ok(())
}
