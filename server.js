// ============================================================
// Flow World — Express server (Vercel-ready)
// ------------------------------------------------------------
// This file is a single Express app that works BOTH as a local
// development server AND as a Vercel serverless function:
//
//   - Local:  `npm run dev` / `npm start` -> app.listen(...)
//   - Vercel: the file exports `app`, and vercel.json routes all
//             requests to it. Vercel never calls app.listen().
//
// The database is Vercel Postgres (Neon) through the `pg` driver
// (see db.js). Sessions are persisted in Postgres so logins survive
// serverless cold starts.
// ============================================================

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const TwitterStrategy = require('passport-twitter').Strategy;
const PgStore = require('connect-pg-simple')(session);
const crypto = require('crypto');
const path = require('path');

const db = require('./db');

const app = express();
app.set('trust proxy', 1); // We are behind Vercel's proxy; enables secure cookies + req.protocol

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
const PORT = process.env.PORT || 3000;

// Determine the public URL of this app.
// Vercel injects VERCEL_PROJECT_PRODUCTION_URL (e.g. myapp.vercel.app).
const publicUrl =
  process.env.APP_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `http://localhost:${PORT}`);

const APP_URL = publicUrl.replace(/\/+$/, '');

// ── Helpers ──────────────────────────────────────────
const uid = () => crypto.randomUUID();
const parseRatings = (s) => { try { const o = JSON.parse(s || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };
const today = () => new Date().toISOString().split('T')[0];
const now = () => new Date().toISOString();

// EXP thresholds: level * 100
const expForLevel = lvl => lvl * 100;
const dailyFlameAllowance = lvl => lvl >= 21 ? 5 : lvl >= 11 ? 4 : lvl >= 5 ? 3 : 2;
const statusIsPublished = status => String(status || '').toLowerCase() !== 'draft';
const publicBookWhere = "b.published = 1 AND b.visibility = 'public'";

// Check & reset daily flames for a user
async function checkDailyReset(userId) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return;
  if (user.last_flame_reset !== today()) {
    const allowance = dailyFlameAllowance(user.level);
    await db.run('UPDATE users SET flames_remaining = ?, last_flame_reset = ? WHERE id = ?', [allowance, today(), userId]);
    return allowance;
  }
  return user.flames_remaining;
}

// Award EXP and handle level-up
async function awardExp(userId, amount) {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return;
  let exp = user.exp + amount;
  let level = user.level;
  let lifetime = user.lifetime_exp + amount;
  let leveledUp = false;
  while (exp >= expForLevel(level)) {
    exp -= expForLevel(level);
    level++;
    leveledUp = true;
  }
  await db.run('UPDATE users SET exp = ?, level = ?, lifetime_exp = ? WHERE id = ?', [exp, level, lifetime, userId]);
  return { level, exp, needed: expForLevel(level), leveledUp };
}

async function awardDailyExp(userId, actionType, amount) {
  const d = today();
  const existing = await db.get('SELECT id FROM daily_reward_claims WHERE user_id = ? AND action_type = ? AND reward_date = ? AND claimed = 1', [userId, actionType, d]);
  if (existing) {
    const user = await db.get('SELECT level, exp, lifetime_exp FROM users WHERE id = ?', [userId]);
    return { awarded: false, amount: 0, level: user.level, exp: user.exp, needed: expForLevel(user.level), lifetime: user.lifetime_exp, leveledUp: false };
  }

  const result = await awardExp(userId, amount);
  await db.run('INSERT INTO daily_reward_claims (id, user_id, action_type, reward_date, last_reward_at, claimed) VALUES (?,?,?,?,?,1)', [uid(), userId, actionType, d, now()]);
  return { ...result, awarded: true, amount };
}

async function markDailyClaim(userId, actionType) {
  await db.run('INSERT INTO daily_reward_claims (id, user_id, action_type, reward_date, last_reward_at, claimed) VALUES (?,?,?,?,?,1) ON CONFLICT DO NOTHING', [uid(), userId, actionType, today(), now()]);
}

async function withBookStats(book) {
  if (!book) return null;
  let tags = [];
  try { tags = JSON.parse(book.tags || '[]'); } catch (e) { tags = []; }
  book.tags = tags;
  const flames = await db.get('SELECT COALESCE(total,0) as total FROM book_flames WHERE book_id = ?', [book.id]);
  book.flames = flames ? flames.total : 0;
  const chapterCount = await db.get('SELECT COUNT(*) as c FROM chapters WHERE book_id = ?', [book.id]);
  book.chapterCount = chapterCount ? chapterCount.c : 0;
  const viewData = await db.get('SELECT SUM(count) as t FROM daily_views WHERE book_id = ?', [book.id]);
  book.views = viewData ? (viewData.t || 0) : 0;
  const dvRows = await db.all('SELECT date, count FROM daily_views WHERE book_id = ?', [book.id]);
  book.dailyViews = {};
  dvRows.forEach(r => { book.dailyViews[r.date] = r.count; });
  book.author = book.author || book.username || '';
  delete book.username;
  return book;
}

function canReadBook(req, book) {
  return book && (book.published && book.visibility === 'public' || (req.isAuthenticated && req.isAuthenticated() && req.user.id === book.author_id));
}

// ── Passport serialization ───────────────────────────
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await db.get('SELECT id, email, username, bio, level, exp, lifetime_exp, followers, theme, avatar, banner FROM users WHERE id = ?', [id]);
    done(null, user || null);
  } catch (err) { done(err); }
});

async function findOrCreateOAuthUser(profile, provider, email) {
  const field = provider === 'google' ? 'googleId' : provider === 'facebook' ? 'facebookId' : 'twitterId';
  let user = await db.get(`SELECT * FROM users WHERE ${field} = ?`, [profile.id]);
  if (!user) {
    const id = uid();
    const username = profile.displayName || (`User_${String(profile.id).slice(-6)}`);
    await db.run(`INSERT INTO users (id, email, username, ${field}) VALUES (?, ?, ?, ?)`, [id, email || `${profile.id}@${provider}.com`, username, profile.id]);
    user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
  }
  return user;
}

// ── OAuth Strategies ─────────────────────────────────
// Each provider is only registered if its credentials are present in the
// environment. This keeps the whole app from crashing when, e.g., Google is
// not configured yet — the app still boots, and only that provider's button
// will be reported as unavailable.

let oauthConfigured = { google: !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET };

if (oauthConfigured.google) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${APP_URL}/api/auth/google/callback`
  }, async (_a, _r, profile, done) => {
    try {
      const user = await findOrCreateOAuthUser(profile, 'google', (profile.emails && profile.emails[0] && profile.emails[0].value) || '');
      return done(null, user);
    } catch (err) { return done(err); }
  }));
}

if (process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET) {
  oauthConfigured.facebook = true;
  passport.use(new FacebookStrategy({
    clientID: process.env.FACEBOOK_APP_ID,
    clientSecret: process.env.FACEBOOK_APP_SECRET,
    callbackURL: `${APP_URL}/api/auth/facebook/callback`,
    profileFields: ['id', 'displayName', 'emails']
  }, async (_a, _r, profile, done) => {
    try {
      const user = await findOrCreateOAuthUser(profile, 'facebook', (profile.emails && profile.emails[0] && profile.emails[0].value) || '');
      return done(null, user);
    } catch (err) { return done(err); }
  }));
}

if (process.env.TWITTER_CONSUMER_KEY && process.env.TWITTER_CONSUMER_SECRET) {
  oauthConfigured.twitter = true;
  passport.use(new TwitterStrategy({
    consumerKey: process.env.TWITTER_CONSUMER_KEY,
    consumerSecret: process.env.TWITTER_CONSUMER_SECRET,
    callbackURL: `${APP_URL}/api/auth/twitter/callback`,
    includeEmail: true
  }, async (_a, _r, profile, done) => {
    try {
      const user = await findOrCreateOAuthUser(profile, 'twitter', (profile.emails && profile.emails[0] && profile.emails[0].value) || '');
      return done(null, user);
    } catch (err) { return done(err); }
  }));
}

// ── Middleware ───────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Persistent sessions in Postgres so logins survive serverless cold starts.
app.use(session({
  store: new PgStore({ pool: db.pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'flowworld-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: IS_PRODUCTION,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use(passport.initialize());
app.use(passport.session());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', APP_URL);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

const requireUser = (req, res, next) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
  checkDailyReset(req.user.id).catch(() => {});
  next();
};

// ── Health check ─────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const dbOk = await db.ping();
  res.json({ ok: dbOk, db: dbOk ? 'ok' : 'error' });
});

// ── Auth Routes ──────────────────────────────────────
app.get('/api/auth/me', async (req, res) => {
  if (req.isAuthenticated()) {
    const u = await db.get('SELECT id, username, email, bio, level, exp, lifetime_exp, followers, theme, avatar, banner FROM users WHERE id = ?', [req.user.id]);
    res.json({ loggedIn: true, user: u });
  } else res.json({ loggedIn: false });
});

app.post('/api/auth/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
  const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return res.status(409).json({ error: 'Email already registered' });
  const id = uid();
  await db.run('INSERT INTO users (id, email, password, username) VALUES (?, ?, ?, ?)', [id, email, password, username]);
  const user = await db.get('SELECT id, username, email, bio, level, exp, lifetime_exp, followers, theme, avatar, banner FROM users WHERE id = ?', [id]);
  req.login(user, err => err ? res.status(500).json({ error: 'Login failed' }) : res.json({ loggedIn: true, user }));
});

app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body;
  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid email or password' });
  const safe = await db.get('SELECT id, username, email, bio, level, exp, lifetime_exp, followers, theme, avatar, banner FROM users WHERE id = ?', [user.id]);
  req.login(safe, err => err ? res.status(500).json({ error: 'Login failed' }) : res.json({ loggedIn: true, user: safe }));
});

app.post('/api/auth/signout', (req, res) => {
  req.logout(err => err ? res.status(500).json({ error: 'Logout failed' }) : res.json({ loggedIn: false }));
});

function oauthNotConfigured(provider) {
  return (req, res) => res.status(503).json({ error: `${provider} sign-in is not configured. Add the ${provider} credentials to your environment variables.` });
}

function authOrNot(configured, strategyName, authOpts, cbArgs) {
  if (configured) {
    const auth = passport.authenticate(strategyName, authOpts);
    return [auth, ...cbArgs];
  }
  return [oauthNotConfigured(strategyName.charAt(0).toUpperCase() + strategyName.slice(1))];
}

app.get('/api/auth/google', ...authOrNot(oauthConfigured.google, 'google', { scope: ['profile', 'email'], session: true }, [(req, res) => res.redirect('/#/')]));
app.get('/api/auth/google/callback', ...authOrNot(oauthConfigured.google, 'google', { failureRedirect: '/#/signin', session: true }, [(req, res) => res.redirect('/#/')]));
app.get('/api/auth/facebook', ...authOrNot(oauthConfigured.facebook, 'facebook', { scope: ['email'], session: true }, [(req, res) => res.redirect('/#/')]));
app.get('/api/auth/facebook/callback', ...authOrNot(oauthConfigured.facebook, 'facebook', { failureRedirect: '/#/signin', session: true }, [(req, res) => res.redirect('/#/')]));
app.get('/api/auth/twitter', ...authOrNot(oauthConfigured.twitter, 'twitter', { session: true }, [(req, res) => res.redirect('/#/')]));
app.get('/api/auth/twitter/callback', ...authOrNot(oauthConfigured.twitter, 'twitter', { failureRedirect: '/#/signin', session: true }, [(req, res) => res.redirect('/#/')]));

// ── User Profile API ─────────────────────────────────
app.get('/api/user/:id', async (req, res) => {
  const u = await db.get('SELECT id, username, email, bio, level, exp, lifetime_exp, followers, theme, avatar, banner FROM users WHERE id = ?', [req.params.id]);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const isOwner = req.isAuthenticated() && req.user.id === req.params.id;
  const bookCount = await db.get(`SELECT COUNT(*) as c FROM books WHERE author_id = ? ${isOwner ? '' : "AND published = 1 AND visibility = 'public'"}`, [req.params.id]);
  const flameTotal = await db.get('SELECT COALESCE(SUM(amount),0) as t FROM flame_transactions WHERE recipient_id = ?', [req.params.id]);
  res.json({ ...u, bookCount: bookCount ? bookCount.c : 0, flameTotal: flameTotal ? flameTotal.t : 0 });
});

app.put('/api/user/profile', requireUser, async (req, res) => {
  const { username, bio, avatar, banner } = req.body;
  await db.run('UPDATE users SET username=COALESCE(?,username), bio=COALESCE(?,bio), avatar=COALESCE(?,avatar), banner=COALESCE(?,banner), updated_at=? WHERE id=?', [username, bio, avatar, banner, now(), req.user.id]);
  const u = await db.get('SELECT id, username, email, bio, level, exp, lifetime_exp, followers, theme, avatar, banner FROM users WHERE id = ?', [req.user.id]);
  res.json(u);
});

app.put('/api/user/settings', requireUser, async (req, res) => {
  const { theme } = req.body;
  await db.run('UPDATE users SET theme=?, updated_at=? WHERE id=?', [theme, now(), req.user.id]);
  res.json({ theme });
});

// ── Books API ────────────────────────────────────────
app.get('/api/books', async (req, res) => {
  const { author_id } = req.query;
  let books;
  if (author_id) {
    const isOwner = req.isAuthenticated() && req.user.id === author_id;
    books = await db.all(`SELECT b.*, u.username FROM books b JOIN users u ON b.author_id = u.id WHERE b.author_id = ? ${isOwner ? '' : `AND ${publicBookWhere}`} ORDER BY b.updated_at DESC`, [author_id]);
  } else {
    books = await db.all(`SELECT b.*, u.username FROM books b JOIN users u ON b.author_id = u.id WHERE ${publicBookWhere} ORDER BY b.updated_at DESC`);
  }
  const out = [];
  for (const b of (books || [])) out.push(await withBookStats(b));
  res.json(out);
});

app.get('/api/books/:id', async (req, res) => {
  const book = await db.get('SELECT b.*, u.username FROM books b JOIN users u ON b.author_id = u.id WHERE b.id = ?', [req.params.id]);
  if (!book) return res.status(404).json({ error: 'Book not found' });
  if (!canReadBook(req, book)) return res.status(404).json({ error: 'Book not found' });
  res.json(await withBookStats(book));
});

app.post('/api/books', requireUser, async (req, res) => {
  const { title, synopsis, genre, type, tags, cover, status, visibility } = req.body;
  const id = uid();
  const nextStatus = status || 'Draft';
  const published = statusIsPublished(nextStatus) ? 1 : 0;
  await db.run('INSERT INTO books (id, author_id, title, synopsis, genre, type, tags, cover, status, visibility, published) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id, req.user.id, title || 'Untitled', synopsis || '', genre || '', type || 'Novel', JSON.stringify(tags || []), cover || '', nextStatus, visibility || 'public', published]);
  const book = await db.get('SELECT b.*, u.username FROM books b JOIN users u ON b.author_id = u.id WHERE b.id = ?', [id]);
  res.json(await withBookStats(book));
});

app.put('/api/books/:id', requireUser, async (req, res) => {
  const book = await db.get('SELECT * FROM books WHERE id = ?', [req.params.id]);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const { title, synopsis, genre, type, tags, cover, status, visibility } = req.body;
  const nextStatus = status ?? book.status;
  const published = statusIsPublished(nextStatus) ? 1 : 0;
  let tagsVal = book.tags;
  try { tagsVal = JSON.stringify(tags ?? JSON.parse(book.tags)); } catch (e) { tagsVal = book.tags; }
  await db.run('UPDATE books SET title=COALESCE(?,title), synopsis=COALESCE(?,synopsis), genre=COALESCE(?,genre), type=COALESCE(?,type), tags=?, cover=?, status=COALESCE(?,status), visibility=COALESCE(?,visibility), published=?, updated_at=? WHERE id=?', [title, synopsis, genre, type, tagsVal, cover ?? book.cover, status, visibility, published, now(), req.params.id]);
  const updated = await db.get('SELECT b.*, u.username FROM books b JOIN users u ON b.author_id = u.id WHERE b.id = ?', [req.params.id]);
  res.json(await withBookStats(updated));
});

app.delete('/api/books/:id', requireUser, async (req, res) => {
  const book = await db.get('SELECT * FROM books WHERE id = ?', [req.params.id]);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  await db.run('DELETE FROM books WHERE id = ?', [req.params.id]);
  res.json({ deleted: true });
});

app.put('/api/books/:id/publish', requireUser, async (req, res) => {
  const book = await db.get('SELECT * FROM books WHERE id = ?', [req.params.id]);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const published = book.published ? 0 : 1;
  await db.run('UPDATE books SET published=?, status=?, updated_at=? WHERE id=?', [published, published ? 'Ongoing' : 'Draft', now(), req.params.id]);
  res.json({ published: !!published });
});

app.post('/api/books/:id/view', async (req, res) => {
  const book = await db.get('SELECT * FROM books WHERE id = ?', [req.params.id]);
  if (!canReadBook(req, book)) return res.status(404).json({ error: 'Book not found' });
  const d = today();
  const amount = Math.max(1, parseInt(req.body && req.body.amount, 10) || 1);
  const row = await db.get('SELECT id, count FROM daily_views WHERE book_id = ? AND date = ?', [req.params.id, d]);
  if (row) await db.run('UPDATE daily_views SET count = count + ? WHERE id = ?', [amount, row.id]);
  else await db.run('INSERT INTO daily_views (id, book_id, date, count) VALUES (?,?,?,?)', [uid(), req.params.id, d, amount]);
  res.json({ ok: true });
});

// ── Chapters API ─────────────────────────────────────
app.get('/api/books/:bookId/chapters', async (req, res) => {
  const book = await db.get('SELECT * FROM books WHERE id = ?', [req.params.bookId]);
  if (!canReadBook(req, book)) return res.status(404).json({ error: 'Book not found' });
  const owner = req.isAuthenticated() && req.user.id === book.author_id;
  const chapters = await db.all(`SELECT id, book_id, title, published, word_count, created_at, updated_at FROM chapters WHERE book_id = ? ${owner ? '' : 'AND published = 1'} ORDER BY created_at ASC`, [req.params.bookId]);
  res.json(chapters);
});

app.get('/api/chapters/:id', async (req, res) => {
  const ch = await db.get('SELECT * FROM chapters WHERE id = ?', [req.params.id]);
  if (!ch) return res.status(404).json({ error: 'Chapter not found' });
  const book = await db.get('SELECT * FROM books WHERE id = ?', [ch.book_id]);
  const owner = req.isAuthenticated() && req.user.id === book.author_id;
  if (!canReadBook(req, book) || (!owner && !ch.published)) return res.status(404).json({ error: 'Chapter not found' });
  res.json(ch);
});

app.post('/api/books/:bookId/chapters', requireUser, async (req, res) => {
  const book = await db.get('SELECT * FROM books WHERE id = ?', [req.params.bookId]);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const { title, content, author_notes, published } = req.body;
  const id = uid();
  const wc = (content || '').length;
  await db.run('INSERT INTO chapters (id, book_id, title, content, author_notes, published, word_count) VALUES (?,?,?,?,?,?,?)', [id, req.params.bookId, title || 'Untitled', content || '', author_notes || '', published ? 1 : 0, wc]);
  await db.run('INSERT INTO chapter_revisions (id, chapter_id, title, content, version) VALUES (?,?,?,?,1)', [uid(), id, title || 'Untitled', content || '']);
  const ch = await db.get('SELECT * FROM chapters WHERE id = ?', [id]);
  res.json(ch);
});

app.put('/api/chapters/:id', requireUser, async (req, res) => {
  const ch = await db.get('SELECT * FROM chapters WHERE id = ?', [req.params.id]);
  if (!ch) return res.status(404).json({ error: 'Not found' });
  const book = await db.get('SELECT * FROM books WHERE id = ?', [ch.book_id]);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const { title, content, author_notes, published } = req.body;
  const wc = (content || '').length;
  await db.run('UPDATE chapters SET title=COALESCE(?,title), content=COALESCE(?,content), author_notes=COALESCE(?,author_notes), published=?, word_count=?, updated_at=? WHERE id=?', [title, content, author_notes, published != null ? (published ? 1 : 0) : ch.published, wc, now(), req.params.id]);
  const maxRev = await db.get('SELECT COALESCE(MAX(version),0) as v FROM chapter_revisions WHERE chapter_id = ?', [req.params.id]);
  await db.run('INSERT INTO chapter_revisions (id, chapter_id, title, content, version) VALUES (?,?,?,?,?)', [uid(), req.params.id, title || ch.title, content || ch.content, (maxRev ? maxRev.v : 0) + 1]);
  const updated = await db.get('SELECT * FROM chapters WHERE id = ?', [req.params.id]);
  res.json(updated);
});

app.delete('/api/chapters/:id', requireUser, async (req, res) => {
  const ch = await db.get('SELECT * FROM chapters WHERE id = ?', [req.params.id]);
  if (!ch) return res.status(404).json({ error: 'Not found' });
  const book = await db.get('SELECT * FROM books WHERE id = ?', [ch.book_id]);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  await db.run('DELETE FROM chapters WHERE id = ?', [req.params.id]);
  res.json({ deleted: true });
});

// ── Chapter Revisions API ────────────────────────────
app.get('/api/chapters/:chapterId/revisions', async (req, res) => {
  const revs = await db.all('SELECT id, version, created_at FROM chapter_revisions WHERE chapter_id = ? ORDER BY version DESC', [req.params.chapterId]);
  res.json(revs);
});

app.get('/api/chapters/:chapterId/revisions/:revId', async (req, res) => {
  const rev = await db.get('SELECT * FROM chapter_revisions WHERE id = ? AND chapter_id = ?', [req.params.revId, req.params.chapterId]);
  if (!rev) return res.status(404).json({ error: 'Revision not found' });
  res.json(rev);
});

app.post('/api/chapters/:chapterId/revisions/:revId/restore', requireUser, async (req, res) => {
  const ch = await db.get('SELECT * FROM chapters WHERE id = ?', [req.params.chapterId]);
  if (!ch) return res.status(404).json({ error: 'Chapter not found' });
  const book = await db.get('SELECT * FROM books WHERE id = ?', [ch.book_id]);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const rev = await db.get('SELECT * FROM chapter_revisions WHERE id = ? AND chapter_id = ?', [req.params.revId, req.params.chapterId]);
  if (!rev) return res.status(404).json({ error: 'Revision not found' });
  await db.run('UPDATE chapters SET title=?, content=?, updated_at=? WHERE id=?', [rev.title, rev.content, now(), req.params.chapterId]);
  const maxRev = await db.get('SELECT COALESCE(MAX(version),0) as v FROM chapter_revisions WHERE chapter_id = ?', [req.params.chapterId]);
  await db.run('INSERT INTO chapter_revisions (id, chapter_id, title, content, version) VALUES (?,?,?,?,?)', [uid(), req.params.chapterId, rev.title, rev.content, (maxRev ? maxRev.v : 0) + 1]);
  const updated = await db.get('SELECT * FROM chapters WHERE id = ?', [req.params.chapterId]);
  res.json(updated);
});

// ── Characters API ───────────────────────────────────
app.get('/api/books/:bookId/characters', async (req, res) => {
  const book = await db.get('SELECT * FROM books WHERE id = ?', [req.params.bookId]);
  if (!canReadBook(req, book)) return res.status(404).json({ error: 'Book not found' });
  const chars = await db.all('SELECT * FROM characters WHERE book_id = ? ORDER BY created_at ASC', [req.params.bookId]);
  res.json(chars.map(c => ({ ...c, relationships: parseRatings(c.relationships), abilities: parseRatings(c.abilities), gallery: parseRatings(c.gallery) })));
});

app.post('/api/books/:bookId/characters', requireUser, async (req, res) => {
  const book = await db.get('SELECT * FROM books WHERE id = ?', [req.params.bookId]);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const { name, nickname, age, height, weight, biography, appearance, relationships, abilities, portrait, gallery } = req.body;
  const id = uid();
  await db.run('INSERT INTO characters (id, book_id, name, nickname, age, height, weight, biography, appearance, relationships, abilities, portrait, gallery) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, req.params.bookId, name || '', nickname || '', age || '', height || '', weight || '', biography || '', appearance || '', JSON.stringify(relationships || []), JSON.stringify(abilities || []), portrait || '', JSON.stringify(gallery || [])]);
  const ch = await db.get('SELECT * FROM characters WHERE id = ?', [id]);
  ch.relationships = parseRatings(ch.relationships);
  ch.abilities = parseRatings(ch.abilities);
  ch.gallery = parseRatings(ch.gallery);
  res.json(ch);
});

app.put('/api/characters/:id', requireUser, async (req, res) => {
  const ch = await db.get('SELECT * FROM characters WHERE id = ?', [req.params.id]);
  if (!ch) return res.status(404).json({ error: 'Not found' });
  const book = await db.get('SELECT * FROM books WHERE id = ?', [ch.book_id]);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const { name, nickname, age, height, weight, biography, appearance, relationships, abilities, portrait, gallery } = req.body;
  await db.run('UPDATE characters SET name=COALESCE(?,name), nickname=COALESCE(?,nickname), age=COALESCE(?,age), height=COALESCE(?,height), weight=COALESCE(?,weight), biography=COALESCE(?,biography), appearance=COALESCE(?,appearance), relationships=?, abilities=?, portrait=COALESCE(?,portrait), gallery=?, updated_at=? WHERE id=?', [name, nickname, age, height, weight, biography, appearance, JSON.stringify(relationships ?? parseRatings(ch.relationships)), JSON.stringify(abilities ?? parseRatings(ch.abilities)), portrait, JSON.stringify(gallery ?? parseRatings(ch.gallery)), now(), req.params.id]);
  const updated = await db.get('SELECT * FROM characters WHERE id = ?', [req.params.id]);
  updated.relationships = parseRatings(updated.relationships);
  updated.abilities = parseRatings(updated.abilities);
  updated.gallery = parseRatings(updated.gallery);
  res.json(updated);
});

app.delete('/api/characters/:id', requireUser, async (req, res) => {
  const ch = await db.get('SELECT * FROM characters WHERE id = ?', [req.params.id]);
  if (!ch) return res.status(404).json({ error: 'Not found' });
  const book = await db.get('SELECT * FROM books WHERE id = ?', [ch.book_id]);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  await db.run('DELETE FROM characters WHERE id = ?', [req.params.id]);
  res.json({ deleted: true });
});

// ── Reviews API ──────────────────────────────────────
app.get('/api/books/:bookId/reviews', async (req, res) => {
  const book = await db.get('SELECT * FROM books WHERE id = ?', [req.params.bookId]);
  if (!canReadBook(req, book)) return res.status(404).json({ error: 'Book not found' });
  const reviews = await db.all('SELECT r.*, u.username FROM reviews r JOIN users u ON r.user_id = u.id WHERE r.book_id = ? ORDER BY r.pinned DESC, r.created_at DESC', [req.params.bookId]);
  res.json(reviews.map(rv => ({ ...rv, ratings: parseRatings(rv.ratings) })));
});

app.post('/api/books/:bookId/reviews', requireUser, async (req, res) => {
  const { rating, content, ratings } = req.body;
  const book = await db.get('SELECT * FROM books WHERE id = ?', [req.params.bookId]);
  if (!canReadBook(req, book)) return res.status(404).json({ error: 'Book not found' });
  const id = uid();
  await db.run('INSERT INTO reviews (id, book_id, user_id, rating, content, ratings) VALUES (?,?,?,?,?,?)', [id, req.params.bookId, req.user.id, rating || 5, content || '', JSON.stringify(ratings || {})]);
  const rev = await db.get('SELECT r.*, u.username FROM reviews r JOIN users u ON r.user_id = u.id WHERE r.id = ?', [id]);
  const reward = await awardDailyExp(req.user.id, 'daily_review', 20);
  res.json({ ...rev, ratings: parseRatings(rev.ratings), expReward: reward });
});

app.delete('/api/reviews/:id', requireUser, async (req, res) => {
  const rev = await db.get('SELECT * FROM reviews WHERE id = ?', [req.params.id]);
  if (!rev) return res.status(404).json({ error: 'Not found' });
  const book = await db.get('SELECT * FROM books WHERE id = ?', [rev.book_id]);
  if (rev.user_id !== req.user.id && (!book || book.author_id !== req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  await db.run('DELETE FROM reviews WHERE id = ?', [req.params.id]);
  res.json({ deleted: true });
});

app.put('/api/reviews/:id/pin', requireUser, async (req, res) => {
  const rev = await db.get('SELECT * FROM reviews WHERE id = ?', [req.params.id]);
  if (!rev) return res.status(404).json({ error: 'Not found' });
  const book = await db.get('SELECT * FROM books WHERE id = ?', [rev.book_id]);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const pinned = rev.pinned ? 0 : 1;
  if (pinned) await db.run('UPDATE reviews SET pinned=0 WHERE book_id=?', [rev.book_id]);
  await db.run('UPDATE reviews SET pinned=? WHERE id=?', [pinned, req.params.id]);
  res.json({ pinned: !!pinned });
});

app.put('/api/reviews/:id/like', requireUser, async (req, res) => {
  await db.run('UPDATE reviews SET likes = likes + 1 WHERE id=?', [req.params.id]);
  const rev = await db.get('SELECT likes FROM reviews WHERE id=?', [req.params.id]);
  res.json({ likes: rev.likes });
});

// ── Chapter Comments API ─────────────────────────────
app.get('/api/chapters/:chapterId/comments', async (req, res) => {
  const ch = await db.get('SELECT * FROM chapters WHERE id = ?', [req.params.chapterId]);
  if (!ch) return res.status(404).json({ error: 'Chapter not found' });
  const book = await db.get('SELECT * FROM books WHERE id = ?', [ch.book_id]);
  const owner = req.isAuthenticated() && req.user.id === book.author_id;
  if (!canReadBook(req, book) || (!owner && !ch.published)) return res.status(404).json({ error: 'Chapter not found' });
  const comments = await db.all('SELECT c.*, u.username FROM chapter_comments c JOIN users u ON c.user_id = u.id WHERE c.chapter_id = ? ORDER BY c.created_at ASC', [req.params.chapterId]);
  res.json(comments);
});

app.post('/api/chapters/:chapterId/comments', requireUser, async (req, res) => {
  const { content, paragraph_index } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
  const ch = await db.get('SELECT * FROM chapters WHERE id = ?', [req.params.chapterId]);
  if (!ch) return res.status(404).json({ error: 'Chapter not found' });
  const book = await db.get('SELECT * FROM books WHERE id = ?', [ch.book_id]);
  const owner = req.user.id === book.author_id;
  if (!canReadBook(req, book) || (!owner && !ch.published)) return res.status(404).json({ error: 'Chapter not found' });
  const id = uid();
  const pIndex = Number.isInteger(paragraph_index) ? paragraph_index : -1;
  await db.run('INSERT INTO chapter_comments (id, chapter_id, user_id, content, paragraph_index) VALUES (?,?,?,?,?)', [id, req.params.chapterId, req.user.id, content, pIndex]);
  const comment = await db.get('SELECT c.*, u.username FROM chapter_comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?', [id]);
  const firstCommentClaimed = await db.get('SELECT id FROM daily_reward_claims WHERE user_id = ? AND action_type = ? AND reward_date = ? AND claimed = 1', [req.user.id, 'daily_first_comment', today()]);
  const specificAction = pIndex >= 0 ? 'daily_paragraph_comment' : 'daily_chapter_comment';
  if (!firstCommentClaimed) await markDailyClaim(req.user.id, specificAction);
  const action = firstCommentClaimed ? specificAction : 'daily_first_comment';
  const reward = await awardDailyExp(req.user.id, action, 10);
  res.json({ ...comment, expReward: reward });
});

app.delete('/api/comments/:id', requireUser, async (req, res) => {
  const comment = await db.get('SELECT * FROM chapter_comments WHERE id = ?', [req.params.id]);
  if (!comment) return res.status(404).json({ error: 'Not found' });
  if (comment.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  await db.run('DELETE FROM chapter_comments WHERE id = ?', [req.params.id]);
  res.json({ deleted: true });
});

// ── Flames API ───────────────────────────────────────
app.get('/api/user/flames/remaining', requireUser, async (req, res) => {
  const u = await db.get('SELECT flames_remaining, level FROM users WHERE id = ?', [req.user.id]);
  res.json({ remaining: u.flames_remaining, allowance: dailyFlameAllowance(u.level), level: u.level });
});

app.get('/api/books/:bookId/flames', async (req, res) => {
  const book = await db.get('SELECT * FROM books WHERE id = ?', [req.params.bookId]);
  if (!canReadBook(req, book)) return res.status(404).json({ error: 'Book not found' });
  const row = await db.get('SELECT COALESCE(total,0) as total FROM book_flames WHERE book_id = ?', [req.params.bookId]);
  const total = row ? row.total : 0;
  res.json({ total });
});

app.post('/api/books/:bookId/flame', requireUser, async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (user.flames_remaining <= 0) return res.status(400).json({ error: 'No flames remaining today' });
  const book = await db.get('SELECT * FROM books WHERE id = ?', [req.params.bookId]);
  if (!canReadBook(req, book)) return res.status(404).json({ error: 'Book not found' });
  if (book.author_id === req.user.id) return res.status(400).json({ error: 'Cannot flame your own book' });

  const requested = Math.max(1, Math.min(parseInt(req.body.amount || '1', 10) || 1, user.flames_remaining));
  await db.transaction(async (tx) => {
    await tx.run('UPDATE users SET flames_remaining = flames_remaining - ? WHERE id = ?', [requested, req.user.id]);
    await tx.run('INSERT INTO book_flames (book_id, total) VALUES (?,?) ON CONFLICT(book_id) DO UPDATE SET total = total + excluded.total', [req.params.bookId, requested]);
    await tx.run('INSERT INTO flame_transactions (id, sender_id, recipient_id, book_id, amount) VALUES (?,?,?,?,?)', [uid(), req.user.id, book.author_id, req.params.bookId, requested]);
  });

  const reward = await awardDailyExp(req.user.id, 'daily_flame_given', 10);

  const updated = await db.get('SELECT flames_remaining FROM users WHERE id = ?', [req.user.id]);
  const bfUpdated = await db.get('SELECT COALESCE(total,0) as total FROM book_flames WHERE book_id = ?', [req.params.bookId]);
  res.json({ remaining: updated.flames_remaining, bookFlames: bfUpdated.total, given: requested, expGained: reward.amount, expReward: reward });
});

app.post('/api/chapters/:chapterId/flame', requireUser, async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (user.flames_remaining <= 0) return res.status(400).json({ error: 'No flames remaining today' });
  const ch = await db.get('SELECT * FROM chapters WHERE id = ?', [req.params.chapterId]);
  if (!ch) return res.status(404).json({ error: 'Chapter not found' });
  const book = await db.get('SELECT * FROM books WHERE id = ?', [ch.book_id]);
  if (!canReadBook(req, book) || !ch.published) return res.status(404).json({ error: 'Chapter not found' });
  if (book.author_id === req.user.id) return res.status(400).json({ error: 'Cannot flame your own book' });

  await db.transaction(async (tx) => {
    await tx.run('UPDATE users SET flames_remaining = flames_remaining - 1 WHERE id = ?', [req.user.id]);
    await tx.run('INSERT INTO book_flames (book_id, total) VALUES (?,1) ON CONFLICT(book_id) DO UPDATE SET total = total + 1', [ch.book_id]);
    await tx.run('INSERT INTO flame_transactions (id, sender_id, recipient_id, book_id, amount) VALUES (?,?,?,?,?)', [uid(), req.user.id, book.author_id, ch.book_id, 1]);
  });

  const reward = await awardDailyExp(req.user.id, 'daily_flame_given', 10);

  const updated = await db.get('SELECT flames_remaining FROM users WHERE id = ?', [req.user.id]);
  const bfUpdated = await db.get('SELECT COALESCE(total,0) as total FROM book_flames WHERE book_id = ?', [ch.book_id]);
  res.json({ remaining: updated.flames_remaining, bookFlames: bfUpdated.total, expGained: reward.amount, expReward: reward });
});

// ── EXP API ──────────────────────────────────────────
app.get('/api/user/exp', requireUser, async (req, res) => {
  const u = await db.get('SELECT level, exp, lifetime_exp FROM users WHERE id = ?', [req.user.id]);
  res.json({ level: u.level, exp: u.exp, needed: expForLevel(u.level), lifetime: u.lifetime_exp });
});

app.post('/api/user/exp/gain', requireUser, async (req, res) => {
  const { amount, reason } = req.body;
  const dailyReasons = new Set(['comment', 'chapter_comment', 'paragraph_comment', 'review', 'flame', 'read', 'daily_reading']);
  const actionType = reason === 'read' || reason === 'daily_reading' ? 'daily_reading' : `daily_${reason || 'manual'}`;
  const result = dailyReasons.has(reason) ? await awardDailyExp(req.user.id, actionType, amount || 5) : await awardExp(req.user.id, amount || 5);
  if (result.leveledUp) {
    await db.run('INSERT INTO notifications (id, user_id, type, message) VALUES (?,?,?,?)', [uid(), req.user.id, 'levelup', `Level up! You are now level ${result.level}`]);
  }
  res.json(result);
});

// ── Reading Progress API ─────────────────────────────
app.get('/api/user/progress', requireUser, async (req, res) => {
  const progress = await db.all('SELECT * FROM reading_progress WHERE user_id = ? ORDER BY last_read_at DESC', [req.user.id]);
  res.json(progress);
});

app.get('/api/user/progress/:bookId', requireUser, async (req, res) => {
  const p = await db.get('SELECT * FROM reading_progress WHERE user_id = ? AND book_id = ?', [req.user.id, req.params.bookId]);
  res.json(p || { chapter_id: '', paragraph_index: 0, completion_pct: 0 });
});

app.put('/api/user/progress/:bookId', requireUser, async (req, res) => {
  const { chapter_id, paragraph_index, completion_pct } = req.body;
  const existing = await db.get('SELECT id FROM reading_progress WHERE user_id = ? AND book_id = ?', [req.user.id, req.params.bookId]);
  if (existing) {
    await db.run('UPDATE reading_progress SET chapter_id=COALESCE(?,chapter_id), paragraph_index=COALESCE(?,paragraph_index), completion_pct=COALESCE(?,completion_pct), last_read_at=? WHERE id=?', [chapter_id, paragraph_index, completion_pct, now(), existing.id]);
  } else {
    await db.run('INSERT INTO reading_progress (id, user_id, book_id, chapter_id, paragraph_index, completion_pct) VALUES (?,?,?,?,?,?)', [uid(), req.user.id, req.params.bookId, chapter_id || '', paragraph_index || 0, completion_pct || 0]);
  }
  const updated = await db.get('SELECT * FROM reading_progress WHERE user_id = ? AND book_id = ?', [req.user.id, req.params.bookId]);
  res.json(updated);
});

// ── Notifications API ────────────────────────────────
app.get('/api/user/notifications', requireUser, async (req, res) => {
  const notifs = await db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', [req.user.id]);
  res.json(notifs);
});

app.put('/api/user/notifications/:id/read', requireUser, async (req, res) => {
  await db.run('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

app.put('/api/user/notifications/read-all', requireUser, async (req, res) => {
  await db.run('UPDATE notifications SET read = 1 WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
});

// ── Analytics API ────────────────────────────────────
app.get('/api/analytics/books/:bookId', requireUser, async (req, res) => {
  const book = await db.get('SELECT * FROM books WHERE id = ?', [req.params.bookId]);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const d = today();
  const todayViews = await db.get('SELECT COALESCE(SUM(count),0) as t FROM daily_views WHERE book_id = ? AND date = ?', [req.params.bookId, d]);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const weekViews = await db.get('SELECT COALESCE(SUM(count),0) as t FROM daily_views WHERE book_id = ? AND date >= ?', [req.params.bookId, weekAgo]);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const monthViews = await db.get('SELECT COALESCE(SUM(count),0) as t FROM daily_views WHERE book_id = ? AND date >= ?', [req.params.bookId, monthAgo]);
  const allViews = await db.get('SELECT COALESCE(SUM(count),0) as t FROM daily_views WHERE book_id = ?', [req.params.bookId]);
  const bookFlames = await db.get('SELECT COALESCE(total,0) as t FROM book_flames WHERE book_id = ?', [req.params.bookId]);
  const chapterCount = await db.get('SELECT COUNT(*) as c FROM chapters WHERE book_id = ?', [req.params.bookId]);
  const publishedCount = await db.get('SELECT COUNT(*) as c FROM chapters WHERE book_id = ? AND published = 1', [req.params.bookId]);
  res.json({
    views: { today: todayViews ? todayViews.t : 0, week: weekViews ? weekViews.t : 0, month: monthViews ? monthViews.t : 0, all: allViews ? allViews.t : 0 },
    flames: bookFlames ? bookFlames.t : 0,
    chapters: { total: chapterCount ? chapterCount.c : 0, published: publishedCount ? publishedCount.c : 0 }
  });
});

// ── Wall Posts API ───────────────────────────────────
app.post('/api/wall/:userId/post', requireUser, async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
  const id = uid();
  await db.run('INSERT INTO wall_posts (id, author_id, user_id, content) VALUES (?,?,?,?)', [id, req.user.id, req.params.userId, content]);
  const post = await db.get('SELECT p.*, u.username FROM wall_posts p JOIN users u ON p.author_id = u.id WHERE p.id = ?', [id]);
  res.json(post);
});

app.get('/api/wall/:userId/posts', async (req, res) => {
  const posts = await db.all('SELECT p.*, u.username FROM wall_posts p JOIN users u ON p.author_id = u.id WHERE p.user_id = ? ORDER BY p.created_at DESC', [req.params.userId]);
  res.json(posts);
});

app.delete('/api/wall/posts/:id', requireUser, async (req, res) => {
  const post = await db.get('SELECT * FROM wall_posts WHERE id = ?', [req.params.id]);
  if (!post) return res.status(404).json({ error: 'Not found' });
  if (post.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  await db.run('DELETE FROM wall_posts WHERE id = ?', [req.params.id]);
  res.json({ deleted: true });
});

// ── Favorites API ────────────────────────────────────
app.post('/api/favorites/:bookId', requireUser, async (req, res) => {
  const book = await db.get('SELECT * FROM books WHERE id = ?', [req.params.bookId]);
  if (!canReadBook(req, book) || book.author_id === req.user.id) return res.status(404).json({ error: 'Book not found' });
  const existing = await db.get('SELECT id FROM favorites WHERE user_id = ? AND book_id = ?', [req.user.id, req.params.bookId]);
  if (existing) {
    await db.run('DELETE FROM favorites WHERE id = ?', [existing.id]);
    res.json({ favorited: false });
  } else {
    await db.run('INSERT INTO favorites (id, user_id, book_id) VALUES (?,?,?)', [uid(), req.user.id, req.params.bookId]);
    res.json({ favorited: true });
  }
});

app.get('/api/favorites/:user', async (req, res) => {
  const favorites = await db.all("SELECT f.*, b.title FROM favorites f JOIN books b ON f.book_id = b.id WHERE f.user_id = ? AND b.published = 1 AND b.visibility = 'public'", [req.params.user]);
  res.json(favorites);
});

app.get('/api/user/favorites', requireUser, async (req, res) => {
  const books = await db.all("SELECT b.*, u.username, f.created_at as favorited_at FROM favorites f JOIN books b ON f.book_id = b.id JOIN users u ON b.author_id = u.id WHERE f.user_id = ? AND b.published = 1 AND b.visibility = 'public' ORDER BY f.created_at DESC", [req.user.id]);
  const out = [];
  for (const b of books) out.push(await withBookStats(b));
  res.json(out);
});

// ── Follows API ──────────────────────────────────────
app.post('/api/follow/:userId', requireUser, async (req, res) => {
  if (req.params.userId === req.user.id) return res.status(400).json({ error: 'Cannot follow yourself' });
  const existing = await db.get('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?', [req.user.id, req.params.userId]);
  if (existing) {
    await db.run('DELETE FROM follows WHERE id = ?', [existing.id]);
    await db.run('UPDATE users SET followers = GREATEST(0, followers - 1) WHERE id = ?', [req.params.userId]);
    res.json({ following: false });
  } else {
    await db.run('INSERT INTO follows (id, follower_id, following_id) VALUES (?,?,?)', [uid(), req.user.id, req.params.userId]);
    await db.run('UPDATE users SET followers = followers + 1 WHERE id = ?', [req.params.userId]);
    res.json({ following: true });
  }
});

app.get('/api/follow/check/:userId', requireUser, async (req, res) => {
  const existing = await db.get('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?', [req.user.id, req.params.userId]);
  res.json({ following: !!existing });
});

// ── Static files + SPA fallback ──────────────────────
// On Vercel, vercel.json routes real files (/, app.js, styles.css, manifest.json,
// Icons/*, sw.js) to Vercel's static file system with correct MIME types, and only
// /api/* and SPA deep-links reach this function. This express.static handler is for
// local development / traditional hosting where Express serves assets directly.
app.use(express.static(__dirname));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Start ────────────────────────────────────────────
if (require.main === module) {
  // Local development / traditional hosting: actually listen.
  app.listen(PORT, () => {
    console.log(`Flow World server running at ${APP_URL}`);
  });
}

// Vercel handler: export the ready Express app (never app.listen on Vercel).
module.exports = app;
