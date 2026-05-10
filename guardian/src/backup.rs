use anyhow::{Context, Result};
use chrono::Local;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use tracing::{debug, info};
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

/// Run a single backup: walk `target_path`, stream everything into a zip at `output_dir`.
/// Returns the path of the created zip file.
pub fn run_backup(target_path: &str, output_dir: &str, label: &str) -> Result<String> {
    let target = Path::new(target_path);
    let out_dir = Path::new(output_dir);

    fs::create_dir_all(out_dir)
        .with_context(|| format!("Cannot create output dir {:?}", out_dir))?;

    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    let sanitized_label = label.replace(|c: char| !c.is_alphanumeric() && c != '-', "_");
    let zip_name = format!("{sanitized_label}_{timestamp}.zip");
    let zip_path = out_dir.join(&zip_name);

    info!("📂 Backing up {:?} → {:?}", target, zip_path);

    let file = File::create(&zip_path)
        .with_context(|| format!("Cannot create zip at {:?}", zip_path))?;

    // BufWriter reduces syscall overhead for streaming writes
    let writer = BufWriter::with_capacity(256 * 1024, file);
    let mut zip = ZipWriter::new(writer);

    // Deflate for good compression-to-speed balance; level 6 is the sweet spot
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(6))
        .unix_permissions(0o644);

    let base = if target.is_dir() {
        target.to_path_buf()
    } else {
        target.parent().unwrap_or(Path::new(".")).to_path_buf()
    };

    let entries: Vec<PathBuf> = if target.is_file() {
        vec![target.to_path_buf()]
    } else {
        WalkDir::new(target)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| e.into_path())
            .collect()
    };

    let mut buf = vec![0u8; 64 * 1024]; // 64KB read buffer — reused across files

    for path in &entries {
        // Build relative path inside the zip
        let rel = path
            .strip_prefix(&base)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/"); // normalize to POSIX paths inside zip

        debug!("  + {rel}");
        zip.start_file(rel, options)?;

        let mut reader = File::open(path)
            .with_context(|| format!("Cannot open {:?}", path))?;

        loop {
            use std::io::Read;
            let n = reader.read(&mut buf)?;
            if n == 0 { break; }
            zip.write_all(&buf[..n])?;
        }
    }

    zip.finish()?;

    let zip_path_str = zip_path.to_string_lossy().to_string();
    info!("✅ Zipped {} files → {zip_path_str}", entries.len());
    Ok(zip_path_str)
}
