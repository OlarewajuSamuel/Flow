require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const TwitterStrategy = require('passport-twitter').Strategy;
const db = require('./db');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

// ── Helpers ──────────────────────────────────────────
const uid = () => crypto.randomUUID();
const today = () => new Date().toISOString().split('T')[0];
const now = () => new Date().toISOString();

// EXP thresholds: level * 100
const expForLevel = lvl => lvl * 100;
const dailyFlameAllowance = lvl => lvl >= 21 ? 5 : lvl >= 11 ? 4 : lvl >= 5 ? 3 : 2;

// Check & reset daily flames for a user
function checkDailyReset(userId) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return;
  if (user.last_flame_reset !== today()) {
    const allowance = dailyFlameAllowance(user.level);
    db.prepare('UPDATE users SET flames_remaining = ?, last_flame_reset = ? WHERE id = ?')
      .run(allowance, today(), userId);
    return allowance;
  }
  return user.flames_remaining;
}

// Award EXP and handle level-up
function awardExp(userId, amount) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
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
  db.prepare('UPDATE users SET exp = ?, level = ?, lifetime_exp = ?, flames_remaining = ? WHERE id = ?')
    .run(exp, level, lifetime, leveledUp ? dailyFlameAllowance(level) : user.flames_remaining, userId);
  if (leveledUp) {
    db.prepare('UPDATE users SET last_flame_reset = ? WHERE id = ?').run(today(), userId);
  }
  return { level, exp, needed: expForLevel(level), leveledUp };
}

// ── Passport serialization ───────────────────────────
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = db.prepare('SELECT id, email, username, bio, level, exp, lifetime_exp, followers, theme, avatar, banner FROM users WHERE id = ?').get(id);
  done(null, user || null);
});

function findOrCreateOAuthUser(profile, provider, email) {
  const field = provider === 'google' ? 'googleId' : provider === 'facebook' ? 'facebookId' : 'twitterId';
  let user = db.prepare(`SELECT * FROM users WHERE ${field} = ?`).get(profile.id);
  if (!user) {
    const id = uid();
    const username = profile.displayName || `User_${profile.id.slice(-6)}`;
    db.prepare(`INSERT INTO users (id, email, username, ${field}) VALUES (?, ?, ?, ?)`)
      .run(id, email || `${profile.id}@${provider}.com`, username, profile.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }
  return user;
}

// ── OAuth Strategies ─────────────────────────────────
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID || 'placeholder',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'placeholder',
  callbackURL: `${APP_URL}/api/auth/google/callback`
}, (_a,_r,_p, done) => done(null, findOrCreateOAuthUser(_p, 'google', _p.emails?.[0]?.value || ''))));

passport.use(new FacebookStrategy({
  clientID: process.env.FACEBOOK_APP_ID || 'placeholder',
  clientSecret: process.env.FACEBOOK_APP_SECRET || 'placeholder',
  callbackURL: `${APP_URL}/api/auth/facebook/callback`,
  profileFields: ['id', 'displayName', 'emails']
}, (_a,_r,_p, done) => done(null, findOrCreateOAuthUser(_p, 'facebook', _p.emails?.[0]?.value || ''))));

passport.use(new TwitterStrategy({
  consumerKey: process.env.TWITTER_CONSUMER_KEY || 'placeholder',
  consumerSecret: process.env.TWITTER_CONSUMER_SECRET || 'placeholder',
  callbackURL: `${APP_URL}/api/auth/twitter/callback`,
  includeEmail: true
}, (_a,_r,_p, done) => done(null, findOrCreateOAuthUser(_p, 'twitter', _p.emails?.[0]?.value || ''))));

// ── Middleware ────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
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
  checkDailyReset(req.user.id);
  next();
};

// ── Auth Routes ──────────────────────────────────────
app.get('/api/auth/me', (req, res) => {
  if (req.isAuthenticated()) {
    const u = db.prepare('SELECT id, username, email, bio, level, exp, lifetime_exp, followers, theme, avatar, banner FROM users WHERE id = ?').get(req.user.id);
    res.json({ loggedIn: true, user: u });
  } else res.json({ loggedIn: false });
});

app.post('/api/auth/signup', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });
  const id = uid();
  db.prepare('INSERT INTO users (id, email, password, username) VALUES (?, ?, ?, ?)').run(id, email, password, username);
  const user = db.prepare('SELECT id, username, email, bio, level, exp, lifetime_exp, followers, theme, avatar, banner FROM users WHERE id = ?').get(id);
  req.login(user, err => err ? res.status(500).json({ error: 'Login failed' }) : res.json({ loggedIn: true, user }));
});

app.post('/api/auth/signin', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid email or password' });
  const safe = db.prepare('SELECT id, username, email, bio, level, exp, lifetime_exp, followers, theme, avatar, banner FROM users WHERE id = ?').get(user.id);
  req.login(safe, err => err ? res.status(500).json({ error: 'Login failed' }) : res.json({ loggedIn: true, user: safe }));
});

app.post('/api/auth/signout', (req, res) => {
  req.logout(err => err ? res.status(500).json({ error: 'Logout failed' }) : res.json({ loggedIn: false }));
});

app.get('/api/auth/google', passport.authenticate('google', { scope: ['profile', 'email'], session: true }));
app.get('/api/auth/google/callback', passport.authenticate('google', { failureRedirect: '/#/signin' }), (req, res) => res.redirect('/#/'));
app.get('/api/auth/facebook', passport.authenticate('facebook', { scope: ['email'], session: true }));
app.get('/api/auth/facebook/callback', passport.authenticate('facebook', { failureRedirect: '/#/signin' }), (req, res) => res.redirect('/#/'));
app.get('/api/auth/twitter', passport.authenticate('twitter', { session: true }));
app.get('/api/auth/twitter/callback', passport.authenticate('twitter', { failureRedirect: '/#/signin' }), (req, res) => res.redirect('/#/'));

// ── User Profile API ─────────────────────────────────
app.get('/api/user/:id', (req, res) => {
  const u = db.prepare('SELECT id, username, email, bio, level, exp, lifetime_exp, followers, theme, avatar, banner FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const bookCount = db.prepare('SELECT COUNT(*) as c FROM books WHERE author_id = ?').get(req.params.id).c;
  const flameTotal = db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM flame_transactions WHERE recipient_id = ?').get(req.params.id).t;
  res.json({ ...u, bookCount, flameTotal });
});

app.put('/api/user/profile', requireUser, (req, res) => {
  const { username, bio, avatar, banner } = req.body;
  db.prepare('UPDATE users SET username=COALESCE(?,username), bio=COALESCE(?,bio), avatar=COALESCE(?,avatar), banner=COALESCE(?,banner), updated_at=? WHERE id=?')
    .run(username, bio, avatar, banner, now(), req.user.id);
  const u = db.prepare('SELECT id, username, email, bio, level, exp, lifetime_exp, followers, theme, avatar, banner FROM users WHERE id = ?').get(req.user.id);
  res.json(u);
});

app.put('/api/user/settings', requireUser, (req, res) => {
  const { theme } = req.body;
  db.prepare('UPDATE users SET theme=?, updated_at=? WHERE id=?').run(theme, now(), req.user.id);
  res.json({ theme });
});

// ── Books API ────────────────────────────────────────
app.get('/api/books', (req, res) => {
  const { author_id } = req.query;
  let books;
  if (author_id) books = db.prepare('SELECT * FROM books WHERE author_id = ? ORDER BY updated_at DESC').all(author_id);
  else books = db.prepare('SELECT * FROM books WHERE published = 1 AND visibility = "public" ORDER BY updated_at DESC').all();
  res.json(books.map(b => ({ ...b, tags: JSON.parse(b.tags || '[]') })));
});

app.get('/api/books/:id', (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!book) return res.status(404).json({ error: 'Book not found' });
  book.tags = JSON.parse(book.tags || '[]');
  const flames = db.prepare('SELECT COALESCE(total,0) as total FROM book_flames WHERE book_id = ?').get(book.id);
  book.flames = flames.total;
  const chapterCount = db.prepare('SELECT COUNT(*) as c FROM chapters WHERE book_id = ?').get(book.id).c;
  book.chapterCount = chapterCount;
  const viewData = db.prepare('SELECT SUM(count) as t FROM daily_views WHERE book_id = ?').get(book.id);
  book.views = viewData ? (viewData.t || 0) : 0;
  res.json(book);
});

app.post('/api/books', requireUser, (req, res) => {
  const { title, synopsis, genre, type, tags, cover, status, visibility } = req.body;
  const id = uid();
  db.prepare('INSERT INTO books (id, author_id, title, synopsis, genre, type, tags, cover, status, visibility) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.user.id, title || 'Untitled', synopsis || '', genre || '', type || 'novel', JSON.stringify(tags || []), cover || '', status || 'ongoing', visibility || 'public');
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(id);
  book.tags = JSON.parse(book.tags || '[]');
  res.json(book);
});

app.put('/api/books/:id', requireUser, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const { title, synopsis, genre, type, tags, cover, status, visibility } = req.body;
  db.prepare('UPDATE books SET title=COALESCE(?,title), synopsis=COALESCE(?,synopsis), genre=COALESCE(?,genre), type=COALESCE(?,type), tags=?, cover=COALESCE(?,cover), status=COALESCE(?,status), visibility=COALESCE(?,visibility), updated_at=? WHERE id=?')
    .run(title, synopsis, genre, type, JSON.stringify(tags ?? JSON.parse(book.tags)), cover, status, visibility, now(), req.params.id);
  const updated = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  updated.tags = JSON.parse(updated.tags || '[]');
  res.json(updated);
});

app.delete('/api/books/:id', requireUser, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM books WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

app.put('/api/books/:id/publish', requireUser, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.id);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const published = book.published ? 0 : 1;
  db.prepare('UPDATE books SET published=?, updated_at=? WHERE id=?').run(published, now(), req.params.id);
  res.json({ published: !!published });
});

app.post('/api/books/:id/view', (req, res) => {
  const d = today();
  const row = db.prepare('SELECT id, count FROM daily_views WHERE book_id = ? AND date = ?').get(req.params.id, d);
  if (row) db.prepare('UPDATE daily_views SET count = count + 1 WHERE id = ?').run(row.id);
  else db.prepare('INSERT INTO daily_views (book_id, date) VALUES (?,?)').run(req.params.id, d);
  res.json({ ok: true });
});

// ── Chapters API ─────────────────────────────────────
app.get('/api/books/:bookId/chapters', (req, res) => {
  const chapters = db.prepare('SELECT id, book_id, title, published, word_count, created_at, updated_at FROM chapters WHERE book_id = ? ORDER BY created_at ASC').all(req.params.bookId);
  res.json(chapters);
});

app.get('/api/chapters/:id', (req, res) => {
  const ch = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Chapter not found' });
  res.json(ch);
});

app.post('/api/books/:bookId/chapters', requireUser, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.bookId);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const { title, content, author_notes, published } = req.body;
  const id = uid();
  const wc = (content || '').length;
  db.prepare('INSERT INTO chapters (id, book_id, title, content, author_notes, published, word_count) VALUES (?,?,?,?,?,?,?)')
    .run(id, req.params.bookId, title || 'Untitled', content || '', author_notes || '', published ? 1 : 0, wc);
  // Save first revision
  db.prepare('INSERT INTO chapter_revisions (id, chapter_id, title, content, version) VALUES (?,?,?,?,1)')
    .run(uid(), id, title || 'Untitled', content || '');
  const ch = db.prepare('SELECT * FROM chapters WHERE id = ?').get(id);
  res.json(ch);
});

app.put('/api/chapters/:id', requireUser, (req, res) => {
  const ch = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Not found' });
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(ch.book_id);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const { title, content, author_notes, published } = req.body;
  const wc = (content || '').length;
  db.prepare('UPDATE chapters SET title=COALESCE(?,title), content=COALESCE(?,content), author_notes=COALESCE(?,author_notes), published=COALESCE(?,published), word_count=?, updated_at=? WHERE id=?')
    .run(title, content, author_notes, published != null ? (published ? 1 : 0) : undefined, wc, now(), req.params.id);
  // Auto-save revision version
  const maxRev = db.prepare('SELECT COALESCE(MAX(version),0) as v FROM chapter_revisions WHERE chapter_id = ?').get(req.params.id);
  db.prepare('INSERT INTO chapter_revisions (id, chapter_id, title, content, version) VALUES (?,?,?,?,?)')
    .run(uid(), req.params.id, title || ch.title, content || ch.content, maxRev.v + 1);
  const updated = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.id);
  res.json(updated);
});

app.delete('/api/chapters/:id', requireUser, (req, res) => {
  const ch = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Not found' });
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(ch.book_id);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM chapters WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// ── Chapter Revisions API ────────────────────────────
app.get('/api/chapters/:chapterId/revisions', (req, res) => {
  const revs = db.prepare('SELECT id, version, created_at FROM chapter_revisions WHERE chapter_id = ? ORDER BY version DESC').all(req.params.chapterId);
  res.json(revs);
});

app.get('/api/chapters/:chapterId/revisions/:revId', (req, res) => {
  const rev = db.prepare('SELECT * FROM chapter_revisions WHERE id = ? AND chapter_id = ?').get(req.params.revId, req.params.chapterId);
  if (!rev) return res.status(404).json({ error: 'Revision not found' });
  res.json(rev);
});

app.post('/api/chapters/:chapterId/revisions/:revId/restore', requireUser, (req, res) => {
  const ch = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.chapterId);
  if (!ch) return res.status(404).json({ error: 'Chapter not found' });
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(ch.book_id);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const rev = db.prepare('SELECT * FROM chapter_revisions WHERE id = ? AND chapter_id = ?').get(req.params.revId, req.params.chapterId);
  if (!rev) return res.status(404).json({ error: 'Revision not found' });
  db.prepare('UPDATE chapters SET title=?, content=?, updated_at=? WHERE id=?').run(rev.title, rev.content, now(), req.params.chapterId);
  // Save a new revision marking the restore
  const maxRev = db.prepare('SELECT COALESCE(MAX(version),0) as v FROM chapter_revisions WHERE chapter_id = ?').get(req.params.chapterId);
  db.prepare('INSERT INTO chapter_revisions (id, chapter_id, title, content, version) VALUES (?,?,?,?,?)')
    .run(uid(), req.params.chapterId, rev.title, rev.content, maxRev.v + 1);
  const updated = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.chapterId);
  res.json(updated);
});

// ── Characters API ───────────────────────────────────
app.get('/api/books/:bookId/characters', (req, res) => {
  const chars = db.prepare('SELECT * FROM characters WHERE book_id = ? ORDER BY created_at ASC').all(req.params.bookId);
  res.json(chars.map(c => ({ ...c, relationships: JSON.parse(c.relationships || '[]'), abilities: JSON.parse(c.abilities || '[]'), gallery: JSON.parse(c.gallery || '[]') })));
});

app.post('/api/books/:bookId/characters', requireUser, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.bookId);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const { name, biography, appearance, relationships, abilities, portrait, gallery } = req.body;
  const id = uid();
  db.prepare('INSERT INTO characters (id, book_id, name, biography, appearance, relationships, abilities, portrait, gallery) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.params.bookId, name || '', biography || '', appearance || '', JSON.stringify(relationships || []), JSON.stringify(abilities || []), portrait || '', JSON.stringify(gallery || []));
  const ch = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
  ch.relationships = JSON.parse(ch.relationships || '[]');
  ch.abilities = JSON.parse(ch.abilities || '[]');
  ch.gallery = JSON.parse(ch.gallery || '[]');
  res.json(ch);
});

app.put('/api/characters/:id', requireUser, (req, res) => {
  const ch = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Not found' });
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(ch.book_id);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const { name, biography, appearance, relationships, abilities, portrait, gallery } = req.body;
  db.prepare('UPDATE characters SET name=COALESCE(?,name), biography=COALESCE(?,biography), appearance=COALESCE(?,appearance), relationships=?, abilities=?, portrait=COALESCE(?,portrait), gallery=?, updated_at=? WHERE id=?')
    .run(name, biography, appearance, JSON.stringify(relationships ?? JSON.parse(ch.relationships)), JSON.stringify(abilities ?? JSON.parse(ch.abilities)), portrait, JSON.stringify(gallery ?? JSON.parse(ch.gallery)), now(), req.params.id);
  const updated = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  updated.relationships = JSON.parse(updated.relationships || '[]');
  updated.abilities = JSON.parse(updated.abilities || '[]');
  updated.gallery = JSON.parse(updated.gallery || '[]');
  res.json(updated);
});

app.delete('/api/characters/:id', requireUser, (req, res) => {
  const ch = db.prepare('SELECT * FROM characters WHERE id = ?').get(req.params.id);
  if (!ch) return res.status(404).json({ error: 'Not found' });
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(ch.book_id);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM characters WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// ── Reviews API ──────────────────────────────────────
app.get('/api/books/:bookId/reviews', (req, res) => {
  const reviews = db.prepare('SELECT r.*, u.username FROM reviews r JOIN users u ON r.user_id = u.id WHERE r.book_id = ? ORDER BY r.pinned DESC, r.created_at DESC').all(req.params.bookId);
  res.json(reviews);
});

app.post('/api/books/:bookId/reviews', requireUser, (req, res) => {
  const { rating, content } = req.body;
  const id = uid();
  db.prepare('INSERT INTO reviews (id, book_id, user_id, rating, content) VALUES (?,?,?,?,?)')
    .run(id, req.params.bookId, req.user.id, rating || 5, content || '');
  const rev = db.prepare('SELECT r.*, u.username FROM reviews r JOIN users u ON r.user_id = u.id WHERE r.id = ?').get(id);
  // Award EXP for review
  awardExp(req.user.id, 20);
  res.json(rev);
});

app.delete('/api/reviews/:id', requireUser, (req, res) => {
  const rev = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!rev) return res.status(404).json({ error: 'Not found' });
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(rev.book_id);
  if (rev.user_id !== req.user.id && (!book || book.author_id !== req.user.id)) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

app.put('/api/reviews/:id/pin', requireUser, (req, res) => {
  const rev = db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.id);
  if (!rev) return res.status(404).json({ error: 'Not found' });
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(rev.book_id);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const pinned = rev.pinned ? 0 : 1;
  if (pinned) db.prepare('UPDATE reviews SET pinned=0 WHERE book_id=?').run(rev.book_id);
  db.prepare('UPDATE reviews SET pinned=? WHERE id=?').run(pinned, req.params.id);
  res.json({ pinned: !!pinned });
});

app.put('/api/reviews/:id/like', requireUser, (req, res) => {
  db.prepare('UPDATE reviews SET likes = likes + 1 WHERE id=?').run(req.params.id);
  const rev = db.prepare('SELECT likes FROM reviews WHERE id=?').get(req.params.id);
  res.json({ likes: rev.likes });
});

// ── Chapter Comments API ─────────────────────────────
app.get('/api/chapters/:chapterId/comments', (req, res) => {
  const comments = db.prepare('SELECT c.*, u.username FROM chapter_comments c JOIN users u ON c.user_id = u.id WHERE c.chapter_id = ? ORDER BY c.created_at ASC').all(req.params.chapterId);
  res.json(comments);
});

app.post('/api/chapters/:chapterId/comments', requireUser, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
  const id = uid();
  db.prepare('INSERT INTO chapter_comments (id, chapter_id, user_id, content) VALUES (?,?,?,?)')
    .run(id, req.params.chapterId, req.user.id, content);
  const comment = db.prepare('SELECT c.*, u.username FROM chapter_comments c JOIN users u ON c.user_id = u.id WHERE c.id = ?').get(id);
  awardExp(req.user.id, 10);
  res.json(comment);
});

app.delete('/api/comments/:id', requireUser, (req, res) => {
  const comment = db.prepare('SELECT * FROM chapter_comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: 'Not found' });
  if (comment.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM chapter_comments WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// ── Flames API ───────────────────────────────────────
app.get('/api/user/flames/remaining', requireUser, (req, res) => {
  const u = db.prepare('SELECT flames_remaining, level FROM users WHERE id = ?').get(req.user.id);
  res.json({ remaining: u.flames_remaining, allowance: dailyFlameAllowance(u.level), level: u.level });
});

app.get('/api/books/:bookId/flames', (req, res) => {
  const row = db.prepare('SELECT COALESCE(total,0) as total FROM book_flames WHERE book_id = ?').get(req.params.bookId);
  const total = row ? row.total : 0;
  res.json({ total });
});

app.post('/api/books/:bookId/flame', requireUser, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.flames_remaining <= 0) return res.status(400).json({ error: 'No flames remaining today' });
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.bookId);
  if (!book) return res.status(404).json({ error: 'Book not found' });
  if (book.author_id === req.user.id) return res.status(400).json({ error: 'Cannot flame your own book' });

  const amount = user.flames_remaining;
  db.prepare('UPDATE users SET flames_remaining = 0 WHERE id = ?').run(req.user.id);

  // Add book flames
  const bf = db.prepare('SELECT total FROM book_flames WHERE book_id = ?').get(req.params.bookId);
  if (bf) db.prepare('UPDATE book_flames SET total = total + ? WHERE book_id = ?').run(amount, req.params.bookId);
  else db.prepare('INSERT INTO book_flames (book_id, total) VALUES (?,?)').run(req.params.bookId, amount);

  // Record transactions
  const txId = uid();
  db.prepare('INSERT INTO flame_transactions (id, sender_id, recipient_id, book_id, amount) VALUES (?,?,?,?,?)')
    .run(txId, req.user.id, book.author_id, req.params.bookId, amount);

  // Award EXP: +10 per flame
  awardExp(req.user.id, amount * 10);

  const updated = db.prepare('SELECT flames_remaining FROM users WHERE id = ?').get(req.user.id);
  const bfUpdated = db.prepare('SELECT COALESCE(total,0) as total FROM book_flames WHERE book_id = ?').get(req.params.bookId);
  res.json({ remaining: updated.flames_remaining, bookFlames: bfUpdated.total, given: amount, expGained: amount * 10 });
});

app.post('/api/chapters/:chapterId/flame', requireUser, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.flames_remaining <= 0) return res.status(400).json({ error: 'No flames remaining today' });
  const ch = db.prepare('SELECT * FROM chapters WHERE id = ?').get(req.params.chapterId);
  if (!ch) return res.status(404).json({ error: 'Chapter not found' });
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(ch.book_id);
  if (book.author_id === req.user.id) return res.status(400).json({ error: 'Cannot flame your own book' });

  db.prepare('UPDATE users SET flames_remaining = flames_remaining - 1 WHERE id = ?').run(req.user.id);

  const bf = db.prepare('SELECT total FROM book_flames WHERE book_id = ?').get(ch.book_id);
  if (bf) db.prepare('UPDATE book_flames SET total = total + 1 WHERE book_id = ?').run(ch.book_id);
  else db.prepare('INSERT INTO book_flames (book_id, total) VALUES (?,1)').run(ch.book_id);

  db.prepare('INSERT INTO flame_transactions (id, sender_id, recipient_id, book_id, amount) VALUES (?,?,?,?,?)')
    .run(uid(), req.user.id, book.author_id, ch.book_id, 1);

  awardExp(req.user.id, 10);

  const updated = db.prepare('SELECT flames_remaining FROM users WHERE id = ?').get(req.user.id);
  const bfUpdated = db.prepare('SELECT COALESCE(total,0) as total FROM book_flames WHERE book_id = ?').get(ch.book_id);
  res.json({ remaining: updated.flames_remaining, bookFlames: bfUpdated.total });
});

// ── EXP API ──────────────────────────────────────────
app.get('/api/user/exp', requireUser, (req, res) => {
  const u = db.prepare('SELECT level, exp, lifetime_exp FROM users WHERE id = ?').get(req.user.id);
  res.json({ level: u.level, exp: u.exp, needed: expForLevel(u.level), lifetime: u.lifetime_exp });
});

app.post('/api/user/exp/gain', requireUser, (req, res) => {
  const { amount, reason } = req.body;
  const result = awardExp(req.user.id, amount || 5);
  // Create notification on level up
  if (result.leveledUp) {
    db.prepare('INSERT INTO notifications (id, user_id, type, message) VALUES (?,?,?,?)')
      .run(uid(), req.user.id, 'levelup', `Level up! You are now level ${result.level}`);
  }
  res.json(result);
});

// ── Reading Progress API ─────────────────────────────
app.get('/api/user/progress', requireUser, (req, res) => {
  const progress = db.prepare('SELECT * FROM reading_progress WHERE user_id = ? ORDER BY last_read_at DESC').all(req.user.id);
  res.json(progress);
});

app.get('/api/user/progress/:bookId', requireUser, (req, res) => {
  const p = db.prepare('SELECT * FROM reading_progress WHERE user_id = ? AND book_id = ?').get(req.user.id, req.params.bookId);
  res.json(p || { chapter_id: '', paragraph_index: 0, completion_pct: 0 });
});

app.put('/api/user/progress/:bookId', requireUser, (req, res) => {
  const { chapter_id, paragraph_index, completion_pct } = req.body;
  const existing = db.prepare('SELECT id FROM reading_progress WHERE user_id = ? AND book_id = ?').get(req.user.id, req.params.bookId);
  if (existing) {
    db.prepare('UPDATE reading_progress SET chapter_id=COALESCE(?,chapter_id), paragraph_index=COALESCE(?,paragraph_index), completion_pct=COALESCE(?,completion_pct), last_read_at=? WHERE id=?')
      .run(chapter_id, paragraph_index, completion_pct, now(), existing.id);
  } else {
    db.prepare('INSERT INTO reading_progress (id, user_id, book_id, chapter_id, paragraph_index, completion_pct) VALUES (?,?,?,?,?,?)')
      .run(uid(), req.user.id, req.params.bookId, chapter_id || '', paragraph_index || 0, completion_pct || 0);
  }
  const updated = db.prepare('SELECT * FROM reading_progress WHERE user_id = ? AND book_id = ?').get(req.user.id, req.params.bookId);
  res.json(updated);
});

// ── Notifications API ────────────────────────────────
app.get('/api/user/notifications', requireUser, (req, res) => {
  const notifs = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  res.json(notifs);
});

app.put('/api/user/notifications/:id/read', requireUser, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.put('/api/user/notifications/read-all', requireUser, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

// ── Analytics API ────────────────────────────────────
app.get('/api/analytics/books/:bookId', requireUser, (req, res) => {
  const book = db.prepare('SELECT * FROM books WHERE id = ?').get(req.params.bookId);
  if (!book || book.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const d = today();
  const todayViews = db.prepare('SELECT COALESCE(SUM(count),0) as t FROM daily_views WHERE book_id = ? AND date = ?').get(req.params.bookId, d).t;
  const weekAgo = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
  const weekViews = db.prepare('SELECT COALESCE(SUM(count),0) as t FROM daily_views WHERE book_id = ? AND date >= ?').get(req.params.bookId, weekAgo).t;
  const monthAgo = new Date(Date.now() - 30*86400000).toISOString().split('T')[0];
  const monthViews = db.prepare('SELECT COALESCE(SUM(count),0) as t FROM daily_views WHERE book_id = ? AND date >= ?').get(req.params.bookId, monthAgo).t;
  const allViews = db.prepare('SELECT COALESCE(SUM(count),0) as t FROM daily_views WHERE book_id = ?').get(req.params.bookId).t;
  const bookFlames = db.prepare('SELECT COALESCE(total,0) as t FROM book_flames WHERE book_id = ?').get(req.params.bookId);
  const chapterCount = db.prepare('SELECT COUNT(*) as c FROM chapters WHERE book_id = ?').get(req.params.bookId).c;
  const publishedCount = db.prepare('SELECT COUNT(*) as c FROM chapters WHERE book_id = ? AND published = 1').get(req.params.bookId).c;
  res.json({
    views: { today: todayViews, week: weekViews, month: monthViews, all: allViews },
    flames: bookFlames ? bookFlames.t : 0,
    chapters: { total: chapterCount, published: publishedCount }
  });
});

// ── Wall Posts API ───────────────────────────────────
app.post('/api/wall/:userId/post', requireUser, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content required' });
  const id = uid();
  db.prepare('INSERT INTO wall_posts (id, author_id, user_id, content) VALUES (?,?,?,?)')
    .run(id, req.user.id, req.params.userId, content);
  const post = db.prepare('SELECT p.*, u.username FROM wall_posts p JOIN users u ON p.author_id = u.id WHERE p.id = ?').get(id);
  res.json(post);
});

app.get('/api/wall/:userId/posts', (req, res) => {
  const posts = db.prepare('SELECT p.*, u.username FROM wall_posts p JOIN users u ON p.author_id = u.id WHERE p.user_id = ? ORDER BY p.created_at DESC').all(req.params.userId);
  res.json(posts);
});

app.delete('/api/wall/posts/:id', requireUser, (req, res) => {
  const post = db.prepare('SELECT * FROM wall_posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  if (post.author_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM wall_posts WHERE id = ?').run(req.params.id);
  res.json({ deleted: true });
});

// ── Favorites API ────────────────────────────────────
app.post('/api/favorites/:bookId', requireUser, (req, res) => {
  const existing = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND book_id = ?').get(req.user.id, req.params.bookId);
  if (existing) {
    db.prepare('DELETE FROM favorites WHERE id = ?').run(existing.id);
    res.json({ favorited: false });
  } else {
    db.prepare('INSERT INTO favorites (id, user_id, book_id) VALUES (?,?,?)').run(uid(), req.user.id, req.params.bookId);
    res.json({ favorited: true });
  }
});

app.get('/api/favorites/:user', (req, res) => {
  const favorites = db.prepare('SELECT f.*, b.title FROM favorites f JOIN books b ON f.book_id = b.id WHERE f.user_id = ?').all(req.params.user);
  res.json(favorites);
});

app.get('/api/user/favorites', requireUser, (req, res) => {
  const books = db.prepare('SELECT b.*, f.created_at as favorited_at FROM favorites f JOIN books b ON f.book_id = b.id WHERE f.user_id = ? ORDER BY f.created_at DESC').all(req.user.id);
  res.json(books.map(b => ({ ...b, tags: JSON.parse(b.tags || '[]') })));
});

// ── Follows API ──────────────────────────────────────
app.post('/api/follow/:userId', requireUser, (req, res) => {
  if (req.params.userId === req.user.id) return res.status(400).json({ error: 'Cannot follow yourself' });
  const existing = db.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, req.params.userId);
  if (existing) {
    db.prepare('DELETE FROM follows WHERE id = ?').run(existing.id);
    db.prepare('UPDATE users SET followers = MAX(0, followers - 1) WHERE id = ?').run(req.params.userId);
    res.json({ following: false });
  } else {
    db.prepare('INSERT INTO follows (id, follower_id, following_id) VALUES (?,?,?)').run(uid(), req.user.id, req.params.userId);
    db.prepare('UPDATE users SET followers = followers + 1 WHERE id = ?').run(req.params.userId);
    res.json({ following: true });
  }
});

app.get('/api/follow/check/:userId', requireUser, (req, res) => {
  const existing = db.prepare('SELECT id FROM follows WHERE follower_id = ? AND following_id = ?').get(req.user.id, req.params.userId);
  res.json({ following: !!existing });
});

// ── Static files ─────────────────────────────────────
app.use(express.static(__dirname));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── Start ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Flow World server running at ${APP_URL}`);
});
