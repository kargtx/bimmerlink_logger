const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

/**
 * Миграции схемы. Номер текущей версии хранится в PRAGMA user_version.
 * Новую миграцию добавляйте в конец массива — старые не меняйте.
 */
const MIGRATIONS = [
  // 1: новая схема
  `
  CREATE TABLE logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    filename TEXT NOT NULL,
    recorded_at TEXT,
    uploaded_at TEXT NOT NULL,
    duration_s REAL NOT NULL DEFAULT 0,
    row_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    parser_version INTEGER NOT NULL DEFAULT 0,
    time_label TEXT NOT NULL DEFAULT 'Time',
    warnings_json TEXT NOT NULL DEFAULT '[]',
    events_json TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE channels (
    log_id INTEGER NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    source_name TEXT NOT NULL,
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT '',
    grp TEXT NOT NULL DEFAULT 'other',
    warn REAL,
    min REAL, max REAL, avg REAL, min_t REAL, max_t REAL,
    valid_count INTEGER NOT NULL DEFAULT 0,
    constant INTEGER NOT NULL DEFAULT 0,
    all_zero INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (log_id, idx)
  );
  CREATE INDEX idx_logs_recorded ON logs(recorded_at);
  CREATE TABLE presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    channels_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `
];

function openDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

module.exports = { openDatabase, MIGRATIONS };
