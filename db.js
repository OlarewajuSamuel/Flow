const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'flowworld.db');
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
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
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
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
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS chapter_revisions (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT DEFAULT '',
    version INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    book_id TEXT NOT NULL,
    name TEXT DEFAULT '',
    biography TEXT DEFAULT '',
    appearance TEXT DEFAULT '',
    relationships TEXT DEFAULT '[]',
    abilities TEXT DEFAULT '[]',
    portrait TEXT DEFAULT '',
    gallery TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
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
    created_at TEXT DEFAULT (datetime('now')),
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
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS flame_transactions (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    amount INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
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
    last_read_at TEXT DEFAULT (datetime('now')),
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
    created_at TEXT DEFAULT (datetime('now')),
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
    created_at TEXT DEFAULT (datetime('now')),
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
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    book_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
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
`);

const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
const userColumns = columns('users');
if (!userColumns.includes('googleId')) db.exec('ALTER TABLE users ADD COLUMN googleId TEXT');
if (!userColumns.includes('facebookId')) db.exec('ALTER TABLE users ADD COLUMN facebookId TEXT');
if (!userColumns.includes('twitterId')) db.exec('ALTER TABLE users ADD COLUMN twitterId TEXT');

module.exports = db;
