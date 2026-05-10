use anyhow::Result;
use std::process::Command;
use std::time::Duration;
use sysinfo::System;
use tokio::time::sleep;
use tracing::{error, info, warn};

use crate::Config;

/// Monitor the Node.js server process.
/// If it stops running, respawn it automatically.
pub async fn run(config: &Config) -> Result<()> {
    info!("🛡  Watchdog online — monitoring Node.js every {}s", config.watchdog_poll_secs);

    let mut node_pid: Option<u32> = None;

    loop {
        sleep(Duration::from_secs(config.watchdog_poll_secs)).await;

        // Refresh the process list each poll
        let sys = System::new_all();

        let node_alive = node_pid
            .and_then(|pid| {
                let sysinfo_pid = sysinfo::Pid::from(pid as usize);
                sys.process(sysinfo_pid)
            })
            .is_some();

        if !node_alive {
            if node_pid.is_some() {
                warn!("⚠  Node.js (PID {}) is gone — respawning", node_pid.unwrap());
            } else {
                info!("🔍 No Node.js PID tracked yet — scanning for running server");
                // Try to find an already-running node process before spawning a new one
                if let Some(pid) = find_node_pid(&sys) {
                    info!("   Found existing Node.js PID {pid}");
                    node_pid = Some(pid);
                    continue;
                }
                info!("   None found — spawning fresh Node.js");
            }

            match spawn_node(config) {
                Ok(pid) => {
                    info!("🚀 Node.js spawned — PID {pid}");
                    node_pid = Some(pid);
                }
                Err(e) => {
                    error!("Failed to spawn Node.js: {e}");
                }
            }
        }
    }
}

/// Attempt to find an already-running node process by name
fn find_node_pid(sys: &System) -> Option<u32> {
    for (pid, process) in sys.processes() {
        let name = process.name().to_string().to_lowercase();
        if name.contains("node") {
            return Some(pid.as_u32());
        }
    }
    None
}

/// Spawn Node.js as a detached child process
fn spawn_node(config: &Config) -> Result<u32> {
    let mut cmd = Command::new(&config.node_cmd);
    cmd.args(&config.node_args)
        .current_dir(&config.node_cwd)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    // Windows: CREATE_NO_WINDOW | DETACHED_PROCESS
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x00000008 | 0x08000000);
    }

    let child = cmd.spawn()?;
    Ok(child.id())
}
