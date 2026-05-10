import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import * as sqliteVec from 'sqlite-vec';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../../data');
const DB_PATH = path.join(DATA_DIR, 'helm.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Load sqlite-vec extension for vector search
    sqliteVec.load(db);

    runMigrations(db);
  }
  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    -- Users & Auth
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      display_name TEXT,
      resonance_key TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_login TEXT
    );

    -- Ensure resonance_key column exists (migration)
    PRAGMA table_info(users);
    -- We can't use IF NOT EXISTS in ALTER TABLE in SQLite easily without a script, 
    -- but we can just run it and ignore if it fails or use a check.
    -- Better way: handled by checking table_info elsewhere if needed, 
    -- but for now I'll just update the schema definition.

    -- Chat Conversations
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT,
      model TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Chat Messages
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      model TEXT,
      tool_calls TEXT,
      rag_sources TEXT,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    -- Knowledge documents
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT,
      content TEXT,
      is_public INTEGER DEFAULT 0,
      is_vault INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      chunk_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Chunked document fragments
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      content TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      token_count INTEGER DEFAULT 0,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    -- Audit log (append-only)
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      action TEXT NOT NULL,
      model TEXT,
      input_preview TEXT,
      output_preview TEXT,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      tool_name TEXT,
      rag_chunks_used INTEGER DEFAULT 0,
      status TEXT DEFAULT 'success',
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Governance policies
    CREATE TABLE IF NOT EXISTS governance_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER DEFAULT 1,
      updated_by TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- User feedback on responses
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      rating INTEGER,
      comment TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    -- User preferences and security
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      resonance_key_hash TEXT DEFAULT NULL,
      is_vault_enabled INTEGER DEFAULT 1,
      theme TEXT DEFAULT 'dark',
      notifications_enabled INTEGER DEFAULT 1,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    -- Backup jobs queue (read by Rust guardian)
    CREATE TABLE IF NOT EXISTS backup_jobs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      status      TEXT NOT NULL DEFAULT 'pending',
      target_path TEXT NOT NULL,
      output_dir  TEXT NOT NULL,
      label       TEXT,
      triggered_by TEXT DEFAULT 'system',
      created_at  TEXT DEFAULT (datetime('now')),
      started_at  TEXT,
      finished_at TEXT,
      error       TEXT
    );

    -- Guardian daemon heartbeat (written by Rust, read by Node.js)
    CREATE TABLE IF NOT EXISTS guardian_heartbeat (
      id        INTEGER PRIMARY KEY CHECK (id = 1),
      pid       INTEGER,
      last_seen TEXT DEFAULT (datetime('now')),
      version   TEXT
    );
  `);

  // Create FTS5 virtual table for keyword search (idempotent check)
  const ftsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'"
  ).get();

  if (!ftsExists) {
    db.exec(`
      CREATE VIRTUAL TABLE chunks_fts USING fts5(
        content,
        chunk_id UNINDEXED,
        document_id UNINDEXED
      );
    `);
  }

  // Create vector table for semantic search (idempotent check)
  const vecExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='chunk_embeddings'"
  ).get();

  if (!vecExists) {
    db.exec(`
      CREATE VIRTUAL TABLE chunk_embeddings USING vec0(
        chunk_id TEXT PRIMARY KEY,
        embedding FLOAT[3072]
      );
    `);
  }

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
  }
}
