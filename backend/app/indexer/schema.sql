CREATE TABLE IF NOT EXISTS projects (
  encoded TEXT PRIMARY KEY,
  cwd TEXT,
  last_modified REAL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  encoded_project TEXT,
  full_path TEXT,
  first_prompt TEXT,
  summary TEXT,
  message_count INTEGER,
  created REAL,
  modified REAL,
  file_mtime REAL,
  git_branch TEXT,
  project_path TEXT,
  is_sidechain INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_modified ON sessions(modified DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(encoded_project);

CREATE TABLE IF NOT EXISTS messages (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT UNIQUE,
  session_id TEXT,
  parent_uuid TEXT,
  ts REAL,
  role TEXT,                 -- user|assistant|tool_use|tool_result|snapshot
  model TEXT,
  tool_name TEXT,
  cwd TEXT,
  git_branch TEXT,
  has_thinking INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cache_creation_input_tokens INTEGER,
  cache_read_input_tokens INTEGER,
  raw_offset INTEGER,
  raw_length INTEGER,
  preview TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_session_ts ON messages(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
CREATE INDEX IF NOT EXISTS idx_messages_tool ON messages(tool_name);
CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text,
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
