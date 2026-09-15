/**
 * 数据持久化层（SQLite / better-sqlite3）
 * 数据库文件默认落在 ./data/empire.db，可用环境变量 DB_PATH 覆盖。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data', 'empire.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

/* ------------------------------------------------------------------ *
 * Schema
 * ------------------------------------------------------------------ */

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT    NOT NULL UNIQUE,
  display_name    TEXT    NOT NULL,
  password_hash   TEXT    NOT NULL,
  created_at      INTEGER NOT NULL,
  last_seen       INTEGER NOT NULL,
  rank_id         INTEGER NOT NULL DEFAULT 0,
  office_key      TEXT,
  faction_id      INTEGER,
  stats           TEXT    NOT NULL DEFAULT '{}',
  resources       TEXT    NOT NULL DEFAULT '{}',
  tenure          INTEGER NOT NULL DEFAULT 0,
  last_tick       INTEGER NOT NULL DEFAULT 0,
  cooldowns       TEXT    NOT NULL DEFAULT '{}',
  retired         INTEGER NOT NULL DEFAULT 0,
  impeach_count   INTEGER NOT NULL DEFAULT 0,
  career_peak     INTEGER NOT NULL DEFAULT 0,
  history         TEXT    NOT NULL DEFAULT '[]',
  is_npc          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_players_rank ON players(rank_id);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS relations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  to_id       INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type        TEXT    NOT NULL,
  strength    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(from_id, to_id, type)
);
CREATE INDEX IF NOT EXISTS idx_rel_from ON relations(from_id);
CREATE INDEX IF NOT EXISTS idx_rel_to ON relations(to_id);

CREATE TABLE IF NOT EXISTS factions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  doctrine    TEXT    NOT NULL DEFAULT 'shiwu',
  leader_id   INTEGER REFERENCES players(id) ON DELETE SET NULL,
  treasury    INTEGER NOT NULL DEFAULT 0,
  power       INTEGER NOT NULL DEFAULT 0,
  motto       TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS office_slots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rank_id     INTEGER NOT NULL,
  organ_key   TEXT    NOT NULL,
  slot_index  INTEGER NOT NULL,
  holder_id   INTEGER REFERENCES players(id) ON DELETE SET NULL,
  since       INTEGER,
  UNIQUE(rank_id, organ_key, slot_index)
);

CREATE TABLE IF NOT EXISTS action_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   INTEGER NOT NULL,
  action_key  TEXT    NOT NULL,
  target_id   INTEGER,
  ok          INTEGER NOT NULL DEFAULT 1,
  detail      TEXT    NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_created ON action_log(created_at DESC);

CREATE TABLE IF NOT EXISTS gazette (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope       TEXT    NOT NULL DEFAULT 'global',
  player_id   INTEGER,
  kind        TEXT    NOT NULL DEFAULT 'info',
  text        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gazette_created ON gazette(created_at DESC);

CREATE TABLE IF NOT EXISTS pending_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  template    TEXT    NOT NULL,
  payload     TEXT    NOT NULL DEFAULT '{}',
  resolved    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_player ON pending_events(player_id, resolved);

CREATE TABLE IF NOT EXISTS world (
  k           TEXT PRIMARY KEY,
  v           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id     INTEGER NOT NULL,
  to_id       INTEGER NOT NULL,
  text        TEXT    NOT NULL,
  seen        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dm_pair ON direct_messages(from_id, to_id, created_at DESC);
`);

/* ------------------------------------------------------------------ *
 * 轻量迁移：为旧存档补列（幂等）
 * ------------------------------------------------------------------ */

function hasColumn(table, col) {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => c.name === col);
}

function ensureColumn(table, col, def) {
  if (!hasColumn(table, col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

ensureColumn('players', 'is_npc', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('direct_messages', 'seen', 'INTEGER NOT NULL DEFAULT 0');

// 依赖新列的索引必须在补列之后建，否则旧存档启动会直接报错
db.exec(`
CREATE INDEX IF NOT EXISTS idx_players_npc ON players(is_npc, retired);
CREATE INDEX IF NOT EXISTS idx_dm_to ON direct_messages(to_id, seen);
`);

/* ------------------------------------------------------------------ *
 * world 状态读写
 * ------------------------------------------------------------------ */

export function worldGet(k, fallback = null) {
  const row = db.prepare('SELECT v FROM world WHERE k = ?').get(k);
  if (!row) return fallback;
  try {
    return JSON.parse(row.v);
  } catch {
    return row.v;
  }
}

export function worldSet(k, v) {
  db.prepare(
    'INSERT INTO world (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v'
  ).run(k, JSON.stringify(v));
}

export function currentTick() {
  return worldGet('tick', 0);
}

export function bumpTick() {
  const t = currentTick() + 1;
  worldSet('tick', t);
  return t;
}

export function now() {
  return Date.now();
}

export function tx(fn) {
  return db.transaction(fn)();
}

export default db;
