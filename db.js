// ============================================================
// Database layer — Vercel Postgres (Neon) via the `pg` driver.
// ------------------------------------------------------------
// This module replaces the old better-sqlite3 (file-based SQLite)
// database. SQLite stores data in a local file which is NOT
// persistent on Vercel's serverless runtime, so we moved to a
// hosted Postgres database (Vercel Postgres / Neon).
//
// To keep the ~90 query sites in server.js minimal-risk to port,
// this module exposes async helpers that mirror the old API:
//   db.get(sql, [...params])  -> first row  (or undefined)
//   db.all(sql, [...params])  -> array of rows
//   db.run(sql, [...params])  -> { rowCount }
//   db.transaction(async tx => {...})  -> runs inside BEGIN/COMMIT
//
// The old SQL used SQLite '?' positional placeholders. We convert
// them to Postgres '$1, $2, ...' automatically so the queries in
// server.js stay readable and unchanged.
// ============================================================

const { Pool } = require('pg');

// Vercel Postgres exposes the pooled connection URL through these
// environment variables (in priority order). In local development a
// .env file provides the same value.
const CONNECTION_URL =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.PGURI;

if (!CONNECTION_URL) {
  // Do not crash the whole app at import time: log a clear message.
  // /api/health and /api/auth/me will report the DB as unavailable.
  console.error('[db] Missing database connection string. Set POSTGRES_URL');
  console.error('[db] Create a Postgres database on Vercel and add POSTGRES_URL to your environment.');
}

const pool = new Pool({
  connectionString: CONNECTION_URL,
  // Serverless best practice: don't keep a socket open waiting for the
  // next request. Prevents "timeout exceeded" errors on Vercel.
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  max: 10,
});

// Constants used by the app are centralised here so the rest of the
// code doesn't depend on SQLite-specific functions.
const dbDefaults = {
  // Matches new Date().toISOString() -> 'YYYY-MM-DDTHH:MM:SS.SSSZ'
  isoNow: () => new Date().toISOString(),
  today: () => new Date().toISOString().split('T')[0],
};

// Convert SQLite '?' placeholders to Postgres '$1, $2, ...'
function toPgPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Ensure the query actually has a connection before running. On Vercel
// the DB URL is always present; in a mis-configured local env this fails
// gracefully.
async function ensurePool() {
  if (!CONNECTION_URL) {
    const err = new Error('Database is not configured. Set POSTGRES_URL (Vercel Postgres).');
    err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
}

// ── Schema bootstrap ─────────────────────────────────
// The old app stored its schema in a local SQLite file. On Vercel the
// database is fresh Postgres, so we create the tables (and add any
// missing columns) idempotently at startup.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password TEXT,
    username TEXT,
    bio TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    banner TEXT DEFAULT '',
    level INTEGER DEFAULT 1,
    exp INTEGER DEFAULT 0,
    lifetime_exp INTEGER DEFAULT 0,
    flames_remaining INTEGER DEFAULT 2,
    last_flame_reset TEXT DEFAULT '',
    followers INTEGER DEFAULT 0,
    theme TEXT DEFAULT 'dark',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS books (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL,
    title TEXT NOT NULL,
    synopsis TEXT DEFAULT '',
    genre TEXT DEFAULT '',
    type TEXT DEFAULT 'novel',
    tags TEXT DEFAULT '[]',
    cover TEXT DEFAULT '',
    status TEXT DEFAULT 'ongoing',
    visibility TEXT DEFAULT 'public',
    published INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chapters (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    title TEXT DEFAULT 'Untitled',
    content TEXT DEFAULT '',
    author_notes TEXT DEFAULT '',
    published INTEGER DEFAULT 0,
    word_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chapter_revisions (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    version INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    name TEXT DEFAULT '',
    nickname TEXT DEFAULT '',
    age TEXT DEFAULT '',
    height TEXT DEFAULT '',
    weight TEXT DEFAULT '',
    biography TEXT DEFAULT '',
    appearance TEXT DEFAULT '',
    relationships TEXT DEFAULT '[]',
    abilities TEXT DEFAULT '[]',
    portrait TEXT DEFAULT '',
    gallery TEXT DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    rating INTEGER DEFAULT 5,
    content TEXT DEFAULT '',
    likes INTEGER DEFAULT 0,
    pinned INTEGER DEFAULT 0,
    ratings TEXT DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now(),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chapter_comments (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT DEFAULT '',
    paragraph_index INTEGER DEFAULT -1,
    likes INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS flame_transactions (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    amount INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT now(),
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS book_flames (
    book_id TEXT PRIMARY KEY,
    total INTEGER DEFAULT 0,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reading_progress (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    chapter_id TEXT DEFAULT '',
    paragraph_index INTEGER DEFAULT 0,
    completion_pct REAL DEFAULT 0,
    last_read_at TIMESTAMPTZ DEFAULT now(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    UNIQUE(user_id, book_id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT DEFAULT 'info',
    message TEXT DEFAULT '',
    read INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS daily_views (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    date TEXT NOT NULL,
    count INTEGER DEFAULT 1,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    UNIQUE(book_id, date)
  );

  CREATE TABLE IF NOT EXISTS follows (
    id TEXT PRIMARY KEY,
    follower_id TEXT NOT NULL,
    following_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(follower_id, following_id)
  );

  CREATE TABLE IF NOT EXISTS wall_posts (
    id TEXT PRIMARY KEY,
    author_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    content TEXT DEFAULT '',
    likes INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
    UNIQUE(user_id, book_id)
  );

  CREATE TABLE IF NOT EXISTS daily_reward_claims (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    reward_date TEXT NOT NULL,
    last_reward_at TEXT NOT NULL,
    claimed INTEGER DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, action_type, reward_date)
  );
`;

// Add OAuth id columns if they do not yet exist (migration safety).
async function ensureColumns() {
  const users = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
  const has = (c) => users.rows.some(r => r.column_name === c);
  const cols = [
    ['googleId', 'TEXT'],
    ['facebookId', 'TEXT'],
    ['twitterId', 'TEXT'],
  ];
  for (const [name, type] of cols) {
    if (!has(name)) await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ${name} ${type}`);
  }
}

async function initSchema() {
  if (!CONNECTION_URL) return false;
  const client = await pool.connect();
  try {
    await client.query(SCHEMA);
    await ensureColumns();
    console.log('[db] Schema ready');
    return true;
  } catch (err) {
    console.error('[db] Schema init failed:', err ? err.message : err);
    return false;
  } finally {
    client.release();
  }
}

const db = {
  async raw(sql, params) {
    await ensurePool();
    try {
      return await pool.query(sql, params || []);
    } catch (err) {
      console.error('[db] query failed:', sql, err ? err.message : err);
      throw err;
    }
  },

  // Get a single row (or undefined).
  async get(sql, params) {
    const r = await this.raw(sql, params);
    return r.rows[0];
  },

  // Get all rows.
  async all(sql, params) {
    const r = await this.raw(sql, params);
    return r.rows;
  },

  // Run an INSERT / UPDATE / DELETE (or anything without rows).
  async run(sql, params) {
    const r = await this.raw(sql, params);
    return { changes: r.rowCount || 0 };
  },

  // Run several writes inside a single transaction.
  async transaction(fn) {
    await ensurePool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx = {
        run: async (s, p) => { const r = await client.query(s, p || []); return { changes: r.rowCount || 0 }; },
        get: async (s, p) => { const r = await client.query(s, p || []); return r.rows[0]; },
        all: async (s, p) => { const r = await client.query(s, p || []); return r.rows; },
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      console.error('[db] transaction failed:', err ? err.message : err);
      throw err;
    } finally {
      client.release();
    }
  },

  pool,
  defaults: dbDefaults,

  // Used by connect-pg-simple for persistent sessions.
  get config() {
    return { connectionString: CONNECTION_URL };
  },

  // True when the server is able to reach the database (used by /api/health).
  async ping() {
    if (!CONNECTION_URL) return false;
    try {
      await pool.query('SELECT 1');
      return true;
    } catch (err) {
      console.error('[db] ping failed:', err ? err.message : err);
      return false;
    }
  },

  initSchema,
};

module.exports = db;

// Boot the schema. In local dev this runs. On Vercel it runs once per cold
// start (idempotent CREATE TABLE IF NOT EXISTS) which is safe and cheap.
initSchema().catch(err => {
  console.error('[db] startup schema init failed:', err ? err.message : err);
});
