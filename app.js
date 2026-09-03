// ============================================================
// GENRES & TAGS (predefined categories, not database content)
// ============================================================
const GENRES = ['Fantasy','Sci-Fi','Action','Romance','Horror','Mystery','Adventure','Comedy','Drama','Thriller'];
const TAGS = ['System','Magic','Reincarnation','Academy','Kingdom Building','Apocalypse','Cultivation','Martial Arts','Survival','Mystery','Adventure','Romance','Comedy','Tragedy','Slice of Life'];

// ============================================================
// STATE & ACCOUNTS (persisted to localStorage)
// ============================================================
function getAccounts() {
  try {
    const a = localStorage.getItem('novelAccounts');
    if (a) return JSON.parse(a);
  } catch (e) {}
  return {};
}

function saveAccounts() {
  try { localStorage.setItem('novelAccounts', JSON.stringify(accounts)); } catch (e) {}
}

function getState() {
  const defaults = {
    theme: 'dark',
    loggedIn: false,
    user: { username: 'Guest', bio: '', level: 1, exp: 0, lifetime_exp: 0, rank: 0, followers: 0, email: '', avatar: '', banner: '', website: '', discord: '', twitter: '', facebook: '', joinDate: '' },
    books: [],
    chapters: {},
    characters: {},
    favorites: [],
    flames: {},
    following: [],
    wallPosts: [],
    profileComments: [],
    supporterHistory: [],
    notifications: [],
    messages: [],
    flameDate: '',
    flamesGiven: 0,
    flameAllowance: 2,
    flamesRemaining: 2,
    reviews: {},
    chapterComments: {},
    chapterHighlights: {},
    chapterReactions: {},
    readingProgress: [],
    achievements: {},
    readerFontSize: 1,
    readerScrollMode: 'continuous',
    readerPageIndex: 0,
    readsTotal: 0,
    writeStreak: 0,
    lastWriteDate: '',
    writeDates: [],
    dayWords: {},
    achFlags: {},
  };
  try {
    const saved = localStorage.getItem('novelState');
    if (saved) return { ...defaults, ...JSON.parse(saved), user: { ...defaults.user, ...JSON.parse(saved).user } };
  } catch (e) {}
  return defaults;
}

function saveState() {
  try { localStorage.setItem('novelState', JSON.stringify(state)); } catch (e) {}
}

let state = getState();
let accounts = getAccounts();

function loginAs(email) {
  const acct = accounts[email];
  if (!acct) return;
  state.loggedIn = true;
  state.user = { ...state.user, ...acct.profile, email, username: acct.username };
  saveState();
}

function logoutUser() {
  state.loggedIn = false;
  state.user = { username: 'Guest', bio: '', level: 1, rank: 0, followers: 0, email: '' };
  saveState();
}

// Backend API helper
const API_BASE = '';
async function apiFetch(path, opts = {}) {
  try {
    const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...opts });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

let serverOnline = false;
async function checkServer() {
  const data = await apiFetch('/api/auth/me');
  serverOnline = data !== null;
  return serverOnline;
}

// Try backend auth; fall back to localStorage
async function initAuth() {
  const data = await apiFetch('/api/auth/me');
  if (data && data.loggedIn) {
    serverOnline = true;
    state.loggedIn = true;
    state.user = { ...state.user, ...data.user };
    saveState();
    // Load user data from server
    loadServerData();
    return;
  }
  if (state.loggedIn && state.user.email && accounts[state.user.email]) {
    loginAs(state.user.email);
  }
}

// Merge per-day view maps (date -> count), keeping the higher count per day so
// local (offline) traffic never regresses when server stats are loaded.
function mergeDailyViews(a, b) {
  const aD = a || {}, bD = b || {};
  const days = new Set([...Object.keys(aD), ...Object.keys(bD)]);
  const out = {};
  days.forEach(k => { out[k] = Math.max(aD[k] || 0, bD[k] || 0); });
  return out;
}

// Merge server book stats into the existing local book so running counters
// (views, dailyViews) keep increasing instead of being reset by a sync.
function mergeServerBook(book) {
  const nb = normalizeServerBook(book);
  const existing = state.books.find(b => b.id === book.id);
  if (!existing) { if (!nb.dailyViews) nb.dailyViews = {}; return nb; }
  nb.views = Math.max(existing.views || 0, nb.views || 0);
  nb.dailyViews = mergeDailyViews(existing.dailyViews, book.dailyViews);
  nb.favorites = existing.favorites || nb.favorites || 0;
  nb.flames = Math.max(existing.flames || 0, nb.flames ?? existing.flames ?? 0);
  return nb;
}

// ── Server data sync ────────────────────────────
async function loadServerData() {
  if (!serverOnline) return;
  // Load public books plus the signed-in author's private workspace books.
  const publicBooks = await apiFetch('/api/books');
  const ownBooks = state.user.id ? await apiFetch(`/api/books?author_id=${state.user.id}`) : [];
  const mergedBooks = [...(publicBooks || []), ...(ownBooks || [])].reduce((map, book) => {
    map.set(book.id, mergeServerBook(book));
    return map;
  }, new Map());
  const books = [...mergedBooks.values()];
  if (books && Array.isArray(books)) {
    state.books = books;
    // Load chapters for each book
    for (const book of books) {
      const chapters = await apiFetch(`/api/books/${book.id}/chapters`);
      if (chapters && Array.isArray(chapters)) state.chapters[book.id] = chapters;
      const chars = await apiFetch(`/api/books/${book.id}/characters`);
      if (chars && Array.isArray(chars)) state.characters[book.id] = chars.map(c => ({ ...c, image: c.image || c.portrait || '', description: c.description || c.biography || '' }));
      // Load reviews
      const reviews = await apiFetch(`/api/books/${book.id}/reviews`);
      if (reviews && Array.isArray(reviews)) state.reviews[book.id] = reviews.map(rv => ({ ...rv, ratings: parseRatings(rv.ratings) }));
      // Load flames
      const f = await apiFetch(`/api/books/${book.id}/flames`);
      if (f) {
        book.serverFlames = f.total;
        book.flames = f.total;
      }
    }
  }
  // Load user profile
  const userData = await apiFetch(`/api/user/${state.user.id}`);
  if (userData) {
    state.user.level = userData.level;
    state.user.exp = userData.exp;
    state.user.lifetime_exp = userData.lifetime_exp;
    state.user.followers = userData.followers;
    if (userData.avatar) state.user.avatar = userData.avatar;
    if (userData.banner) state.user.banner = userData.banner;
    if (userData.bio && !state.user.bio) state.user.bio = userData.bio;
  }
  // Load exp info
  const expData = await apiFetch('/api/user/exp');
  if (expData) {
    state.user.level = expData.level;
    state.user.exp = expData.exp;
    state.user.lifetime_exp = expData.lifetime;
  }
  // Load remaining flames
  const flameData = await apiFetch('/api/user/flames/remaining');
  if (flameData) {
    state.flameAllowance = flameData.allowance;
    state.flamesRemaining = flameData.remaining;
  }
  // Load notifications
  const notifs = await apiFetch('/api/user/notifications');
  if (notifs && Array.isArray(notifs)) state.notifications = notifs;
  // Load favorites
  const favs = await apiFetch('/api/user/favorites');
  if (favs && Array.isArray(favs)) state.favorites = favs.map(b => b.id);
  // Load reading progress
  const progress = await apiFetch('/api/user/progress');
  if (progress && Array.isArray(progress)) state.readingProgress = progress;
  saveState();
}

// ── API Wrappers (fire-and-forget sync) ──────────
async function apiSync(method, path, body) {
  if (!serverOnline) return null;
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(`${API_BASE}${path}`, { credentials: 'include', ...opts });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    // Only a real network failure means the server is offline; HTTP errors (4xx/5xx) don't.
    serverOnline = false;
    return null;
  }
}

async function syncCreateBook(book) {
  const localId = book.id;
  const res = await apiSync('POST', '/api/books', {
    title: book.title, synopsis: book.synopsis, genre: book.genre,
    type: book.type, tags: book.tags, cover: book.cover,
    status: book.status, visibility: 'public'
  });
  if (res) {
    const normalized = normalizeServerBook(res);
    Object.assign(book, normalized);
    if (localId !== book.id) {
      state.chapters[book.id] = state.chapters[localId] || [];
      state.characters[book.id] = state.characters[localId] || [];
      delete state.chapters[localId];
      delete state.characters[localId];
    }
    saveState();
    render();
  }
}

async function syncUpdateBook(id, data) {
  const res = await apiSync('PUT', `/api/books/${id}`, data);
  if (res) {
    const book = getBook(id);
    if (book) Object.assign(book, normalizeServerBook(res));
    saveState();
  }
}

async function syncDeleteBook(id) {
  await apiSync('DELETE', `/api/books/${id}`);
}

async function syncPublishBook(id) {
  const res = await apiSync('PUT', `/api/books/${id}/publish`);
  return res ? res.published : undefined;
}

async function syncCreateChapter(bookId, chapter) {
  const localId = chapter.id;
  const res = await apiSync('POST', `/api/books/${bookId}/chapters`, {
    title: chapter.title, content: chapter.content, published: chapter.published
  });
  if (res) {
    Object.assign(chapter, res);
    if (localId !== chapter.id) {
      const key = bookId + '_' + localId;
      const nextKey = bookId + '_' + chapter.id;
      if (state.chapterComments[key]) {
        state.chapterComments[nextKey] = state.chapterComments[key];
        delete state.chapterComments[key];
      }
    }
    saveState();
  }
}

async function syncUpdateChapter(chapterId, data) {
  await apiSync('PUT', `/api/chapters/${chapterId}`, data);
}

async function syncDeleteChapter(chapterId) {
  await apiSync('DELETE', `/api/chapters/${chapterId}`);
}

async function syncCreateCharacter(bookId, char) {
  const res = await apiSync('POST', `/api/books/${bookId}/characters`, {
    name: char.name, nickname: char.nickname, age: char.age, height: char.height, weight: char.weight,
    biography: char.description, portrait: char.image
  });
  if (res) {
    Object.assign(char, { ...res, serverId: res.id, image: res.portrait || char.image, description: res.biography || char.description });
    saveState();
  }
}

async function syncUpdateCharacter(charId, char) {
  const res = await apiSync('PUT', `/api/characters/${charId}`, {
    name: char.name, nickname: char.nickname, age: char.age, height: char.height, weight: char.weight,
    biography: char.description, portrait: char.image
  });
  if (res) {
    Object.assign(char, { ...res, serverId: res.id, image: res.portrait || char.image, description: res.biography || char.description });
    saveState();
  }
}

async function syncDeleteCharacter(charId) {
  await apiSync('DELETE', `/api/characters/${charId}`);
}

async function syncRecordView(bookId) {
  await apiSync('POST', `/api/books/${bookId}/view`, { amount: 10 });
}

async function syncGetFlamesRemaining() {
  const res = await apiSync('GET', '/api/user/flames/remaining');
  return res;
}

async function syncGiveFlame(bookId, amount) {
  const res = await apiSync('POST', `/api/books/${bookId}/flame`, amount ? { amount } : undefined);
  return res;
}

async function syncGiveSingleFlame(chapterId) {
  const res = await apiSync('POST', `/api/chapters/${chapterId}/flame`);
  return res;
}

async function syncAwardExp(amount, reason) {
  const res = await apiSync('POST', '/api/user/exp/gain', { amount, reason });
  return res;
}

async function syncUpdateProgress(bookId, data) {
  const res = await apiSync('PUT', `/api/user/progress/${bookId}`, data);
  return res;
}

async function syncCreateReview(bookId, review) {
  const res = await apiSync('POST', `/api/books/${bookId}/reviews`, review);
  return res;
}

async function syncDeleteReview(reviewId) {
  await apiSync('DELETE', `/api/reviews/${reviewId}`);
}

async function syncTogglePinReview(reviewId) {
  const res = await apiSync('PUT', `/api/reviews/${reviewId}/pin`);
  return res;
}

async function syncToggleFavoriteReview(reviewId) {
  const res = await apiSync('PUT', `/api/reviews/${reviewId}/like`);
  return res ? res.likes : null;
}

async function syncCreateComment(chapterId, content) {
  const res = await apiSync('POST', `/api/chapters/${chapterId}/comments`, { content });
  return res;
}

async function syncDeleteComment(commentId) {
  await apiSync('DELETE', `/api/comments/${commentId}`);
}

async function syncGetReviews(bookId) {
  const res = await apiSync('GET', `/api/books/${bookId}/reviews`);
  return res;
}

async function syncGetChapterComments(chapterId) {
  const res = await apiSync('GET', `/api/chapters/${chapterId}/comments`);
  return res;
}

async function syncGetRevisions(chapterId) {
  const res = await apiSync('GET', `/api/chapters/${chapterId}/revisions`);
  return res;
}

async function syncGetRevision(chapterId, revId) {
  const res = await apiSync('GET', `/api/chapters/${chapterId}/revisions/${revId}`);
  return res;
}

async function syncRestoreRevision(chapterId, revId) {
  const res = await apiSync('POST', `/api/chapters/${chapterId}/revisions/${revId}/restore`);
  return res;
}

async function syncFollow(userId) {
  const res = await apiSync('POST', `/api/follow/${userId}`);
  return res;
}

async function syncCheckFollow(userId) {
  const res = await apiSync('GET', `/api/follow/check/${userId}`);
  return res ? res.following : false;
}

async function syncToggleFavorite(bookId) {
  const res = await apiSync('POST', `/api/favorites/${bookId}`);
  return res ? res.favorited : undefined;
}

async function syncUpdateProfile(data) {
  const res = await apiSync('PUT', '/api/user/profile', data);
  return res;
}

async function syncUpdateSettings(data) {
  const res = await apiSync('PUT', '/api/user/settings', data);
  return res;
}

// EXP/Level helpers
function expForLevel(lvl) { return lvl * 100; }
function dailyFlameAllowance(lvl) { return lvl >= 21 ? 5 : lvl >= 11 ? 4 : lvl >= 5 ? 3 : 2; }

function applyExpReward(reward) {
  if (!reward) return;
  state.user.level = reward.level;
  state.user.exp = reward.exp;
  if (reward.lifetime != null) state.user.lifetime_exp = reward.lifetime;
  else if (reward.awarded) state.user.lifetime_exp = (state.user.lifetime_exp || 0) + (reward.amount || 0);
  if (reward.leveledUp) {
    state.flameAllowance = dailyFlameAllowance(reward.level);
    showToast(`Level Up! You are now level ${reward.level}`);
  }
  saveState();
}

async function gainExp(amount, reason) {
  if (serverOnline) {
    const res = await syncAwardExp(amount, reason);
    if (res) {
      applyExpReward(res);
      return res;
    }
  }
  // Fallback: local EXP
  if (!state.user.exp) state.user.exp = 0;
  if (!state.user.level) state.user.level = 1;
  state.user.exp = (state.user.exp || 0) + amount;
  state.user.lifetime_exp = (state.user.lifetime_exp || 0) + amount;
  while (state.user.exp >= expForLevel(state.user.level)) {
    state.user.exp -= expForLevel(state.user.level);
    state.user.level++;
    const newAllowance = dailyFlameAllowance(state.user.level);
    state.flameAllowance = newAllowance;
    state.flamesRemaining = newAllowance;
    showToast(`Level Up! You are now level ${state.user.level}`);
  }
  saveState();
  return { level: state.user.level, exp: state.user.exp, needed: expForLevel(state.user.level) };
}

// ── Toast notifications ──────────────────────────
function showToast(msg, duration) {
  let el = document.getElementById('toast-msg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-msg';
    el.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--bg-card);color:var(--text);padding:10px 20px;border-radius:8px;font-size:0.75rem;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,0.4);backdrop-filter:blur(12px);transition:opacity 0.3s;text-align:center;max-width:80%';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, duration || 2000);
}

// ============================================================
// HELPERS
// ============================================================
function genId() { return 'b' + Date.now() + Math.random().toString(36).slice(2,5); }
function today() { return new Date().toISOString().split('T')[0]; }

// Midnight reset countdown for daily flames
function midnightCountdown() {
  const now = new Date();
  const mid = new Date(now); 
  mid.setHours(24, 0, 0, 0);
  const diff = Math.max(0, mid - now);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `resets at 00:00 (${h}h ${m}m)`;
}

// Daily flame status line (live remaining + reset)
function flameStatusLine() {
  if (!state.loggedIn) return 'sign in to send flames';
  const td = new Date().toDateString();
  const lv = state.user.level || 1;
  const maxF = dailyFlameAllowance(lv);
  const rem = serverOnline ? (state.flamesRemaining ?? maxF) : (state.flameDate === td ? Math.max(0, maxF - (state.flamesGiven || 0)) : maxF);
  return `${rem} / ${maxF} today \u00b7 ${midnightCountdown()}`;
}

// Add a local notification (also mirrors to server when available)
function addNotification(type, message) {
  if (!state.notifications) state.notifications = [];
  const n = { id: 'n' + Date.now() + Math.floor(Math.random()*999), type, message, read: 0, created_at: new Date().toISOString(), local: true };
  state.notifications.unshift(n);
  saveState();
  return n;
}

// Total unread badge count (server notifications + reply messages)
function unreadTotal() {
  const notif = (state.notifications || []).filter(n => !n.read).length;
  const msgs = (state.messages || []).filter(m => !m.read && m.to === state.user.username).length;
  return notif + msgs;
}

// ---- Achievement system ----
function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function countWords(s) {
  const t = String(s || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

function unlockAchievement(key) {
  if (!state.achievements) state.achievements = {};
  if (!state.achievements[key]) {
    state.achievements[key] = new Date().toISOString();
    saveState();
  }
}

// Track writing activity for streaks / daily word challenges / time-based milestones
function trackWrite(wordsAdded) {
  if (!wordsAdded || wordsAdded <= 0) return;
  const now = new Date();
  const key = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
  if (!state.dayWords) state.dayWords = {};
  state.dayWords[key] = (state.dayWords[key] || 0) + wordsAdded;
  if (!state.writeDates) state.writeDates = [];
  if (state.writeDates.indexOf(key) === -1) state.writeDates.push(key);
  const y = new Date(now.getTime() - 86400000);
  const yKey = y.getFullYear() + '-' + pad2(y.getMonth() + 1) + '-' + pad2(y.getDate());
  if (state.lastWriteDate === yKey) {
    state.writeStreak = (state.writeStreak || 0) + 1;
  } else if (state.lastWriteDate !== key) {
    state.writeStreak = 1;
  }
  state.lastWriteDate = key;
  if (!state.achFlags) state.achFlags = {};
  const h = now.getHours(), day = now.getDay();
  if (day === 1) state.achFlags.monday = true;
  if (day === 0 || day === 6) state.achFlags.weekend = true;
  if (h === 0) state.achFlags.midnight = true;
  if (h < 7) state.achFlags.earlybird = true;
  if (h >= 22) state.achFlags.nightowl = true;
  saveState();
}

function achievementMetrics() {
  const myBooks = getBooksByAuthor();
  const myBookIds = myBooks.map(b => b.id);
  const totalViews = myBooks.reduce((s, b) => s + (b.views || 0), 0);
  const totalFlames = myBooks.reduce((s, b) => s + (b.flames || 0), 0);
  const totalLikes = myBooks.reduce((s, b) => s + (b.favorites || 0), 0);
  const pubBooks = myBooks.filter(b => b.status !== 'Draft').length;
  const compBooks = myBooks.filter(b => b.status === 'Completed').length;
  const um = state.user.username;
  let wordsTotal = 0, chaptersTotal = 0, pubChapters = 0;
  const bookWords = {};
  myBooks.forEach(b => {
    const chs = state.chapters[b.id] || [];
    let w = 0;
    chs.forEach(c => {
      w += countWords(c.content);
      if (c.published) pubChapters++;
    });
    chaptersTotal += chs.length;
    wordsTotal += w;
    bookWords[b.id] = w;
  });
  let commentsReceived = 0, commentsMade = 0, likesOnComments = 0;
  Object.keys(state.chapterComments || {}).forEach(k => {
    const arr = state.chapterComments[k];
    const bookId = String(k).split('_')[0];
    arr.forEach(c => {
      if (c.username === um) commentsMade++;
      else if (myBookIds.indexOf(bookId) > -1) commentsReceived++;
      if (c.username === um) likesOnComments += (c.likes || []).length;
    });
  });
  Object.keys(state.reviews || {}).forEach(bookId => {
    (state.reviews[bookId] || []).forEach(r => {
      if (r.username === um) commentsMade++;
      else if (myBookIds.indexOf(bookId) > -1) commentsReceived++;
      if (r.username === um) likesOnComments += (r.likes || []).length;
    });
  });
  commentsMade += (state.wallPosts || []).filter(p => p.user === um).length;
  const reads = state.readsTotal || 0;
  const prog = state.readingProgress || [];
  const booksRead = prog.length;
  const booksCompleted = prog.filter(p => (p.completion_pct || 0) >= 100).length;
  const genresRead = new Set(prog.map(p => { const b = getBook(p.book_id); return b ? (b.genre || '') : ''; }).filter(Boolean)).size;
  const genresWritten = new Set(myBooks.map(b => (b.genre || '')).filter(Boolean)).size;
  const dayWords = state.dayWords || {};
  const now = new Date();
  const mKey = now.getFullYear() + '-' + pad2(now.getMonth() + 1);
  let topDay = 0, weekWords = 0, monthWords = 0;
  Object.keys(dayWords).forEach(k => {
    const v = dayWords[k];
    if (v > topDay) topDay = v;
    const kd = new Date(k + 'T12:00:00');
    if (!isNaN(kd.getTime()) && kd <= now && (now - kd) < 7 * 86400000) weekWords += v;
    if (k.indexOf(mKey) === 0) monthWords += v;
  });
  const jd = state.user.joinDate ? new Date(state.user.joinDate) : null;
  const joinAgeYears = (jd && !isNaN(jd.getTime())) ? (Date.now() - jd.getTime()) / (365.25 * 86400000) : 0;
  return {
    myBooks, myBookIds, bookWords, wordsTotal, chaptersTotal, pubChapters, totalViews,
    totalFlames, totalLikes, pubBooks, compBooks, commentsReceived, commentsMade, likesOnComments,
    reads, booksRead, booksCompleted, genresRead, genresWritten, topDay, weekWords, monthWords,
    followers: state.user.followers || 0, following: (state.following || []).length,
    likesGiven: state.favorites.length, exp: state.user.exp || 0,
    joinAgeYears, streak: state.writeStreak || 0, writeDays: (state.writeDates || []).length,
    flags: state.achFlags || {},
  };
}

const ACHIEVEMENT_GROUPS = ['Writing', 'Chapters', 'Views', 'Engagement', 'Flames', 'Community', 'Consistency', 'Reading', 'Publishing', 'Challenge', 'Secret'];

const ACHIEVEMENT_DEFS = [
  // ---- Writing (total words) ----
  { key: 'first_words', group: 'Writing', icon: 'Icons/editpen.png', label: 'First Words', desc: 'Write 100 total words', hit: m => m.wordsTotal >= 100 },
  { key: 'getting_started', group: 'Writing', icon: 'Icons/agenda.png', label: 'Getting Started', desc: 'Write 500 total words', hit: m => m.wordsTotal >= 500 },
  { key: 'warm_up', group: 'Writing', icon: 'Icons/agenda1.png', label: 'Warm Up', desc: 'Write 1,000 total words', hit: m => m.wordsTotal >= 1000 },
  { key: 'novice_writer', group: 'Writing', icon: 'Icons/app.png', label: 'Novice Writer', desc: 'Write 2,000 total words', hit: m => m.wordsTotal >= 2000 },
  { key: 'page_turner', group: 'Writing', icon: 'Icons/editpen.png', label: 'Page Turner', desc: 'Write 5,000 total words', hit: m => m.wordsTotal >= 5000 },
  { key: 'storyteller', group: 'Writing', icon: 'Icons/book.png', label: 'Storyteller', desc: 'Write 10,000 total words', hit: m => m.wordsTotal >= 10000 },
  { key: 'wordsmith', group: 'Writing', icon: 'Icons/bookmark.png', label: 'Wordsmith', desc: 'Write 25,000 total words', hit: m => m.wordsTotal >= 25000 },
  { key: 'author_in_training', group: 'Writing', icon: 'Icons/graph.png', label: 'Author in Training', desc: 'Write 50,000 total words', hit: m => m.wordsTotal >= 50000 },
  { key: 'published_author', group: 'Writing', icon: 'Icons/premium.png', label: 'Published Author', desc: 'Write 100,000 total words', hit: m => m.wordsTotal >= 100000 },
  { key: 'prolific_writer', group: 'Writing', icon: 'Icons/vip-card.png', label: 'Prolific Writer', desc: 'Write 250,000 total words', hit: m => m.wordsTotal >= 250000 },
  { key: 'master_storyteller', group: 'Writing', icon: 'Icons/diamond.png', label: 'Master Storyteller', desc: 'Write 500,000 total words', hit: m => m.wordsTotal >= 500000 },
  { key: 'legendary_author', group: 'Writing', icon: 'Icons/star.png', label: 'Legendary Author', desc: 'Write 1,000,000 total words', hit: m => m.wordsTotal >= 1000000 },
  { key: 'beyond_words', group: 'Writing', icon: 'Icons/planet.png', label: 'Beyond Words', desc: 'Write 5,000,000 total words', hit: m => m.wordsTotal >= 5000000 },

  // ---- Chapters (published) ----
  { key: 'first_chapter', group: 'Chapters', icon: 'Icons/books-stack-of-three.png', label: 'First Chapter', desc: 'Publish your first chapter', hit: m => m.pubChapters >= 1 },
  { key: 'getting_somewhere', group: 'Chapters', icon: 'Icons/books-stack-of-three.png', label: 'Getting Somewhere', desc: 'Publish 5 chapters', hit: m => m.pubChapters >= 5 },
  { key: 'story_begins', group: 'Chapters', icon: 'Icons/books-stack-of-three.png', label: 'Story Begins', desc: 'Publish 10 chapters', hit: m => m.pubChapters >= 10 },
  { key: 'dedicated_writer', group: 'Chapters', icon: 'Icons/book.png', label: 'Dedicated Writer', desc: 'Publish 25 chapters', hit: m => m.pubChapters >= 25 },
  { key: 'serial_writer', group: 'Chapters', icon: 'Icons/book.png', label: 'Serial Writer', desc: 'Publish 50 chapters', hit: m => m.pubChapters >= 50 },
  { key: 'veteran_author', group: 'Chapters', icon: 'Icons/agenda.png', label: 'Veteran Author', desc: 'Publish 100 chapters', hit: m => m.pubChapters >= 100 },
  { key: 'chapter_machine', group: 'Chapters', icon: 'Icons/agenda1.png', label: 'Chapter Machine', desc: 'Publish 250 chapters', hit: m => m.pubChapters >= 250 },
  { key: 'endless_story', group: 'Chapters', icon: 'Icons/agenda.png', label: 'Endless Story', desc: 'Publish 500 chapters', hit: m => m.pubChapters >= 500 },
  { key: 'library_builder', group: 'Chapters', icon: 'Icons/books-stack-of-three.png', label: 'Library Builder', desc: 'Publish 1,000 chapters', hit: m => m.pubChapters >= 1000 },

  // ---- Views ----
  { key: 'first_look', group: 'Views', icon: 'Icons/view.png', label: 'First Look', desc: 'Get 10 total views', hit: m => m.totalViews >= 10 },
  { key: 'someone_read_it', group: 'Views', icon: 'Icons/view.png', label: 'Someone Read It', desc: 'Get 50 total views', hit: m => m.totalViews >= 50 },
  { key: 'views_100', group: 'Views', icon: 'Icons/view.png', label: 'First Audience', desc: 'Get 100 total views', hit: m => m.totalViews >= 100 },
  { key: 'rising_story', group: 'Views', icon: 'Icons/eye.png', label: 'Rising Story', desc: 'Get 500 total views', hit: m => m.totalViews >= 500 },
  { key: 'views_1k', group: 'Views', icon: 'Icons/view.png', label: 'Getting Noticed', desc: 'Get 1,000 total views', hit: m => m.totalViews >= 1000 },
  { key: 'popular', group: 'Views', icon: 'Icons/view.png', label: 'Popular', desc: 'Get 5,000 total views', hit: m => m.totalViews >= 5000 },
  { key: 'views_100k', group: 'Views', icon: 'Icons/view.png', label: 'Trending', desc: 'Get 10,000 total views', hit: m => m.totalViews >= 10000 },
  { key: 'breakout', group: 'Views', icon: 'Icons/eye.png', label: 'Breakout Story', desc: 'Get 25,000 total views', hit: m => m.totalViews >= 25000 },
  { key: 'fan_favorite_v', group: 'Views', icon: 'Icons/eye.png', label: 'Fan Favorite', desc: 'Get 50,000 total views', hit: m => m.totalViews >= 50000 },
  { key: 'hit_story', group: 'Views', icon: 'Icons/view.png', label: 'Hit Story', desc: 'Get 100,000 total views', hit: m => m.totalViews >= 100000 },
  { key: 'bestseller', group: 'Views', icon: 'Icons/view.png', label: 'Bestseller', desc: 'Get 500,000 total views', hit: m => m.totalViews >= 500000 },
  { key: 'phenomenon', group: 'Views', icon: 'Icons/eye.png', label: 'Phenomenon', desc: 'Get 1,000,000 total views', hit: m => m.totalViews >= 1000000 },
  { key: 'legendary_reach', group: 'Views', icon: 'Icons/view.png', label: 'Legendary Reach', desc: 'Get 10,000,000 total views', hit: m => m.totalViews >= 10000000 },

  // ---- Engagement (favorites + comments received) ----
  { key: 'first_like', group: 'Engagement', icon: 'Icons/icons8-thumbs-up-24.png', label: 'First Like', desc: 'Receive your first favorite', hit: m => m.totalLikes >= 1 },
  { key: 'appreciated', group: 'Engagement', icon: 'Icons/icons8-thumbs-up-24.png', label: 'Appreciated', desc: 'Receive 10 favorites', hit: m => m.totalLikes >= 10 },
  { key: 'loved', group: 'Engagement', icon: 'Icons/like.png', label: 'Loved', desc: 'Receive 100 favorites', hit: m => m.totalLikes >= 100 },
  { key: 'crowd_favorite', group: 'Engagement', icon: 'Icons/icons8-thumbs-up-24.png', label: 'Crowd Favorite', desc: 'Receive 500 favorites', hit: m => m.totalLikes >= 500 },
  { key: 'beloved', group: 'Engagement', icon: 'Icons/like.png', label: 'Beloved', desc: 'Receive 1,000 favorites', hit: m => m.totalLikes >= 1000 },
  { key: 'iconic', group: 'Engagement', icon: 'Icons/like.png', label: 'Iconic', desc: 'Receive 10,000 favorites', hit: m => m.totalLikes >= 10000 },
  { key: 'first_reaction', group: 'Engagement', icon: 'Icons/icons8-comments-50.png', label: 'First Reaction', desc: 'Receive your first comment', hit: m => m.commentsReceived >= 1 },
  { key: 'conversation_starter', group: 'Engagement', icon: 'Icons/icons8-comments-50.png', label: 'Conversation Starter', desc: 'Receive 10 comments', hit: m => m.commentsReceived >= 10 },
  { key: 'discussion', group: 'Engagement', icon: 'Icons/icons8-comments-50.png', label: 'Discussion', desc: 'Receive 50 comments', hit: m => m.commentsReceived >= 50 },
  { key: 'community_favorite', group: 'Engagement', icon: 'Icons/icons8-comments-50.png', label: 'Community Favorite', desc: 'Receive 100 comments', hit: m => m.commentsReceived >= 100 },
  { key: 'talk_of_the_town', group: 'Engagement', icon: 'Icons/icons8-comments-50.png', label: 'Talk of the Town', desc: 'Receive 500 comments', hit: m => m.commentsReceived >= 500 },
  { key: 'discussion_legend', group: 'Engagement', icon: 'Icons/icons8-comments-50.png', label: 'Discussion Legend', desc: 'Receive 1,000 comments', hit: m => m.commentsReceived >= 1000 },

  // ---- Flames ----
  { key: 'first_flame', group: 'Flames', icon: 'Icons/fire.png', label: 'First Flame', desc: 'Receive your first flame', hit: m => m.totalFlames >= 1 },
  { key: 'flames_100', group: 'Flames', icon: 'Icons/fire-flame.png', label: '100 Flames', desc: 'Receive 100 flames', hit: m => m.totalFlames >= 100 },
  { key: 'flames_500', group: 'Flames', icon: 'Icons/fire-flame.png', label: '500 Flames', desc: 'Receive 500 flames', hit: m => m.totalFlames >= 500 },
  { key: 'flames_1k', group: 'Flames', icon: 'Icons/flames.png', label: '1,000 Flames', desc: 'Receive 1,000 flames', hit: m => m.totalFlames >= 1000 },
  { key: 'flames_10k', group: 'Flames', icon: 'Icons/flames.png', label: '10,000 Flames', desc: 'Receive 10,000 flames', hit: m => m.totalFlames >= 10000 },

  // ---- Community ----
  { key: 'first_follower', group: 'Community', icon: 'Icons/user1.png', label: 'First Follower', desc: 'Gain your first follower', hit: m => m.followers >= 1 },
  { key: 'small_following', group: 'Community', icon: 'Icons/user1.png', label: 'Small Following', desc: 'Gain 10 followers', hit: m => m.followers >= 10 },
  { key: 'growing_audience', group: 'Community', icon: 'Icons/icons8-users-50.png', label: 'Growing Audience', desc: 'Gain 50 followers', hit: m => m.followers >= 50 },
  { key: 'recognized', group: 'Community', icon: 'Icons/icons8-users-50.png', label: 'Recognized', desc: 'Gain 100 followers', hit: m => m.followers >= 100 },
  { key: 'established', group: 'Community', icon: 'Icons/user1.png', label: 'Established', desc: 'Gain 500 followers', hit: m => m.followers >= 500 },
  { key: 'influencer', group: 'Community', icon: 'Icons/icons8-users-50.png', label: 'Influencer', desc: 'Gain 1,000 followers', hit: m => m.followers >= 1000 },
  { key: 'star_author', group: 'Community', icon: 'Icons/icons8-user-male-50.png', label: 'Star Author', desc: 'Gain 5,000 followers', hit: m => m.followers >= 5000 },
  { key: 'celebrity', group: 'Community', icon: 'Icons/icons8-users-50.png', label: 'Celebrity', desc: 'Gain 10,000 followers', hit: m => m.followers >= 10000 },
  { key: 'community_legend', group: 'Community', icon: 'Icons/icons8-user-male-50.png', label: 'Legend', desc: 'Gain 100,000 followers', hit: m => m.followers >= 100000 },
  { key: 'supporter', group: 'Community', icon: 'Icons/icons8-thumbs-up-24.png', label: 'Supporter', desc: 'Favorite 50 stories', hit: m => m.likesGiven >= 50 },
  { key: 'social_butterfly', group: 'Community', icon: 'Icons/person-plus.png', label: 'Social Butterfly', desc: 'Follow 50 authors', hit: m => m.following >= 50 },
  { key: 'hello_world', group: 'Community', icon: 'Icons/icons8-comments-50.png', label: 'Hello, World', desc: 'Make your first comment', hit: m => m.commentsMade >= 1 },
  { key: 'friendly_face', group: 'Community', icon: 'Icons/icons8-comments-50.png', label: 'Friendly Face', desc: 'Make 10 comments', hit: m => m.commentsMade >= 10 },
  { key: 'critic', group: 'Community', icon: 'Icons/icons8-comments-50.png', label: 'Critic', desc: 'Leave 100 comments', hit: m => m.commentsMade >= 100 },
  { key: 'community_pillar', group: 'Community', icon: 'Icons/icons8-thumbs-up-24.png', label: 'Community Pillar', desc: 'Receive 100 likes on your comments', hit: m => m.likesOnComments >= 100 },

  // ---- Consistency (streaks / daily) ----
  { key: 'first_step', group: 'Consistency', icon: 'Icons/icons8-plus-math-50.png', label: 'First Step', desc: 'Write on 2 different days', hit: m => m.writeDays >= 2 },
  { key: 'keeping_it_up', group: 'Consistency', icon: 'Icons/alarm.png', label: 'Keeping It Up', desc: 'Write for 3 consecutive days', hit: m => m.streak >= 3 },
  { key: 'on_a_roll', group: 'Consistency', icon: 'Icons/alarm.png', label: 'On a Roll', desc: 'Write for 7 consecutive days', hit: m => m.streak >= 7 },
  { key: 'daily_grind', group: 'Consistency', icon: 'Icons/icons8-check-mark-50.png', label: 'Daily Grind', desc: 'Write every day for a week', hit: m => m.streak >= 7 },
  { key: 'dedicated_con', group: 'Consistency', icon: 'Icons/alarm.png', label: 'Dedicated', desc: 'Write for 14 consecutive days', hit: m => m.streak >= 14 },
  { key: 'unstoppable', group: 'Consistency', icon: 'Icons/alarm.png', label: 'Unstoppable', desc: 'Write for 30 consecutive days', hit: m => m.streak >= 30 },
  { key: 'iron_will', group: 'Consistency', icon: 'Icons/rock.png', label: 'Iron Will', desc: 'Write for 60 consecutive days', hit: m => m.streak >= 60 },
  { key: 'relentless', group: 'Consistency', icon: 'Icons/rock.png', label: 'Relentless', desc: 'Write for 100 consecutive days', hit: m => m.streak >= 100 },
  { key: 'half_a_year', group: 'Consistency', icon: 'Icons/alarm.png', label: 'Half a Year', desc: 'Write for 180 consecutive days', hit: m => m.streak >= 180 },
  { key: 'year_of_writing', group: 'Consistency', icon: 'Icons/alarm.png', label: 'Year of Writing', desc: 'Write for 365 consecutive days', hit: m => m.streak >= 365 },
  { key: 'speed_writer', group: 'Consistency', icon: 'Icons/editpen.png', label: 'Speed Writer', desc: 'Write 2,000 words in one day', hit: m => m.topDay >= 2000 },
  { key: 'word_rush', group: 'Consistency', icon: 'Icons/rock.png', label: 'Word Rush', desc: 'Write 5,000 words in 24 hours', hit: m => m.topDay >= 5000 },
  { key: 'marathon_ch', group: 'Consistency', icon: 'Icons/rock.png', label: 'Marathon', desc: 'Write 10,000 words in 24 hours', hit: m => m.topDay >= 10000 },
  { key: 'writing_frenzy', group: 'Consistency', icon: 'Icons/rock.png', label: 'Writing Frenzy', desc: 'Write 20,000 words in 24 hours', hit: m => m.topDay >= 20000 },
  { key: 'grind_never_stops', group: 'Consistency', icon: 'Icons/social-media.png', label: 'The Grind Never Stops', desc: 'Write 10,000 words in one week', hit: m => m.weekWords >= 10000 },
  { key: 'monthly_champion', group: 'Consistency', icon: 'Icons/vip-card.png', label: 'Monthly Champion', desc: 'Write 50,000 words in one month', hit: m => m.monthWords >= 50000 },
  { key: 'monday_motivation', group: 'Consistency', icon: 'Icons/alarm.png', label: 'Monday Motivation', desc: 'Write on a Monday', hit: m => !!m.flags.monday },
  { key: 'weekend_warrior', group: 'Consistency', icon: 'Icons/alarm.png', label: 'Weekend Warrior', desc: 'Write on a Saturday or Sunday', hit: m => !!m.flags.weekend },
  { key: 'midnight_author', group: 'Consistency', icon: 'Icons/star.png', label: 'Midnight Author', desc: 'Write right after midnight', hit: m => !!m.flags.midnight },
  { key: 'early_bird', group: 'Consistency', icon: 'Icons/alarm.png', label: 'Early Bird', desc: 'Write before 7 AM', hit: m => !!m.flags.earlybird },
  { key: 'night_owl', group: 'Consistency', icon: 'Icons/alarm.png', label: 'Night Owl', desc: 'Write after 10 PM', hit: m => !!m.flags.nightowl },

  // ---- Reading ----
  { key: 'first_read', group: 'Reading', icon: 'Icons/open-book.png', label: 'First Read', desc: 'Read your first chapter', hit: m => m.reads >= 1 },
  { key: 'bookworm', group: 'Reading', icon: 'Icons/open-book.png', label: 'Bookworm', desc: 'Read 10 chapters', hit: m => m.reads >= 10 },
  { key: 'avid_reader', group: 'Reading', icon: 'Icons/open-book.png', label: 'Avid Reader', desc: 'Read 50 chapters', hit: m => m.reads >= 50 },
  { key: 'dedicated_reader', group: 'Reading', icon: 'Icons/book.png', label: 'Dedicated Reader', desc: 'Read 100 chapters', hit: m => m.reads >= 100 },
  { key: 'bibliophile', group: 'Reading', icon: 'Icons/book.png', label: 'Bibliophile', desc: 'Read 500 chapters', hit: m => m.reads >= 500 },
  { key: 'voracious_reader', group: 'Reading', icon: 'Icons/book.png', label: 'Voracious Reader', desc: 'Read 1,000 chapters', hit: m => m.reads >= 1000 },
  { key: 'library_devourer', group: 'Reading', icon: 'Icons/book.png', label: 'Library Devourer', desc: 'Read 5,000 chapters', hit: m => m.reads >= 5000 },
  { key: 'story_explorer', group: 'Reading', icon: 'Icons/bookmark.png', label: 'Story Explorer', desc: 'Read 10 different novels', hit: m => m.booksRead >= 10 },
  { key: 'genre_explorer', group: 'Reading', icon: 'Icons/bookmark.png', label: 'Genre Explorer', desc: 'Read in 5 different genres', hit: m => m.genresRead >= 5 },
  { key: 'open_minded', group: 'Reading', icon: 'Icons/bookmark.png', label: 'Open-Minded', desc: 'Read in 10 different genres', hit: m => m.genresRead >= 10 },
  { key: 'first_book_finished', group: 'Reading', icon: 'Icons/icons8-check-mark-50.png', label: 'First Book Finished', desc: 'Complete one novel', hit: m => m.booksCompleted >= 1 },
  { key: 'serial_reader', group: 'Reading', icon: 'Icons/icons8-check-mark-50.png', label: 'Serial Reader', desc: 'Complete 5 novels', hit: m => m.booksCompleted >= 5 },
  { key: 'book_collector', group: 'Reading', icon: 'Icons/icons8-check-mark-50.png', label: 'Book Collector', desc: 'Complete 10 novels', hit: m => m.booksCompleted >= 10 },
  { key: 'grand_reader', group: 'Reading', icon: 'Icons/icons8-check-mark-50.png', label: 'Grand Reader', desc: 'Complete 50 novels', hit: m => m.booksCompleted >= 50 },

  // ---- Publishing ----
  { key: 'first_book', group: 'Publishing', icon: 'Icons/book.png', label: 'First Book', desc: 'Publish your first book', hit: m => m.myBooks.length >= 1 },
  { key: 'second_story', group: 'Publishing', icon: 'Icons/book.png', label: 'Second Story', desc: 'Publish 2 stories', hit: m => m.myBooks.length >= 2 },
  { key: 'three_books', group: 'Publishing', icon: 'Icons/books-stack-of-three.png', label: '3 Books', desc: 'Publish 3 books', hit: m => m.myBooks.length >= 3 },
  { key: 'storyteller_pub', group: 'Publishing', icon: 'Icons/open-book.png', label: 'Storyteller', desc: 'Publish 5 stories', hit: m => m.myBooks.length >= 5 },
  { key: 'five_books', group: 'Publishing', icon: 'Icons/books-stack-of-three.png', label: '5 Books', desc: 'Publish 5 books', hit: m => m.myBooks.length >= 5 },
  { key: 'authors_shelf', group: 'Publishing', icon: 'Icons/books-stack-of-three.png', label: "Author's Shelf", desc: 'Publish 10 stories', hit: m => m.myBooks.length >= 10 },
  { key: 'prolific_author', group: 'Publishing', icon: 'Icons/books-stack-of-three.png', label: 'Prolific Author', desc: 'Publish 25 stories', hit: m => m.myBooks.length >= 25 },
  { key: 'library_owner', group: 'Publishing', icon: 'Icons/books-stack-of-three.png', label: 'Library Owner', desc: 'Publish 50 stories', hit: m => m.myBooks.length >= 50 },
  { key: 'writing_empire', group: 'Publishing', icon: 'Icons/books-stack-of-three.png', label: 'Writing Empire', desc: 'Publish 100 stories', hit: m => m.myBooks.length >= 100 },
  { key: 'published', group: 'Publishing', icon: 'Icons/open-book.png', label: 'Published', desc: 'Publish your first book', hit: m => m.pubBooks >= 1 },
  { key: 'chapters_10', group: 'Publishing', icon: 'Icons/editpen.png', label: '10 Chapters', desc: 'Write 10 chapters', hit: m => m.chaptersTotal >= 10 },
  { key: 'completed_work', group: 'Publishing', icon: 'Icons/icons8-check-mark-50.png', label: 'Completed Work', desc: 'Complete a book', hit: m => m.compBooks >= 1 },

  // ---- Challenge (dynamic combos) ----
  { key: 'triple_threat', group: 'Challenge', icon: 'Icons/star.png', label: 'Triple Threat', desc: 'Write 10,000 words + 1,000 views + 100 favorites', hit: m => m.wordsTotal >= 10000 && m.totalViews >= 1000 && m.totalLikes >= 100 },
  { key: 'complete_package', group: 'Challenge', icon: 'Icons/star.png', label: 'Complete Package', desc: 'Publish 10 chapters + 1,000 views + 100 favorites', hit: m => m.pubChapters >= 10 && m.totalViews >= 1000 && m.totalLikes >= 100 },
  { key: 'rising_author', group: 'Challenge', icon: 'Icons/rock.png', label: 'Rising Author', desc: 'Reach 10,000 words, 1,000 views and 100 followers', hit: m => m.wordsTotal >= 10000 && m.totalViews >= 1000 && m.followers >= 100 },
  { key: 'established_author', group: 'Challenge', icon: 'Icons/diamond.png', label: 'Established Author', desc: 'Reach 50,000 words, 10,000 views and 1,000 favorites', hit: m => m.wordsTotal >= 50000 && m.totalViews >= 10000 && m.totalLikes >= 1000 },
  { key: 'masterpiece', group: 'Challenge', icon: 'Icons/diamond.png', label: 'Masterpiece', desc: 'Complete a story with 100,000+ words', hit: m => m.myBooks.some(b => b.status === 'Completed' && (m.bookWords[b.id] || 0) >= 100000) },
  { key: 'cult_classic', group: 'Challenge', icon: 'Icons/saturn.png', label: 'Cult Classic', desc: 'A completed story reaches 10,000 views', hit: m => m.myBooks.some(b => b.status === 'Completed' && (b.views || 0) >= 10000) },
  { key: 'readers_choice', group: 'Challenge', icon: 'Icons/like.png', label: "Reader's Choice", desc: 'One story receives 1,000 favorites', hit: m => m.myBooks.some(b => (b.favorites || 0) >= 1000) },
  { key: 'one_story_many_readers', group: 'Challenge', icon: 'Icons/view.png', label: 'One Story, Many Readers', desc: 'One story reaches 100,000 views', hit: m => m.myBooks.some(b => (b.views || 0) >= 100000) },
  { key: 'empire_builder', group: 'Challenge', icon: 'Icons/books-stack-of-three.png', label: 'Empire Builder', desc: 'Have 10 stories each reach 1,000 views', hit: m => m.myBooks.filter(b => (b.views || 0) >= 1000).length >= 10 },
  { key: 'authors_legacy', group: 'Challenge', icon: 'Icons/icons8-check-mark-50.png', label: "Author's Legacy", desc: 'Have 5 completed stories', hit: m => m.compBooks >= 5 },
  { key: 'master_of_genres', group: 'Challenge', icon: 'Icons/bookmark.png', label: 'Master of Genres', desc: 'Publish stories in 5 different genres', hit: m => m.genresWritten >= 5 },
  { key: 'the_full_journey', group: 'Challenge', icon: 'Icons/planet.png', label: 'The Full Journey', desc: 'Write, publish, complete and reach 10,000 views on one story', hit: m => m.myBooks.some(b => b.status === 'Completed' && (b.views || 0) >= 10000) },

  // ---- Secret ----
  { key: 'mystery_1', group: 'Secret', icon: 'Icons/diamond.png', label: 'Curious Mind', desc: 'Reach 500 EXP on your journey', mystery: true, hit: m => m.exp >= 500 },
  { key: 'mystery_2', group: 'Secret', icon: 'Icons/saturn.png', label: 'Deep Reader', desc: 'Read 250 chapters across the platform', mystery: true, hit: m => m.reads >= 250 },
  { key: 'mystery_3', group: 'Secret', icon: 'Icons/star.png', label: 'Noisy Neighbor', desc: 'Leave 25 comments', mystery: true, hit: m => m.commentsMade >= 25 },
  { key: 'old_soul', group: 'Secret', icon: 'Icons/planet.png', label: 'Old Soul', desc: 'Maintain your account for one year', mystery: true, hit: m => m.joinAgeYears >= 1 },
  { key: 'veteran_acc', group: 'Secret', icon: 'Icons/rock.png', label: 'Veteran', desc: 'Maintain your account for three years', mystery: true, hit: m => m.joinAgeYears >= 3 },
];

// Shared achievements computation
function computeAchievements() {
  if (!state.achievements) state.achievements = {};
  const m = achievementMetrics();
  let changed = false;
  const all = ACHIEVEMENT_DEFS.map(d => {
    const hit = d.hit(m);
    if (hit && !state.achievements[d.key]) { state.achievements[d.key] = new Date().toISOString(); changed = true; }
    const achieved = !!state.achievements[d.key];
    const hidden = d.mystery && !achieved;
    return {
      key: d.key, group: d.group, icon: d.icon,
      label: hidden ? '???' : d.label,
      desc: hidden ? 'Secret achievement - keep doing what you love.' : d.desc,
      date: state.achievements[d.key], achieved, mystery: d.mystery,
    };
  });
  if (changed) saveState();
  const achievements = all.filter(a => a.achieved);
  const locked = all.filter(a => !a.achieved);
  return { achievements, locked, all, myBooks: m.myBooks, totalViews: m.totalViews, totalFlames: m.totalFlames, pubBooks: m.pubBooks, compBooks: m.compBooks, metrics: m };
}
function fmt(n) { if (n >= 1e6) return (n/1e6).toFixed(1)+'M'; if (n >= 1e3) return (n/1e3).toFixed(1)+'K'; return ''+n; }
function coverColor(title) {
  const colors = ['#1a1a1a,#000000','#2a2a2a,#0a0a0a','#222222,#000000','#333333,#111111','#1a1a1a,#0a0a0a','#2a2a2a,#000000','#111111,#000000','#252525,#050505','#1e1e1e,#000000','#2e2e2e,#080808'];
  let h = 0; for (let i = 0; i < title.length; i++) h = title.charCodeAt(i) + ((h << 5) - h); return colors[Math.abs(h) % colors.length];
}
function cssUrl(url) { return String(url || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\)/g, '\\)'); }
function imageBg(url, fallback) { return url ? `background-image:url('${cssUrl(url)}')` : fallback; }
function imageClass(base, url) { return `${base}${url ? ' has-img' : ''}`; }
function coverClass(base, url) { return `${base}${url ? ' has-cover' : ''}`; }
function imageFallback(text) { return (text || '?').trim().slice(0, 1).toUpperCase() || '?'; }

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const CONTENT_IMG_RE = /(^|\s)((?:https?:\/\/[^\s]+?\.(?:png|jpe?g|gif|webp|bmp|svg|avif|ico)(?:\?[^\s]*)?)|(?:data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml|avif);base64,[A-Za-z0-9+/=\s]+))(?!\w)/gi;

function renderRichContent(text) {
  if (!text) return '';
  let html = escHtml(text);

  // Convert image URLs to zoomable <img> elements
  html = html.replace(CONTENT_IMG_RE, (m, pre, url) => {
    const clean = url.replace(/&amp;/g, '&');
    return `${pre}<img src="${cssUrl(clean)}" class="reader-img" loading="lazy" alt="reader image" data-zoom-src="${cssUrl(clean)}">`;
  });

  // Bold then italic (order matters so bold segments can contain italics)
  html = html.replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/gs, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+?)\*/gs, '<em>$1</em>');
  // Underline (++text++)
  html = html.replace(/\+\+(.+?)\+\+/gs, '<u>$1</u>');

  return html;
}

// Split chapter content into paragraphs on double newlines (preserves single newlines).
function chapterBlocks(content) {
  if (!content) return [];
  return String(content).split(/\r?\n\s*\r?\n/).map(b => b.trim()).filter(Boolean);
}

// Render a single paragraph with passage highlights. No plus markers: readers and
// authors use text selection to attach comments to passages instead.
function paragraphHtml(bookId, chapterId, block, paraIdx) {
  return `<p class="reader-para" data-para="${paraIdx}">${highlightBlockHtml(bookId, chapterId, block, paraIdx)}</p>`;
}

// Tokenize a paragraph's raw text the same way renderRichContent does, so we can
// map visible-text offsets back to raw block offsets for passage highlights.
function segmentBlock(block) {
  const segs = [];
  let pos = 0, start = 0;
  const n = block.length;
  const push = (bStart, bEnd, kind) => {
    if (bEnd <= bStart) return;
    const span = bEnd - bStart;
    if (kind === 'img') { segs.push({ bStart, bEnd, kind, plen: 0, bpre: 0 }); return; }
    const drop = (kind === 'strong' || kind === 'u') ? 4 : 2;
    segs.push({ bStart, bEnd, kind, plen: Math.max(0, span - drop), bpre: (kind === 'strong' || kind === 'u') ? 2 : 1 });
  };
  const imgEndAt = (j) => {
    if (j > 0 && !/\s/.test(block[j - 1])) return null;
    const m = block.slice(j).match(/^(?:(?:https?:\/\/)([^\s]+?)\.(?:png|jpe?g|gif|webp|bmp|svg|avif|ico)(?:\?[^\s]*)?|(?:data:image\/(?:png|jpe?g|gif|webp|bmp|svg\+xml|avif);base64,[A-Za-z0-9+/=\s]+))(?!\w)/i);
    return m ? j + m[0].length : null;
  };
  while (pos < n) {
    let tok = null;
    if (block.startsWith('**', pos)) { const e = block.indexOf('**', pos + 2); if (e > pos + 2) tok = { end: e + 2, kind: 'strong' }; }
    if (!tok && block.startsWith('__', pos)) { const e = block.indexOf('__', pos + 2); if (e > pos + 2) tok = { end: e + 2, kind: 'strong' }; }
    if (!tok && block[pos] === '*') { const e = block.indexOf('*', pos + 1); if (e > pos + 1) tok = { end: e + 1, kind: 'em' }; }
    if (!tok && block.startsWith('++', pos)) { const e = block.indexOf('++', pos + 2); if (e > pos + 2) tok = { end: e + 2, kind: 'u' }; }
    if (!tok) { const ie = imgEndAt(pos); if (ie) tok = { end: ie, kind: 'img' }; }
    if (!tok) { pos++; continue; }
    if (pos > start) push(start, pos, 'text');
    push(pos, tok.end, tok.kind);
    pos = tok.end; start = pos;
  }
  if (pos > start) push(start, pos, 'text');
  return segs;
}

function buildPlainMap(block, segs) {
  const p2b = [0];
  for (const sg of segs) {
    if (sg.kind === 'img') continue;
    const tStart = sg.bStart + sg.bpre;
    for (let i = 1; i <= sg.plen; i++) p2b.push(tStart + i);
  }
  return p2b;
}

function highlightBlockHtml(bookId, chapterId, block, paraIdx) {
  const hls = getChapterHighlights(bookId, chapterId).filter(h => h.para === paraIdx).sort((a, b) => a.start - b.start);
  if (!hls.length) return renderRichContent(block);
  const p2b = buildPlainMap(block, segmentBlock(block));
  if (!p2b.length) return renderRichContent(block);
  let out = '';
  let lastB = 0;
  for (const h of hls) {
    const bs = p2b[h.start], be = p2b[h.end];
    if (h.start < 0 || h.end >= p2b.length || bs < lastB || be <= bs) continue;
    const n = (h.comments || []).length;
    out += renderRichContent(block.slice(lastB, bs));
    out += `<mark class="hl" data-hl="${h.id}" data-book="${bookId}" data-chapter="${chapterId}" data-para="${paraIdx}" title="${n} comment${n === 1 ? '' : 's'} on this passage">${renderRichContent(block.slice(bs, be))}${n ? `<span class="hl-badge">${n}</span>` : ''}</mark>`;
    lastB = be;
  }
  out += renderRichContent(block.slice(lastB));
  return out;
}

// Build pages of paragraphs (character-based chunking) for page-by-page mode.
function paginateBlocks(blocks, pageChars) {
  const cap = pageChars || 1600;
  const pages = [];
  let cur = [], curLen = 0;
  blocks.forEach(b => {
    const len = b.length;
    if (cur.length && curLen + len > cap) {
      pages.push(cur);
      cur = [];
      curLen = 0;
    }
    cur.push(b);
    curLen += len;
  });
  if (cur.length) pages.push(cur);
  return pages.length ? pages : [[]];
}

// ---- Reader page-by-page helpers (swipe between pages) ----
const READER_PAGE_CHARS = 1600;

function readerPageNavHtml(idx, total) {
  return `<div class="reader-page-nav">
    <button class="btn btn-sm rd-page-prev" ${idx <= 0 ? 'disabled' : ''} style="font-size:0.6rem">&#8249; Prev</button>
    <span class="reader-page-count">Page ${idx + 1} / ${total}</span>
    <button class="btn btn-sm rd-page-next" ${idx >= total - 1 ? 'disabled' : ''} style="font-size:0.6rem">Next &#8250;</button>
  </div>`;
}

// Build the markup for a single page (nav + paragraphs) by index.
function readerPageBuild(bookId, chapterId, idx) {
  const chapters = state.chapters[bookId] || [];
  const ch = chapters.find(c => c.id === chapterId);
  if (!ch) return { total: 1, nav: '', body: '' };
  const pages = paginateBlocks(chapterBlocks(ch.content), READER_PAGE_CHARS);
  const total = Math.max(1, pages.length);
  const i = Math.max(0, Math.min(idx || 0, total - 1));
  let acc = 0;
  pages.slice(0, i).forEach(p => { acc += p.length; });
  return {
    total,
    nav: readerPageNavHtml(i, total),
    body: (pages[i] || []).map((b, k) => paragraphHtml(bookId, chapterId, b, acc + k)).join('')
  };
}

// Animate the track to the next/prev page, then re-render at the new index.
function readerTurnPage(dir, pagesEl, track) {
  const total = parseInt(pagesEl.dataset.total || '1', 10);
  const bookId = pagesEl.dataset.book;
  const chapterId = pagesEl.dataset.chapter;
  const cur = state.readerPageIndex || 0;
  const next = cur + dir;
  if (next < 0 || next >= total) {
    track.style.transition = '';
    track.style.transform = 'translateX(0px)';
    return;
  }
  if (track.dataset.anim === '1') return;
  track.dataset.anim = '1';
  const shift = pagesEl.offsetWidth;
  const build = readerPageBuild(bookId, chapterId, next);
  const inc = document.createElement('div');
  inc.className = 'rp-page';
  inc.innerHTML = build.nav + build.body;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    track.removeEventListener('transitionend', finish);
    state.readerPageIndex = next;
    saveState();
    render();
    // Start the newly shown page from its top: scroll the reading area back to
    // the top of the paragraphs (keep the fixed reader header controls visible).
    requestAnimationFrame(() => {
      const pagesEl2 = document.getElementById('reader-pages');
      if (!pagesEl2) { window.scrollTo(0, 0); return; }
      const y = pagesEl2.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop);
      window.scrollTo(0, Math.max(0, y - 4));
    });
  };
  track.addEventListener('transitionend', finish);
  window.setTimeout(finish, 520);
  if (dir > 0) {
    track.appendChild(inc);
    track.style.transition = 'transform 0.3s cubic-bezier(.22,.61,.36,1)';
    void track.offsetWidth;
    track.style.transform = 'translateX(' + (-shift) + 'px)';
  } else {
    track.insertBefore(inc, track.firstChild);
    track.style.transition = 'none';
    track.style.transform = 'translateX(' + (-shift) + 'px)';
    void track.offsetWidth;
    track.style.transition = 'transform 0.3s cubic-bezier(.22,.61,.36,1)';
    track.style.transform = 'translateX(0px)';
  }
}

// Swipe detection (touch + mouse), delegated once on the document.
function bindReaderSwipe() {
  if (window._flowSwipeBound) return;
  window._flowSwipeBound = true;
  let c = null;
  const pagesElOf = t => t && t.closest ? t.closest('#reader-pages') : null;
  document.addEventListener('pointerdown', e => {
    if (c) return;
    const p = pagesElOf(e.target);
    if (!p) return;
    const track = document.getElementById('rp-track');
    if (!track || track.dataset.anim === '1') return;
    if (e.target.closest && e.target.closest('a, button, .btn, mark, .sel-popup, .sel-form')) return;
    if (e.pointerType === 'touch' && e.touches && e.touches.length > 1) return;
    c = { p, track, id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0, on: false };
  }, { passive: true });
  document.addEventListener('pointermove', e => {
    if (!c || c.id !== e.pointerId) return;
    c.dx = e.clientX - c.x;
    c.dy = e.clientY - c.y;
    if (!c.on) {
      if (Math.abs(c.dx) < 10 && Math.abs(c.dy) < 10) return;
      if (Math.abs(c.dx) <= Math.abs(c.dy)) { c = null; return; }
      c.on = true;
      c.track.style.transition = 'none';
    }
    const shift = Math.max(-80, Math.min(80, c.dx * 0.4));
    c.track.style.transform = 'translateX(' + shift + 'px)';
  }, { passive: true });
  const endSwipe = e => {
    if (!c || c.id !== e.pointerId) return;
    const f = c;
    c = null;
    if (!f.on) { f.track.style.transform = 'translateX(0px)'; return; }
    const dir = f.dx < -40 ? 1 : f.dx > 40 ? -1 : 0;
    if (!dir) { f.track.style.transform = 'translateX(0px)'; return; }
    readerTurnPage(dir, f.p, f.track);
  };
  document.addEventListener('pointerup', endSwipe);
  document.addEventListener('pointercancel', endSwipe);
}
function bindImageErrorLogging() {
  document.querySelectorAll('[data-img-url]').forEach(el => {
    const url = el.dataset.imgUrl;
    if (!url || el.dataset.imgChecked) return;
    el.dataset.imgChecked = '1';
    const img = new Image();
    img.onload = () => {};
    img.onerror = () => {
      console.warn('Broken image URL detected', { url, context: el.dataset.imgContext || el.className });
      el.classList.add('img-broken');
      el.style.backgroundImage = '';
    };
    img.src = url;
  });
}
function normalizeServerBook(book) {
  const status = book.status || (book.published ? 'Ongoing' : 'Draft');
  return {
    ...book,
    author: book.author || book.username || state.user.username,
    type: book.type || 'Novel',
    status,
    published: !!book.published || status !== 'Draft',
    flames: book.flames ?? book.serverFlames ?? 0,
    favorites: book.favorites || 0,
    createdAt: book.createdAt || (book.created_at ? book.created_at.slice(0, 10) : today()),
    updatedAt: book.updatedAt || (book.updated_at ? book.updated_at.slice(0, 10) : today()),
  };
}
function isPublicBook(book) {
  return !!book && book.status !== 'Draft' && book.published !== false && (book.visibility || 'public') === 'public';
}
function getBook(id) { return state.books.find(b => b.id === id); }
function getBooksByAuthor() { return state.books.filter(b => b.author === state.user.username); }

// ============================================================
// CRUD OPERATIONS
// ============================================================
function createBook(data) {
  const book = {
    id: genId(),
    title: data.title,
    author: data.author || state.user.username,
    synopsis: data.synopsis || '',
    genre: data.genre || '',
    tags: (data.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    type: data.type || 'Novel',
    status: data.status || 'Draft',
    chapterCount: 0,
    views: 0,
    favorites: 0,
    flames: 0,
    rating: 0,
    ratingCount: 0,
    cover: '',
    dailyViews: {},
    createdAt: today(),
    updatedAt: today(),
  };
  state.books.push(book);
  state.chapters[book.id] = [];
  state.characters[book.id] = [];
  saveState();
  syncCreateBook(book);
  return book;
}

function updateBook(id, data) {
  const book = getBook(id);
  if (!book) return;
  Object.assign(book, data, { updatedAt: today() });
  saveState();
  syncUpdateBook(id, data);
}

function deleteBook(id) {
  state.books = state.books.filter(b => b.id !== id);
  delete state.chapters[id];
  delete state.characters[id];
  state.favorites = state.favorites.filter(f => f !== id);
  delete state.flames[id];
  saveState();
  syncDeleteBook(id);
}

function createChapter(bookId, data) {
  const chapters = state.chapters[bookId] || [];
  const chapter = {
    id: genId(),
    bookId,
    title: data.title,
    content: data.content || '',
    published: data.published || false,
    chapterNumber: chapters.length + 1,
    createdAt: today(),
    updatedAt: today(),
  };
  chapters.push(chapter);
  state.chapters[bookId] = chapters;
  const book = getBook(bookId);
  if (book) {
    book.chapterCount = chapters.length;
    book.updatedAt = today();
  }
  const newWords = countWords(chapter.content);
  if (newWords > 0) trackWrite(newWords);
  saveState();
  syncCreateChapter(bookId, chapter);
  return chapter;
}

function updateChapter(bookId, chapterId, data) {
  const chapters = state.chapters[bookId] || [];
  const ch = chapters.find(c => c.id === chapterId);
  if (!ch) return;
  if (data.content !== undefined && data.content !== ch.content) {
    const delta = countWords(data.content) - countWords(ch.content);
    if (delta > 0) trackWrite(delta);
  }
  Object.assign(ch, data, { updatedAt: today() });
  saveState();
  syncUpdateChapter(chapterId, data);
}

function deleteChapter(bookId, chapterId) {
  state.chapters[bookId] = (state.chapters[bookId] || []).filter(c => c.id !== chapterId);
  const book = getBook(bookId);
  if (book) {
    book.chapterCount = state.chapters[bookId].length;
    book.updatedAt = today();
  }
  saveState();
  syncDeleteChapter(chapterId);
}

function createCharacter(bookId, data) {
  const chars = state.characters[bookId] || [];
  const ch = { id: genId(), bookId, name: data.name, nickname: data.nickname || '', age: data.age || '', height: data.height || '', weight: data.weight || '', description: data.description || '', role: data.role || '', image: data.image || '' };
  chars.push(ch);
  state.characters[bookId] = chars;
  saveState();
  syncCreateCharacter(bookId, ch);
  return ch;
}

function updateCharacter(bookId, charId, data) {
  const ch = (state.characters[bookId] || []).find(c => c.id === charId);
  if (!ch) return;
  Object.assign(ch, {
    name: data.name, nickname: data.nickname || '', age: data.age || '', height: data.height || '',
    weight: data.weight || '', description: data.description || '', role: data.role || '',
    image: data.image !== undefined ? data.image : ch.image,
  });
  saveState();
  syncUpdateCharacter(ch.serverId || ch.id, ch);
  return ch;
}

function deleteCharacter(bookId, charId) {
  const ch = (state.characters[bookId] || []).find(c => c.id === charId);
  state.characters[bookId] = (state.characters[bookId] || []).filter(c => c.id !== charId);
  saveState();
  syncDeleteCharacter(ch && ch.serverId ? ch.serverId : charId);
}

function toggleFavorite(bookId) {
  const idx = state.favorites.indexOf(bookId);
  if (idx > -1) {
    state.favorites.splice(idx, 1);
    const book = getBook(bookId);
    if (book) book.favorites = Math.max(0, book.favorites - 1);
  } else {
    state.favorites.push(bookId);
    const book = getBook(bookId);
    if (book) book.favorites = (book.favorites || 0) + 1;
  }
  saveState();
  syncToggleFavorite(bookId);
}

function giveFlames(bookId) {
  const book = getBook(bookId);
  if (!book || book.author === state.user.username) return false;

  // Try server first
  if (serverOnline) {
    const maxF = dailyFlameAllowance(state.user.level || 1);
    const rem = state.flamesRemaining ?? maxF;
    if (rem <= 0) return false;
    syncGiveFlame(bookId, rem).then(res => {
      if (!res) return;
      const given = res.given || 1;
      state.flamesRemaining = res.remaining;
      book.flames = res.bookFlames;
      recordSupporter(book, given);
      if (res.expReward) applyExpReward(res.expReward);
      saveState();
      render();
    });
    return true;
  }

  // Fallback localStorage
  const todayStr = new Date().toDateString();
  if (state.flameDate !== todayStr) {
    state.flameDate = todayStr;
    state.flamesGiven = 0;
  }

  const level = state.user.level || 1;
  const maxFlames = dailyFlameAllowance(level);
  const remaining = Math.max(0, maxFlames - state.flamesGiven);
  if (remaining <= 0) return false;

  if (!state.flames[bookId]) state.flames[bookId] = 0;
  state.flames[bookId] += remaining;
  book.flames = (book.flames || 0) + remaining;
  state.flamesGiven += remaining;
  recordSupporter(book, remaining);
  gainExp(remaining * 10, 'flame');
  saveState();
  return true;
}

// Keep the Supporters feed in sync with flames given
function recordSupporter(book, amount) {
  if (!book || !amount) return;
  if (!state.supporterHistory) state.supporterHistory = [];
  state.supporterHistory.push({ user: state.user.username, book: book.title, amount, date: new Date().toISOString() });
}

function recordView(bookId, chapterId) {
  const book = getBook(bookId);
  if (!book) return;
  const d = new Date().toISOString().split('T')[0];
  const key = bookId + '_' + (chapterId || '') + '_' + d;
  if (!state._viewCache) state._viewCache = {};
  if (state._viewCache[key]) return;
  state._viewCache[key] = true;
  if (chapterId) {
    // Opening a chapter counts toward the reading achievements
    state.readsTotal = (state.readsTotal || 0) + 1;
    const ch = (state.chapters[bookId] || []).find(c => c.id === chapterId);
    if (ch) ch.views = (ch.views || 0) + 10;
  }
  book.views = (book.views || 0) + 10;
  if (!book.dailyViews) book.dailyViews = {};
  book.dailyViews[d] = (book.dailyViews[d] || 0) + 10;
  saveState();
  syncRecordView(bookId);
}

// ---- Review CRUD ----
function getReviews(bookId) { return state.reviews[bookId] || []; }

function createReview(bookId, data) {
  const reviews = getReviews(bookId);
  const ratings = {};
  REVIEW_CATEGORIES.forEach(c => { ratings[c.key] = clampStar(data.ratings ? data.ratings[c.key] : 5); });
  const overall = ratingOverall(ratings);
  const r = { id: genId(), bookId, username: state.user.username, content: data.content, ratings, rating: overall, createdAt: new Date().toLocaleDateString(), editedAt: null, pinned: false, favorited: false };
  reviews.push(r);
  state.reviews[bookId] = reviews;
  saveState();
  if (serverOnline) {
    syncCreateReview(bookId, { ...data, ratings, rating: overall }).then(res => {
      if (!res) return;
      Object.assign(r, res);
      if (res.expReward) applyExpReward(res.expReward);
      saveState();
      render();
    });
  } else {
    gainExp(20, 'review');
  }
  return r;
}

function updateReview(bookId, reviewId, data) {
  const reviews = getReviews(bookId);
  const r = reviews.find(x => x.id === reviewId);
  if (!r) return;
  Object.assign(r, data, { editedAt: new Date().toLocaleDateString() });
  state.reviews[bookId] = reviews;
  saveState();
}

function deleteReview(bookId, reviewId) {
  state.reviews[bookId] = getReviews(bookId).filter(x => x.id !== reviewId);
  saveState();
  syncDeleteReview(reviewId);
}

function togglePinReview(bookId, reviewId) {
  const reviews = getReviews(bookId);
  const r = reviews.find(x => x.id === reviewId);
  if (!r) return;
  r.pinned = !r.pinned;
  state.reviews[bookId] = reviews;
  saveState();
  syncTogglePinReview(reviewId);
}

function toggleFavoriteReview(bookId, reviewId) {
  const reviews = getReviews(bookId);
  const r = reviews.find(x => x.id === reviewId);
  if (!r) return;
  r.favorited = !r.favorited;
  state.reviews[bookId] = reviews;
  saveState();
  syncToggleFavoriteReview(reviewId);
}

function replyToReview(bookId, reviewId, content) {
  const reviews = getReviews(bookId);
  const r = reviews.find(x => x.id === reviewId);
  if (!r) return;
  if (!r.replies) r.replies = [];
  r.replies.push({ id: genId(), username: state.user.username, content, createdAt: new Date().toLocaleDateString() });
  state.reviews[bookId] = reviews;
  saveState();

  // Notify the review author (unless it's our own review)
  if (r.username && r.username !== state.user.username) {
    const book = getBook(bookId);
    const target = `${book ? book.title : 'book'} review`;
    const link = `#/book/${bookId}`;
    addInboxMessage(state.user.username, r.username, content, r.content, target, link);
  }
}

// ---- Chapter Comment CRUD ----
function getChapterComments(bookId, chapterId) {
  const key = bookId + '_' + chapterId;
  return state.chapterComments[key] || [];
}
function createChapterComment(bookId, chapterId, content, para) {
  const key = bookId + '_' + chapterId;
  if (!state.chapterComments[key]) state.chapterComments[key] = [];
  const c = { id: genId(), username: state.user.username, content, createdAt: new Date().toLocaleDateString() };
  if (para !== undefined && para !== null) c.para = para;
  state.chapterComments[key].push(c);
  saveState();
  if (serverOnline) {
    syncCreateComment(chapterId, content).then(res => {
      if (!res) return;
      Object.assign(c, res);
      if (res.expReward) applyExpReward(res.expReward);
      saveState();
      render();
    });
  } else {
    gainExp(10, 'comment');
  }
  return c;
}
function deleteChapterComment(bookId, chapterId, commentId) {
  const key = bookId + '_' + chapterId;
  state.chapterComments[key] = (state.chapterComments[key] || []).filter(c => c.id !== commentId);
  saveState();
  syncDeleteComment(commentId);
}

function toggleChapterCommentLike(bookId, chapterId, commentId) {
  if (!state.loggedIn) { navigate('#/signin'); return; }
  const key = bookId + '_' + chapterId;
  const comments = state.chapterComments[key] || [];
  const c = comments.find(x => x.id === commentId);
  if (!c) return;
  if (!c.likes) c.likes = [];
  const i = c.likes.indexOf(state.user.username);
  if (i >= 0) c.likes.splice(i, 1); else c.likes.push(state.user.username);
  state.chapterComments[key] = comments;
  saveState();
}

function toggleReviewLike(bookId, reviewId) {
  if (!state.loggedIn) { navigate('#/signin'); return; }
  const reviews = getReviews(bookId);
  const r = reviews.find(x => x.id === reviewId);
  if (!r) return;
  if (!r.likes) r.likes = [];
  const i = r.likes.indexOf(state.user.username);
  if (i >= 0) r.likes.splice(i, 1); else r.likes.push(state.user.username);
  state.reviews[bookId] = reviews;
  saveState();
}

// ---- Passage Highlight CRUD (readers select text -> comment on it) ----
function getChapterHighlights(bookId, chapterId) {
  const key = bookId + '_' + chapterId;
  return state.chapterHighlights[key] || [];
}

function getAllBookHighlights(bookId) {
  return (state.chapters[bookId] || []).reduce((acc, ch) => {
    const hls = getChapterHighlights(bookId, ch.id);
    if (hls.length) acc.push({ chapter: ch, highlights: hls });
    return acc;
  }, []);
}

function createHighlight(bookId, chapterId, h) {
  if (!state.loggedIn) { navigate('#/signin'); return null; }
  const key = bookId + '_' + chapterId;
  if (!state.chapterHighlights[key]) state.chapterHighlights[key] = [];
  const list = state.chapterHighlights[key];
  const cc = String(h.content || '').trim().slice(0, 800);
  if (!cc) return null;
  const existing = list.find(x => x.para === h.para && x.start === h.start && x.end === h.end);
  const comment = { id: genId(), username: state.user.username, content: cc, createdAt: new Date().toLocaleDateString() };
  if (existing) {
    existing.comments.push(comment);
    saveState();
    return existing;
  }
  const rec = { id: genId(), para: h.para, start: h.start, end: h.end, text: String(h.text || '').trim().slice(0, 300), comments: [comment] };
  list.push(rec);
  saveState();
  return rec;
}

function createHighlightComment(bookId, chapterId, hlId, content) {
  const key = bookId + '_' + chapterId;
  const list = state.chapterHighlights[key] || [];
  const rec = list.find(x => x.id === hlId);
  if (!rec) return null;
  const cc = String(content || '').trim().slice(0, 800);
  if (!cc) return null;
  rec.comments.push({ id: genId(), username: state.user.username, content: cc, createdAt: new Date().toLocaleDateString() });
  saveState();
  return rec;
}

function deleteHighlightComment(bookId, chapterId, hlId, commentId) {
  const key = bookId + '_' + chapterId;
  const list = state.chapterHighlights[key] || [];
  const rec = list.find(x => x.id === hlId);
  if (!rec) return;
  rec.comments = (rec.comments || []).filter(c => c.id !== commentId);
  if (!rec.comments.length) state.chapterHighlights[key] = list.filter(x => x.id !== hlId);
  saveState();
}

function deleteHighlightRecord(bookId, chapterId, hlId) {
  const key = bookId + '_' + chapterId;
  state.chapterHighlights[key] = (state.chapterHighlights[key] || []).filter(x => x.id !== hlId);
  saveState();
}

function replaceParagraph(paraEl, bookId, chapterId, para) {
  const ch = (state.chapters[bookId] || []).find(c => c.id === chapterId);
  if (!ch) return;
  const blocks = chapterBlocks(ch.content);
  const block = blocks[para];
  if (block === undefined) return;
  paraEl.outerHTML = paragraphHtml(bookId, chapterId, block, para);
}

// ---- Reader: selection -> passage comment popup ----
let _sel = null;

function closestParaEl(node) {
  let n = node && node.nodeType === 3 ? node.parentElement : node;
  while (n && !(n.classList && n.classList.contains('reader-para'))) n = n.parentElement;
  return n;
}

function domOffsetInto(root, target, offset) {
  let acc = 0;
  if (root === target) {
    for (let i = 0; i < (offset || 0) && root.childNodes && i < root.childNodes.length; i++) {
      const ch = root.childNodes[i];
      acc += (ch.textContent ? ch.textContent.length : 0);
    }
    return acc;
  }
  (function rec(n) {
    if (n === target) return true;
    if (n.nodeType === 3) { acc += (n.textContent || '').length; return false; }
    if (n.nodeType === 1 && n.childNodes) {
      for (let i = 0; i < n.childNodes.length; i++) {
        if (rec(n.childNodes[i])) return true;
      }
    }
    return false;
  })(root);
  return acc + (offset || 0);
}

function showSelPop(rect) {
  if (typeof document === 'undefined') return;
  let pop = document.getElementById('sel-popup');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'sel-popup';
    pop.className = 'sel-popup';
    if (document.body.appendChild) document.body.appendChild(pop);
  }
  if (!pop) return;
  pop.innerHTML = '<div class="sel-row"><button class="btn btn-sm sel-comment-btn"><img src="Icons/icons8-comments-50.png" width="13" style="vertical-align:middle;margin-right:4px">Comment</button><button class="btn btn-sm ic-x sel-cancel" title="Close"><img src="Icons/icons8-cancel-24.png" alt="Close"></button></div>';
  pop.style.display = 'flex';
  const pw = pop.offsetWidth || 150;
  const ph = pop.offsetHeight || 34;
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 800;
  let left = (rect ? rect.left + rect.width / 2 : 0) - (pw / 2);
  let top = rect ? rect.top - ph - 8 : 0;
  left = Math.max(8, Math.min(left, vw - pw - 8));
  if (top < 8) top = rect ? rect.bottom + 8 : 8;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
}

function hideSelPop() {
  if (typeof document === 'undefined') return;
  const pop = document.getElementById('sel-popup');
  if (pop) { pop.style.display = 'none'; pop.classList.remove('open-form'); }
}

function selOpenForm() {
  const pop = document.getElementById('sel-popup');
  if (!pop || !_sel) return;
  if (!state.loggedIn) { hideSelPop(); clearSelection(); navigate('#/signin'); return; }
  pop.style.width = '260px';
  pop.classList.add('open-form');
  pop.innerHTML = `
    <form class="sel-form">
      <div class="sel-quote">&#8220;${escHtml(_sel.text)}&#8221;</div>
      <textarea class="input-field" name="content" rows="2" placeholder="Comment on this passage..." style="font-size:0.68rem;width:100%;box-sizing:border-box;resize:none"></textarea>
      <div class="sel-form-actions">
        <button type="submit" class="btn btn-primary btn-sm" style="font-size:0.6rem;padding:4px 10px">Post Comment</button>
        <button type="button" class="btn btn-sm sel-cancel" style="font-size:0.6rem;padding:4px 10px"><img src="Icons/icons8-cancel-24.png" width="12" style="vertical-align:middle;margin-right:4px">Cancel</button>
      </div>
    </form>`;
  const ta = pop.querySelector('textarea');
  if (ta) ta.focus();
}

function submitSelForm(form) {
  if (!state.loggedIn) { hideSelPop(); clearSelection(); navigate('#/signin'); return; }
  if (!_sel) return;
  const ta = form.querySelector('[name="content"]');
  const content = (ta && ta.value.trim()) || '';
  if (!content) return;
  const selInfo = { bookId: _sel.bookId, chapterId: _sel.chapterId, para: _sel.para };
  const rec = createHighlight(selInfo.bookId, selInfo.chapterId, { para: _sel.para, start: _sel.start, end: _sel.end, text: _sel.text, content });
  hideSelPop();
  clearSelection();
  if (rec) {
    const paraEl = document.querySelector('.reader-para[data-para="' + rec.para + '"]');
    if (paraEl) replaceParagraph(paraEl, selInfo.bookId, selInfo.chapterId, rec.para);
    else render();
  } else {
    render();
  }
}

function clearSelection() {
  const sel = (typeof window !== 'undefined' && window.getSelection) ? window.getSelection() : null;
  if (sel && sel.removeAllRanges) { try { sel.removeAllRanges(); } catch (e) {} }
  _sel = null;
}

// ---- Reader: paragraph-comment modal (module-level, works across re-renders) ----
function openParaModal(bookId, chapterId, para) {
  const modal = document.getElementById('para-comment-modal');
  if (!modal) return;
  if (!state.loggedIn) { navigate('#/signin'); return; }
  modal.dataset.book = bookId;
  modal.dataset.chapter = chapterId;
  modal.dataset.para = para;
  fillParaModal(bookId, chapterId, para);
  modal.style.display = 'flex';
}

function closeParaModal() {
  const modal = document.getElementById('para-comment-modal');
  if (modal) modal.style.display = 'none';
}

function fillParaModal(bookId, chapterId, para) {
  const body = document.getElementById('para-body');
  if (!body) return;
  const book = getBook(bookId);
  const list = getChapterComments(bookId, chapterId).filter(c => c.para === para);
  body.innerHTML = list.length
    ? list.map(c => paraCommentRowHtml(c, bookId, chapterId, book ? book.author : '')).join('')
    : '<p style="font-size:0.65rem;color:var(--text3);text-align:center;padding:12px 0">No comments on this paragraph yet.</p>';
}

function submitParaForm(form) {
  const modal = document.getElementById('para-comment-modal');
  const ta = form.querySelector('[name="content"]');
  const content = (ta && ta.value.trim()) || '';
  if (!content) return;
  const b = modal.dataset.book, ch = modal.dataset.chapter, p = +modal.dataset.para;
  createChapterComment(b, ch, content, p);
  ta.value = '';
  fillParaModal(b, ch, p);
}

// ---- Reader: passage-highlight modal ----
function openHlModal(bookId, chapterId, hlId) {
  const modal = document.getElementById('hl-modal');
  if (!modal) return;
  modal.dataset.book = bookId;
  modal.dataset.chapter = chapterId;
  modal.dataset.hl = hlId;
  fillHlModal(bookId, chapterId, hlId);
  modal.style.display = 'flex';
}

function closeHlModal() {
  const modal = document.getElementById('hl-modal');
  if (modal) modal.style.display = 'none';
}

function fillHlModal(bookId, chapterId, hlId) {
  const quoteEl = document.getElementById('hl-quote');
  const body = document.getElementById('hl-body');
  if (!body) return;
  const rec = getChapterHighlights(bookId, chapterId).find(h => h.id === hlId);
  if (!rec) {
    if (quoteEl) quoteEl.textContent = '';
    body.innerHTML = '<p style="font-size:0.65rem;color:var(--text3);text-align:center;padding:12px 0">This highlight no longer exists.</p>';
    return;
  }
  if (quoteEl) quoteEl.textContent = '\u201c' + (rec.text || '') + '\u201d';
  const book = getBook(bookId);
  const bookAuthor = book ? book.author : '';
  body.innerHTML = (rec.comments || []).length
    ? rec.comments.map(c => {
        const canMod = state.loggedIn && (c.username === state.user.username || bookAuthor === state.user.username);
        return `
        <div class="ch-comment-item">
          <span class="ch-comment-avatar">${escHtml(String(c.username || '?')[0])}</span>
          <div class="ch-comment-body">
            <span class="ch-comment-author">${escHtml(c.username)}</span>
            <span class="ch-comment-date">${c.createdAt}</span>
            <p class="ch-comment-text">${escHtml(c.content)}</p>
          </div>
          ${canMod ? `<button class="btn btn-sm hl-del" data-book="${bookId}" data-chapter="${chapterId}" data-hl="${hlId}" data-para="${rec.para}" data-comment="${c.id}" style="font-size:0.5rem;padding:2px 6px;color:var(--red);flex-shrink:0">Delete</button>` : ''}
        </div>`;
      }).join('')
    : '<p style="font-size:0.65rem;color:var(--text3);text-align:center;padding:12px 0">No comments on this passage yet.</p>';
}

function submitHlForm(form) {
  if (!state.loggedIn) { navigate('#/signin'); return; }
  const modal = form.closest ? form.closest('#hl-modal') : null;
  const bookId = (modal ? modal.dataset.book : null) || form.dataset.book;
  const chapterId = (modal ? modal.dataset.chapter : null) || form.dataset.chapter;
  const hlId = (modal ? modal.dataset.hl : null) || form.dataset.hl;
  if (!bookId || !chapterId || !hlId) return;
  const ta = form.querySelector('[name="content"]');
  const content = (ta && ta.value.trim()) || '';
  if (!content) return;
  const rec = createHighlightComment(bookId, chapterId, hlId, content);
  if (!rec) return;
  ta.value = '';
  fillHlModal(bookId, chapterId, hlId);
  const paraEl = document.querySelector('.reader-para[data-para="' + rec.para + '"]');
  if (paraEl) replaceParagraph(paraEl, bookId, chapterId, rec.para);
}

// ---- Delegated reader/annotation events (bind once) ----
if (!window._flowAnnotationBound) {
  window._flowAnnotationBound = true;
  document.addEventListener('click', e => {
    const h = e.target.closest('.hl');
    if (h) { e.preventDefault(); e.stopPropagation(); openHlModal(h.dataset.book, h.dataset.chapter, h.dataset.hl); return; }
    if (e.target.closest('.hl-close') || e.target.closest('.hl-overlay')) { closeHlModal(); return; }
    if (e.target.closest('.para-close') || e.target.closest('.para-overlay')) { closeParaModal(); return; }
    const plike = e.target.closest('.para-like');
    if (plike) { toggleChapterCommentLike(plike.dataset.book, plike.dataset.chapter, plike.dataset.comment); fillParaModal(plike.dataset.book, plike.dataset.chapter, +plike.dataset.para); return; }
    const pdel = e.target.closest('.para-comment-del');
    if (pdel) {
      e.preventDefault();
      if (!confirm('Delete this comment?')) return;
      deleteChapterComment(pdel.dataset.book, pdel.dataset.chapter, pdel.dataset.comment);
      fillParaModal(pdel.dataset.book, pdel.dataset.chapter, +pdel.dataset.para);
      return;
    }
    const hld = e.target.closest('.hl-del');
    if (hld) {
      e.preventDefault();
      if (!confirm('Delete this comment?')) return;
      deleteHighlightComment(hld.dataset.book, hld.dataset.chapter, hld.dataset.hl, hld.dataset.comment);
      fillHlModal(hld.dataset.book, hld.dataset.chapter, hld.dataset.hl);
      const paraEl = document.querySelector('.reader-para[data-para="' + hld.dataset.para + '"]');
      if (paraEl) replaceParagraph(paraEl, hld.dataset.book, hld.dataset.chapter, +hld.dataset.para);
      return;
    }
    const hlrec = e.target.closest('.hl-del-rec');
    if (hlrec) {
      e.preventDefault();
      if (!confirm('Delete this highlighted passage and all its comments?')) return;
      deleteHighlightRecord(hlrec.dataset.book, hlrec.dataset.chapter, hlrec.dataset.hl);
      closeHlModal();
      render();
      return;
    }
    const sbtn = e.target.closest('.sel-comment-btn');
    if (sbtn) { e.preventDefault(); e.stopPropagation(); selOpenForm(); return; }
    if (e.target.closest('.sel-cancel') || e.target.closest('.sel-x')) { hideSelPop(); clearSelection(); return; }
    if (e.target.closest('.sel-form')) return;
    if (_sel && !e.target.closest('#sel-popup')) { hideSelPop(); }
  });
  document.addEventListener('submit', e => {
    const pf = e.target.closest('.para-form');
    if (pf) { e.preventDefault(); submitParaForm(pf); return; }
    const sf = e.target.closest('.sel-form');
    if (sf) { e.preventDefault(); submitSelForm(sf); return; }
    const hf = e.target.closest('.hl-form');
    if (hf) { e.preventDefault(); submitHlForm(hf); return; }
  });
}

// Deliver an inbox message to a user
function addInboxMessage(from, to, text, quote, target, link) {
  if (!state.messages) state.messages = [];
  state.messages.push({
    id: 'm' + Date.now() + Math.floor(Math.random()*999),
    from, to, text, quote: quote || '', target: target || '', link: link || '#/inbox',
    date: new Date().toISOString(), read: false
  });
  saveState();
}

function replyToChapterComment(bookId, chapterId, commentId, content) {
  const key = bookId + '_' + chapterId;
  const comments = state.chapterComments[key] || [];
  const c = comments.find(x => x.id === commentId);
  if (!c) return null;
  if (!c.replies) c.replies = [];
  const reply = { id: genId(), username: state.user.username, content, createdAt: new Date().toLocaleDateString() };
  c.replies.push(reply);
  state.chapterComments[key] = comments;
  saveState();

  // Notify the original comment author (unless it's our own comment)
  if (c.username && c.username !== state.user.username) {
    const book = getBook(bookId);
    const ch = (state.chapters[bookId] || []).find(x => x.id === chapterId);
    const target = `${book ? book.title : 'book'} \u00b7 Ch.${ch ? ch.chapterNumber : ''}`;
    const link = `#/book/${bookId}/read/${chapterId}`;
    addInboxMessage(state.user.username, c.username, content, c.content, target, link);
  }
  if (serverOnline) {
    syncCreateComment(chapterId, content).then(() => render());
  } else {
    gainExp(10, 'comment');
  }
  return reply;
}

function giveSingleFlame(bookId) {
  const book = getBook(bookId);
  if (!book || book.author === state.user.username) return false;

  if (serverOnline) {
    const maxF = dailyFlameAllowance(state.user.level || 1);
    if ((state.flamesRemaining ?? maxF) <= 0) return false;
    const ch = state.chapters[bookId];
    const chId = ch && ch.length ? ch[ch.length-1].id : '';
    const endpoint = chId ? syncGiveSingleFlame(chId) : syncGiveFlame(bookId);
    endpoint.then(res => {
      if (!res) return;
      const given = res.given || 1;
      state.flamesRemaining = res.remaining;
      book.flames = res.bookFlames;
      recordSupporter(book, given);
      if (res.expReward) applyExpReward(res.expReward);
      saveState();
    });
    return true;
  }

  const todayStr = new Date().toDateString();
  if (state.flameDate !== todayStr) { state.flameDate = todayStr; state.flamesGiven = 0; }
  const level = state.user.level || 1;
  const maxFlames = dailyFlameAllowance(level);
  if (state.flamesGiven >= maxFlames) return false;
  if (!state.flames[bookId]) state.flames[bookId] = 0;
  state.flames[bookId] += 1;
  book.flames = (book.flames || 0) + 1;
  state.flamesGiven += 1;
  recordSupporter(book, 1);
  gainExp(10, 'flame');
  saveState();
  return true;
}

// ============================================================
// ROUTER
// ============================================================
function navigate(hash) {
  history.pushState(null, '', hash || '#/');
  render();
}

function getRoute() {
  return (location.hash.slice(1) || '/');
}

// ============================================================
// RENDER
// ============================================================
function render() {
  const route = getRoute();
  const root = document.getElementById('root');
  if (!root) return;

  let hideNav = false;
  let isEditor = false;
  if (route.startsWith('/write/works/')) hideNav = true;
  if (route.includes('/editor/')) isEditor = true;

  let mainContent = '';
  if (route === '/' || route === '') mainContent = renderFeatured();
  else if (route === '/library') mainContent = renderLibrary();
  else if (route === '/write') mainContent = renderWriteWorks();
  else if (route === '/write/create') mainContent = renderCreateBook();
  else if (route.startsWith('/write/works/')) {
    const parts = route.split('/');
    const id = parts[3];
    if (parts[4] === 'editor') mainContent = renderEditor(id, parts[5]);
    else if (parts[4] === 'chapters' && parts[5] === 'new') mainContent = renderCreateChapter(id);
    else if (parts[4] === 'characters' && parts[5] === 'new') mainContent = renderCreateCharacter(id);
    else if (parts[4] === 'characters' && parts[5]) mainContent = renderEditCharacter(id, parts[5]);
    else if (parts[4] === 'highlights') mainContent = renderHighlightsPage(id);
    else mainContent = renderWorkspaceBook(id);
  } else if (route === '/explore' || route === '/explore/novel') mainContent = renderExplore('Novel');
  else if (route === '/explore/fanfic') mainContent = renderExplore('Fanfic');
  else if (route === '/signin') mainContent = renderSignIn();
  else if (route === '/signup') mainContent = renderSignUp();
  else if (route === '/auth/google') { window.location.href = '/api/auth/google'; return; }
  else if (route === '/auth/facebook') { window.location.href = '/api/auth/facebook'; return; }
  else if (route === '/auth/twitter') { window.location.href = '/api/auth/twitter'; return; }
  else if (route === '/profile') mainContent = renderProfile();
  else if (route === '/profile/edit') mainContent = renderEditProfile();
  else if (route === '/profile/author') mainContent = renderAuthorProfile();
  else if (route === '/profile/themes') mainContent = renderThemes();
  else if (route === '/inbox') mainContent = renderInbox();
  else if (route.startsWith('/book/') && route.includes('/read/')) {
    const parts = route.split('/');
    mainContent = renderChapterReader(parts[2], parts[4]);
  } else if (route.startsWith('/book/') && route.split('/').length >= 5 && route.split('/')[3] === 'character') {
    const parts = route.split('/');
    mainContent = renderCharacterPage(parts[2], parts[4]);
  } else if (route.startsWith('/book/') && route.split('/')[3] === 'comments' && route.split('/').length >= 5) {
    const parts = route.split('/');
    mainContent = renderChapterComments(parts[2], parts[4]);
  } else if (route.startsWith('/book/')) {
    const id = route.split('/')[2];
    mainContent = renderBookPage(id);
  } else mainContent = renderFeatured();

  root.innerHTML = `
    <div class="app-layout">
      ${hideNav ? '' : `<header class="top-header"><span class="app-logo">Flow World</span><div class="header-auth">${state.loggedIn ? `<span class="auth-user">${state.user.username}</span>${unreadTotal() ? `<span class="notif-badge" id="inbox-badge" style="cursor:pointer">${unreadTotal()}</span>` : ''}<button class="btn btn-sm auth-btn" id="sign-out-btn">Sign out</button>` : `<button class="btn btn-sm auth-btn" onclick="navigate('#/signin')">Sign in</button><button class="btn btn-primary auth-btn" onclick="navigate('#/signup')">Sign up</button>`}</div></header>`}
      <main class="main-content${isEditor ? ' editor-main' : ''}">${mainContent}</main>
      ${hideNav ? '' : `
      <nav class="bottom-nav">
        <div class="nav-item${route==='/'||route.startsWith('/book')?' active':''}" data-nav="/"><img class="nav-icon" src="Icons/star.png" alt=""><span>Featured</span></div>
        <div class="nav-item${route==='/library'?' active':''}" data-nav="/library"><img class="nav-icon" src="Icons/books-stack-of-three.png" alt=""><span>Library</span></div>
        <div class="nav-item${route==='/write'||route.startsWith('/write')?' active':''}" data-nav="/write"><img class="nav-icon" src="Icons/open-book.png" alt=""><span>Write</span></div>
        <div class="nav-item${route.startsWith('/explore')?' active':''}" data-nav="/explore"><img class="nav-icon" src="Icons/bookexplore.png" alt=""><span>Explore</span></div>
        <div class="nav-item${route==='/profile'?' active':''}" data-nav="/profile"><img class="nav-icon" src="Icons/user.png" alt=""><span>Profile</span></div>
      </nav>`}
    </div>
  `;

  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', () => navigate('#' + el.dataset.nav));
  });
  document.body.style.overflow = isEditor ? 'hidden' : '';

  bindPageEvents(route);
  bindImageErrorLogging();

  document.documentElement.setAttribute('data-theme', state.theme);

  if (state.theme === 'galaxy' && !document.querySelector('#galaxy-style')) {
    const s = document.createElement('style');
    s.id = 'galaxy-style';
    s.textContent = `
      [data-theme="galaxy"] .app-layout::before {
        content:''; position:fixed; top:0; left:0; right:0; bottom:0; pointer-events:none; z-index:0;
        background:radial-gradient(1.5px 1.5px at 20px 30px,rgba(255,255,255,0.4),transparent),
                   radial-gradient(1.5px 1.5px at 80px 50px,rgba(255,255,255,0.3),transparent),
                   radial-gradient(1px 1px at 150px 80px,rgba(255,255,255,0.4),transparent),
                   radial-gradient(1.5px 1.5px at 250px 30px,rgba(255,255,255,0.3),transparent),
                   radial-gradient(1px 1px at 350px 70px,rgba(255,255,255,0.4),transparent),
                   radial-gradient(1.5px 1.5px at 500px 90px,rgba(255,255,255,0.3),transparent),
                   radial-gradient(1px 1px at 650px 40px,rgba(255,255,255,0.4),transparent),
                   radial-gradient(1.5px 1.5px at 800px 60px,rgba(255,255,255,0.3),transparent);
        animation:galaxyDrift 200s linear infinite;
      }
      [data-theme="galaxy"] .app-layout::after {
        content:''; position:fixed; top:-40%; right:-20%; width:400px; height:400px;
        pointer-events:none; background:radial-gradient(circle,rgba(255,255,255,0.02),transparent 70%);
        z-index:0; animation:nebulaPulse 12s ease-in-out infinite;
      }
      [data-theme="galaxy"] .main-content>* { position:relative; z-index:1; }
    `;
    document.head.appendChild(s);
  } else if (state.theme !== 'galaxy') {
    document.querySelector('#galaxy-style')?.remove();
  }
}

// ============================================================
// PAGE RENDERERS
// ============================================================

// ---- Featured ----
function renderFeatured() {
  const books = state.books.filter(isPublicBook);
  const powerRank = [...books].sort((a,b) => b.flames - a.flames).slice(0, 10);
  const collRank = [...books].sort((a,b) => b.favorites - a.favorites).slice(0, 10);

  if (!books.length) {
    return `
      <div class="page">
        <div class="hero-banner">
          <div class="hero-content">
            <h2>Flow World</h2>
            <p>Explore your world</p>
          </div>
        </div>
        <div class="empty-state">
          <h3>No stories yet</h3>
          <p>Be the first to create a book</p>
          <a class="btn btn-primary" href="#/explore">Browse</a>
        </div>`;
  }

  return `
    <div class="page">
      <div class="hero-banner">
        <div class="hero-content">
          <h2>Discover Stories</h2>
          <p>Browse books created by our community</p>
        </div>
      </div>
      <section class="content-section">
        <div class="section-header"><h2 class="section-title">All Books</h2></div>
        <div class="book-row">${books.map(bookCard).join('')}</div>
      </section>
      <section class="content-section">
        <div class="section-header"><h2 class="section-title">Popular</h2></div>
        <div class="ranking-list">${powerRank.map((n,i) => rankingItem(n,i)).join('')}</div>
      </section>
      <section class="content-section">
        <div class="section-header"><h2 class="section-title">Most Favorited</h2></div>
        <div class="ranking-list">${collRank.map((n,i) => rankingItem(n,i)).join('')}</div>
      </section>
    </div>`;
}

function bookCard(n) {
  const badge = n.status === 'Draft' ? '' : n.status === 'Completed' ? '<span class="badge badge-complete">DONE</span>' : '';
  return `<a class="book-card" href="#/book/${n.id}">
    <div class="${coverClass('book-cover', n.cover)}" data-img-url="${n.cover || ''}" data-img-context="book-cover:${n.id}" style="${imageBg(n.cover, 'background:linear-gradient(135deg,' + coverColor(n.title) + ')')}">${badge}${n.cover ? '' : imageFallback(n.title)}</div>
    <div class="book-info"><div class="book-title">${n.title}</div><span class="book-author">${n.author}</span><div class="book-stats"><span>${fmt(n.flames)}</span></div></div>
  </a>`;
}

function rankingItem(n, i) {
  const cls = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
  return `<a class="ranking-item" href="#/book/${n.id}">
    <span class="ranking-pos ${cls}">${i + 1}</span>
    <div class="${coverClass('ranking-cover', n.cover)}" data-img-url="${n.cover || ''}" data-img-context="ranking-cover:${n.id}" style="${imageBg(n.cover, 'background:linear-gradient(135deg,' + coverColor(n.title) + ')')}">${n.cover ? '' : imageFallback(n.title)}</div>
    <div class="ranking-info"><h4>${n.title}</h4><span class="ranking-author">${n.author}</span><span class="ranking-meta">${fmt(n.flames)}</span></div>
  </a>`;
}

// ---- Library ----
function renderLibrary() {
  const favs = state.favorites;
  const favBooks = state.books.filter(b => favs.includes(b.id) && isPublicBook(b));
  return `
    <div class="page library-page">
      <h1 class="page-title">Library</h1>
      ${favBooks.length ? favBooks.map(n => hBookCard(n)).join('') : `
      <div class="empty-state">
        <h3>Your library is empty</h3>
        <p>Favorite books you love to find them here</p>
        <a class="btn btn-primary" href="#/explore">Browse Books</a>
      </div>`}
    </div>`;
}

function hBookCard(n) {
  return `<a class="book-card-h" href="#/book/${n.id}">
    <div class="${coverClass('book-cov-m', n.cover)}" data-img-url="${n.cover || ''}" data-img-context="book-cover-small:${n.id}" style="${imageBg(n.cover, 'background:linear-gradient(135deg,' + coverColor(n.title) + ')')}">${n.cover ? '' : imageFallback(n.title)}</div>
    <div class="ranking-info"><h4>${n.title}</h4><span class="ranking-author">${n.author}</span><span class="ranking-meta">${fmt(n.flames)}</span></div>
  </a>`;
}

// ---- Write ----
function writeBookCard(w) {
  const badgeClr = w.status === 'Draft' ? 'var(--text3)' : w.status === 'Completed' ? 'var(--accent)' : 'var(--text2)';
  const badgeBg = w.status === 'Draft' ? 'var(--accent-subtle)' : 'rgba(255,255,255,0.08)';
  return `<a class="book-card-h" href="#/write/works/${w.id}">
    <div class="${coverClass('book-cov-m', w.cover)}" data-img-url="${w.cover || ''}" data-img-context="workspace-cover:${w.id}" style="${imageBg(w.cover, 'background:linear-gradient(135deg,' + coverColor(w.title) + ')')}">${w.cover ? '' : imageFallback(w.title)}</div>
    <div class="ranking-info">
      <h4>${w.title}</h4>
      <span class="ranking-author">${w.author}</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
        <span class="ranking-meta" style="font-size:0.55rem">${w.chapterCount} ch</span>
        <span class="ranking-meta" style="font-size:0.55rem">${fmt(w.views)} views</span>
        <span class="ranking-meta" style="font-size:0.55rem">${fmt(w.flames)} flames</span>
      </div>
      <div style="display:flex;gap:6px;align-items:center;margin-top:3px">
        <span class="status-badge" style="background:${badgeBg};color:${badgeClr};font-size:0.5rem;padding:1px 6px">${w.status}</span>
        <span style="font-size:0.5rem;color:var(--text3)">${w.updatedAt}</span>
      </div>
    </div>
  </a>`;
}

function renderWriteWorks() {
  const myBooks = getBooksByAuthor();
  return `
    <div class="page write-page">
      <h1 class="page-title">Write</h1>
      <div class="tabs">
        <a class="tab active" href="#/write">Works</a>
      </div>
      ${myBooks.length ? `<div class="works-list">${myBooks.map(w => writeBookCard(w)).join('')}</div>` : `
      <div class="empty-state">
        <h3>No works yet</h3>
        <p>Create your first book to get started</p>
      </div>`}
      <button class="btn btn-primary btn-create" style="margin:16px 0;width:100%" onclick="navigate('#/write/create')">+ Create New Book</button>
    </div>`;
}

// ---- Create Book ----
function renderCreateBook() {
  return `
    <div class="page write-page">
      <a class="back-link" href="#/write"><img src="Icons/open-book.png" width="12" style="vertical-align:middle;margin-right:4px">Back to Works</a>
      <h1 class="page-title">Create New Book</h1>
      <form id="create-book-form" style="display:flex;flex-direction:column;gap:14px">
        <div class="form-group">
          <label>Title</label>
          <input class="input-field" name="title" placeholder="Book title" required>
        </div>
        <div class="form-group">
          <label>Author</label>
          <input class="input-field" name="author" value="${state.user.username}">
        </div>
        <div class="form-group">
          <label>Synopsis</label>
          <textarea class="input-field" name="synopsis" placeholder="Describe your story..." rows="4"></textarea>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Genre</label>
            <select class="input-field" name="genre">
              <option value="">Select genre</option>
              ${GENRES.map(g => `<option value="${g}">${g}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Type</label>
            <select class="input-field" name="type">
              <option value="Novel">Novel</option>
              <option value="Fanfic">Fanfic</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Tags</label>
          <input class="input-field" name="tags" placeholder="System, Magic, Adventure">
          <span style="font-size:0.55rem;color:var(--text3)">Separate tags with commas</span>
        </div>
        <button type="submit" class="btn btn-primary" style="margin-top:4px">Create Book</button>
      </form>
    </div>`;
}

// ---- Workspace Book ----
let wsTab = 'Overview';
function renderWorkspaceBook(id) {
  const book = getBook(id);
  if (!book) return '<div class="page"><h2>Book not found</h2></div>';

  const chapters = state.chapters[id] || [];
  const chars = state.characters[id] || [];
  const supporters = state.supporterHistory.filter(s => s.book === book.title) || [];
  const topSupporters = [...supporters].sort((a,b) => b.amount - a.amount).slice(0, 10);
  const recentSupporters = [...supporters].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
  const uniqueSupporters = new Set(supporters.map(s => s.user)).size;
  const totalViews = book.views || 0;
  const dv = book.dailyViews || {};
  const todayStr = new Date().toISOString().split('T')[0];
  const todayViews = dv[todayStr] || 0;
  const weekViews = (() => {
    let sum = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = d.toISOString().split('T')[0];
      sum += dv[k] || 0;
    }
    return sum;
  })();
  const monthViews = (() => {
    let sum = 0;
    for (let i = 0; i < 30; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = d.toISOString().split('T')[0];
      sum += dv[k] || 0;
    }
    return sum;
  })();
  const publishedChs = chapters.filter(c => c.published);
  const draftChs = chapters.filter(c => !c.published);
  const totalHls = chapters.reduce((sum, ch) => sum + getChapterHighlights(id, ch.id).length, 0);
  const avgViewsCh = chapters.length ? Math.round(totalViews / chapters.length) : 0;
  const estReadTime = chapters.reduce((sum, c) => sum + Math.ceil((c.content || '').length / 500), 0);
  const coverImg = book.cover || '';

  return `
    <div class="page">
      <a class="back-link" href="#/write"><img src="Icons/open-book.png" width="12" style="vertical-align:middle;margin-right:4px">Back to Works</a>

      <!-- Book Header -->
      <div class="book-settings-header" style="margin-bottom:14px">
        <div class="${coverClass('work-cover', coverImg)}" data-img-url="${coverImg}" data-img-context="workspace-detail-cover:${id}" style="width:56px;height:76px;${imageBg(coverImg, 'background:linear-gradient(135deg,' + coverColor(book.title) + ')')}">${coverImg ? '' : book.title.slice(0,2)}</div>
        <div class="book-settings-meta">
          <div class="book-settings-title">${book.title}</div>
          <span class="book-settings-genre">${book.genre || 'Uncategorized'} | ${book.type}</span>
          <span class="book-settings-status" style="color:${book.status==='Draft'?'var(--text3)':book.status==='Completed'?'var(--accent)':'var(--text2)'}">${book.status}</span>
        </div>
      </div>

      <!-- Workspace Tabs -->
      <div class="workspace-tabs" style="display:flex;gap:0;border-bottom:1px solid var(--line2);margin-bottom:14px;overflow-x:auto">
        ${['Overview','Chapters','Characters','Analytics','Supporters','Settings'].map(t => `<span class="tab${wsTab===t?' active':''}" data-ws-tab="${t}" style="font-size:0.7rem">${t}</span>`).join('')}
      </div>

      <div class="ws-content">
        ${wsTab === 'Overview' ? `
          <!-- Stats -->
          <div class="prof-stats">
            <div class="prof-stat"><div class="prof-stat-val">${fmt(totalViews)}</div><div class="prof-stat-lbl">Views</div></div>
            <div class="prof-stat"><div class="prof-stat-val">${fmt(book.flames)}</div><div class="prof-stat-lbl">Flames</div></div>
            <div class="prof-stat"><div class="prof-stat-val">${fmt(book.chapterCount)}</div><div class="prof-stat-lbl">Chapters</div></div>
            <div class="prof-stat"><div class="prof-stat-val">${fmt(book.favorites)}</div><div class="prof-stat-lbl">Followers</div></div>
          </div>
          <!-- Quick Actions -->
          <div class="prof-sections">
            <div class="prof-section" onclick="navigate('#/write/works/${id}/chapters/new')" style="cursor:pointer">
              <div class="prof-section-icon"><img src="Icons/editpen.png" width="20"></div>
              <div class="prof-section-body"><span class="prof-section-title">Add Chapter</span><span class="prof-section-desc">Write a new chapter</span></div>
              <div class="prof-section-arrow">&gt;</div>
            </div>
            <div class="prof-section" onclick="navigate('#/write/works/${id}/characters/new')" style="cursor:pointer">
              <div class="prof-section-icon"><img src="Icons/person-plus.png" width="20"></div>
              <div class="prof-section-body"><span class="prof-section-title">Add Character</span><span class="prof-section-desc">Create a new character</span></div>
              <div class="prof-section-arrow">&gt;</div>
            </div>
            <div class="prof-section" onclick="wsTab='Analytics';render()" style="cursor:pointer">
              <div class="prof-section-icon"><img src="Icons/graph.png" width="20"></div>
              <div class="prof-section-body"><span class="prof-section-title">Analytics</span><span class="prof-section-desc">View performance data</span></div>
              <div class="prof-section-arrow">&gt;</div>
            </div>
            <div class="prof-section" onclick="wsTab='Settings';render()" style="cursor:pointer">
              <div class="prof-section-icon"><img src="Icons/settings.png" width="20"></div>
              <div class="prof-section-body"><span class="prof-section-title">Settings</span><span class="prof-section-desc">Manage book settings</span></div>
              <div class="prof-section-arrow">&gt;</div>
            </div>
          </div>
          <!-- Recent Activity -->
          <section class="content-section" style="margin-top:10px">
            <h3 class="section-title">Recent Activity</h3>
            <div class="recent-activity">
              <div class="act-item"><span class="act-icon">+</span><span>Latest Chapter: ${chapters.length ? 'Ch. ' + chapters[chapters.length-1].chapterNumber + ' - ' + (chapters[chapters.length-1].title||'Untitled') : 'None yet'}</span></div>
              <div class="act-item"><span class="act-icon">+</span><span>Total Views: ${fmt(totalViews)}</span></div>
              <div class="act-item"><span class="act-icon">+</span><span>Total Flames: ${fmt(book.flames)}</span></div>
            </div>
          </section>
        ` : wsTab === 'Chapters' ? `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:6px">
            <h3 style="font-size:0.85rem;font-weight:600">Chapters (${chapters.length})</h3>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn btn-sm" onclick="navigate('#/write/works/${id}/highlights')" style="font-size:0.6rem;padding:4px 10px"><img src="Icons/inbox.png" width="11" style="vertical-align:middle;margin-right:4px">Highlights${totalHls ? ' (' + totalHls + ')' : ''}</button>
              <button class="btn btn-sm" onclick="navigate('#/write/works/${id}/chapters/new')"><img src="Icons/editpen.png" width="12" style="vertical-align:middle;margin-right:4px">Add Chapter</button>
            </div>
          </div>
          ${chapters.length ? `<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
            <span style="font-size:0.6rem;color:var(--text3)">${publishedChs.length} Published</span>
            <span style="font-size:0.6rem;color:var(--text3)">${draftChs.length} Drafts</span>
          </div>
          <div class="chapter-grid-ws">${chapters.map(ch => `
            <div class="chapter-item">
              <span class="chapter-num">Ch. ${ch.chapterNumber}</span>
              <span class="chapter-title">${ch.title || 'Untitled'}</span>
              <span class="chapter-status ${ch.published?'published':'draft'}">${ch.published?'Published':'Draft'}</span>
              <span class="chapter-date">${ch.createdAt}</span>
              <button class="btn btn-sm ws-edit-ch" data-book="${id}" data-ch="${ch.id}" style="font-size:0.55rem;padding:3px 8px">Edit</button>
              <button class="btn btn-sm ws-pub-ch" data-book="${id}" data-ch="${ch.id}" style="font-size:0.55rem;padding:3px 8px">${ch.published?'Unpublish':'Publish'}</button>
              <button class="btn btn-sm ws-del-ch" data-book="${id}" data-ch="${ch.id}" style="font-size:0.55rem;padding:3px 8px;color:var(--red)">Delete</button>
            </div>
          `).join('')}</div>` : '<p style="font-size:0.72rem;color:var(--text3);padding:16px 0;text-align:center">No chapters yet. Add your first chapter.</p>'}
        ` : wsTab === 'Characters' ? `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="font-size:0.85rem;font-weight:600">Characters (${chars.length})</h3>
            <button class="btn btn-sm" onclick="navigate('#/write/works/${id}/characters/new')"><img src="Icons/person-plus.png" width="12" style="vertical-align:middle;margin-right:4px">Add Character</button>
          </div>
          ${chars.length ? `<div class="ws-char-grid">${chars.map(c => `
            <div class="ws-char-card">
              <div class="${imageClass('ws-char-img', c.image || c.portrait)}" data-img-url="${c.image || c.portrait || ''}" data-img-context="workspace-character:${c.id}" style="${c.image || c.portrait ? imageBg(c.image || c.portrait, '') : 'background:var(--bg-hover)'}">${(c.image || c.portrait) ? '' : imageFallback(c.name)}</div>
              <div class="ws-char-body">
                <h4 class="ws-char-name">${c.name}</h4>
                ${c.nickname ? `<span class="ws-char-sub">"${escHtml(c.nickname)}"</span>` : `<span class="ws-char-sub">${escHtml(c.role || 'Character')}</span>`}
                ${c.description ? `<p class="ws-char-desc">${escHtml(c.description.length > 80 ? c.description.slice(0, 80) + '...' : c.description)}</p>` : ''}
                <div class="ws-char-actions">
                  <a class="btn btn-sm" href="#/book/${id}/character/${c.id}" style="text-decoration:none;font-size:0.55rem;padding:3px 8px;background:rgba(255,255,255,0.08);color:var(--text2)"><img src="Icons/view.png" width="10" style="vertical-align:middle;margin-right:3px">View</a>
                  <a class="btn btn-sm" href="#/write/works/${id}/characters/${c.id}" style="text-decoration:none;font-size:0.55rem;padding:3px 8px;background:var(--accent-subtle);color:var(--accent)"><img src="Icons/editpen.png" width="10" style="vertical-align:middle;margin-right:3px">Edit</a>
                  <button class="btn btn-sm ws-del-char" data-book="${id}" data-char="${c.id}" style="font-size:0.55rem;padding:3px 8px;color:var(--red)">Delete</button>
                </div>
              </div>
            </div>
          `).join('')}</div>` : '<p style="font-size:0.72rem;color:var(--text3);padding:16px 0;text-align:center">No characters yet. Add your first character.</p>'}
        ` : wsTab === 'Analytics' ? `
          <section class="content-section">
            <h3 class="section-title">Views</h3>
            <div class="prof-stats">
              <div class="prof-stat"><div class="prof-stat-val">${fmt(todayViews)}</div><div class="prof-stat-lbl">Today</div></div>
              <div class="prof-stat"><div class="prof-stat-val">${fmt(weekViews)}</div><div class="prof-stat-lbl">This Week</div></div>
              <div class="prof-stat"><div class="prof-stat-val">${fmt(monthViews)}</div><div class="prof-stat-lbl">This Month</div></div>
              <div class="prof-stat"><div class="prof-stat-val">${fmt(totalViews)}</div><div class="prof-stat-lbl">All Time</div></div>
            </div>
          </section>
          <section class="content-section">
            <h3 class="section-title">Flames</h3>
            <div class="book-info-grid">
              <div class="book-info-row"><span class="bir-lbl">Total Flames</span><span class="bir-val">${fmt(book.flames)}</span></div>
              <div class="book-info-row"><span class="bir-lbl">Unique Supporters</span><span class="bir-val">${uniqueSupporters}</span></div>
              <div class="book-info-row"><span class="bir-lbl">Total Donations</span><span class="bir-val">${supporters.length}</span></div>
              <div class="book-info-row"><span class="bir-lbl">Average per Donation</span><span class="bir-val">${supporters.length > 0 ? Math.round(book.flames / supporters.length) : 0}</span></div>
            </div>
          </section>
          <section class="content-section">
            <h3 class="section-title">Reading</h3>
            <div class="book-info-grid">
              <div class="book-info-row"><span class="bir-lbl">Est. Reading Time</span><span class="bir-val">${estReadTime} min</span></div>
              <div class="book-info-row"><span class="bir-lbl">Total Chapters</span><span class="bir-val">${book.chapterCount}</span></div>
              <div class="book-info-row"><span class="bir-lbl">Avg Views/Chapter</span><span class="bir-val">${fmt(avgViewsCh)}</span></div>
              <div class="book-info-row"><span class="bir-lbl">Followers</span><span class="bir-val">${fmt(book.favorites)}</span></div>
            </div>
          </section>
        ` : wsTab === 'Supporters' ? `
          <section class="content-section">
            <h3 class="section-title">Top Flame Givers</h3>
            ${topSupporters.length ? topSupporters.map((s,i) => `
            <div class="supporter-item">
              <span class="supporter-rank ${i===0?'s-rank-gold':i===1?'s-rank-silver':i===2?'s-rank-bronze':''}">${i+1}</span>
              <span class="supporter-avatar">${s.user[0]}</span>
              <span class="supporter-name">${s.user}</span>
              <span class="supporter-amount">${fmt(s.amount)} flames</span>
            </div>`).join('') : '<p style="font-size:0.72rem;color:var(--text3);padding:12px;text-align:center">No supporters yet</p>'}
          </section>
          <section class="content-section">
            <h3 class="section-title">Recent Supporters</h3>
            ${recentSupporters.length ? recentSupporters.slice(0,10).map(s => `
            <div class="supporter-item">
              <span class="supporter-avatar">${s.user[0]}</span>
              <span class="supporter-name">${s.user}</span>
              <span class="supporter-amount" style="font-size:0.6rem">${fmt(s.amount)} flames</span>
              <span style="font-size:0.55rem;color:var(--text3);margin-left:auto">${new Date(s.date).toLocaleDateString()}</span>
            </div>`).join('') : '<p style="font-size:0.72rem;color:var(--text3);padding:12px;text-align:center">No supporters yet</p>'}
          </section>
          <section class="content-section">
            <h3 class="section-title">Flame Statistics</h3>
            <div class="book-info-grid">
              <div class="book-info-row"><span class="bir-lbl">Total Flames</span><span class="bir-val">${fmt(book.flames)}</span></div>
              <div class="book-info-row"><span class="bir-lbl">Unique Supporters</span><span class="bir-val">${uniqueSupporters}</span></div>
              <div class="book-info-row"><span class="bir-lbl">Total Donations</span><span class="bir-val">${supporters.length}</span></div>
              <div class="book-info-row"><span class="bir-lbl">Average per Donation</span><span class="bir-val">${supporters.length > 0 ? Math.round(book.flames / supporters.length) : 0}</span></div>
              <div class="book-info-row"><span class="bir-lbl">Highest Donation</span><span class="bir-val">${supporters.length ? fmt(Math.max(...supporters.map(s => s.amount))) : 0}</span></div>
            </div>
          </section>
        ` : `
          <!-- Settings Tab -->
          <div class="prof-stats" style="margin-bottom:16px">
            <div class="prof-stat"><div class="prof-stat-val">${fmt(book.chapterCount)}</div><div class="prof-stat-lbl">Chapters</div></div>
            <div class="prof-stat"><div class="prof-stat-val">${fmt(totalViews)}</div><div class="prof-stat-lbl">Views</div></div>
            <div class="prof-stat"><div class="prof-stat-val">${fmt(book.flames)}</div><div class="prof-stat-lbl">Flames</div></div>
            <div class="prof-stat"><div class="prof-stat-val">${fmt(book.favorites)}</div><div class="prof-stat-lbl">Followers</div></div>
          </div>

          <!-- Book Details -->
          <div class="content-section" style="margin-bottom:12px">
            <h3 class="section-title" style="margin-bottom:12px">Book Details</h3>
            <div class="settings-form">
              <label class="settings-label">Title</label>
              <input class="input-field" id="settings-details-title" value="${book.title}">
              <label class="settings-label" style="margin-top:8px">Synopsis</label>
              <textarea class="input-field" id="settings-details-synopsis" rows="4">${(book.synopsis || '').replace(/</g,'&lt;')}</textarea>
              <div class="settings-form-row">
                <div class="settings-form-group">
                  <label class="settings-label">Genre</label>
                  <select class="input-field" id="settings-details-genre">${GENRES.map(g => `<option value="${g}"${book.genre===g?' selected':''}>${g}</option>`).join('')}</select>
                </div>
                <div class="settings-form-group">
                  <label class="settings-label">Type</label>
                  <select class="input-field" id="settings-details-type"><option value="Novel"${book.type==='Novel'?' selected':''}>Novel</option><option value="Fanfic"${book.type==='Fanfic'?' selected':''}>Fanfic</option></select>
                </div>
              </div>
              <label class="settings-label">Status</label>
              <select class="input-field" id="settings-details-status">
                <option value="Ongoing"${book.status==='Ongoing'?' selected':''}>Ongoing</option>
                <option value="Completed"${book.status==='Completed'?' selected':''}>Completed</option>
                <option value="Hiatus"${book.status==='Hiatus'?' selected':''}>Hiatus</option>
              </select>
              <label class="settings-label" style="margin-top:8px">Tags</label>
              <input class="input-field" id="settings-details-tags" value="${(book.tags||[]).join(', ')}">
              <span style="font-size:0.55rem;color:var(--text3);display:block;margin-bottom:8px">Separate tags with commas</span>
              <button class="btn btn-sm" id="settings-details-save" data-book="${id}" style="background:rgba(255,255,255,0.1);color:var(--accent)">Save Changes</button>
            </div>
          </div>

          <!-- Media -->
          <div class="content-section" style="margin-bottom:12px">
            <h3 class="section-title" style="margin-bottom:12px">Media</h3>
            <div class="settings-cover-area">
              <div class="${coverClass('book-settings-cover', coverImg)}" data-img-url="${coverImg}" data-img-context="settings-cover:${id}" style="width:80px;height:110px;margin:0 auto;${imageBg(coverImg, '')}">${coverImg ? '' : imageFallback(book.title)}</div>
              <input type="file" id="settings-cover-input" accept="image/*" style="display:none">
              <div class="settings-media-actions">
                <label for="settings-cover-input" class="btn btn-sm" style="margin-top:8px;display:inline-block">${coverImg ? 'Replace Cover' : 'Upload Cover'}</label>
                ${coverImg ? `<button class="btn btn-sm" id="settings-cover-remove" style="color:var(--red);margin-left:6px;margin-top:8px">Remove Cover</button>` : ''}
              </div>
            </div>
          </div>

          <!-- Publishing -->
          <div class="content-section" style="margin-bottom:12px">
            <h3 class="section-title" style="margin-bottom:12px">Publishing</h3>
            <div class="prof-faq-item"><strong>Visibility</strong><p>${book.status === 'Draft' ? 'Private - Only you can see this book' : 'Public - Anyone can read this book'}</p></div>
            <div class="prof-faq-item"><strong>Publication State</strong><p>${book.status === 'Draft' ? 'Unpublished' : 'Published'}</p></div>
            <div class="prof-faq-item"><strong>Reader Access</strong><p>${book.status === 'Draft' ? 'Not accessible to readers' : book.status === 'Completed' ? 'All chapters available' : 'New chapters in progress'}</p></div>
            <button class="btn btn-sm" id="settings-publish-btn" data-book="${id}" style="background:rgba(255,255,255,0.1);color:var(--accent);margin-top:6px">${book.status === 'Draft' ? 'Publish Book' : 'Unpublish Book'}</button>
          </div>

          <!-- Divider -->
          <div class="settings-divider"></div>

          <!-- Danger Zone -->
          <div class="content-section settings-danger">
            <h3 class="section-title" style="color:var(--red);margin-bottom:8px">Danger Zone</h3>
            <p style="font-size:0.65rem;color:var(--text3);margin-bottom:10px;line-height:1.5">Once you delete a book, there is no going back. Please be certain.</p>
            <button class="btn btn-sm" id="settings-delete-btn" data-book="${id}" style="background:var(--red);color:#fff">Delete Book</button>
          </div>
        `}
      </div>
    </div>`;
}

// ---- Create Chapter ----
function editorToolbarHtml() {
  return `<div class="editor-toolbar">
      <button type="button" class="ed-fmt ed-fmt-bold" data-fmt="**" title="Bold"><strong>B</strong></button>
      <button type="button" class="ed-fmt ed-fmt-italic" data-fmt="*" title="Italic"><em>I</em></button>
      <button type="button" class="ed-fmt ed-fmt-underline" data-fmt="++" title="Underline"><u>U</u></button>
      <button type="button" class="ed-fmt ed-fmt-img" data-img-insert title="Insert Image">&#128444;</button>
      <span class="editor-toolbar-hint">Format: <strong>**bold**</strong>, <em>*italic*</em> or <u>++underline++</u></span>
    </div>`;
}

function renderCreateChapter(bookId) {
  const book = getBook(bookId);
  if (!book) return '<div class="page"><h2>Book not found</h2></div>';
  return `
    <div class="editor-shell">
      <div class="editor-topbar">
        <a class="back-link" href="#/write/works/${bookId}" style="padding:0;font-size:0.85rem"><img src="Icons/open-book.png" width="12" style="vertical-align:middle;margin-right:4px">Back</a>
        <span style="flex:1;font-size:0.82rem;font-weight:600;min-width:80px">${book.title} - New Chapter</span>
        <button type="submit" form="create-chapter-form" class="btn btn-primary ed-new-save" style="padding:5px 12px;font-size:0.65rem">Save Draft</button>
        <button type="button" class="btn btn-sm ed-publish-new" data-book="${bookId}" style="font-size:0.65rem;background:rgba(255,255,255,0.1);color:var(--accent)">Save &amp; Publish</button>
      </div>
      <div class="editor-scroll">
        <form id="create-chapter-form" data-book="${bookId}" class="editor-body" style="gap:14px">
          <input class="input-field" name="title" placeholder="Chapter Title" style="font-size:1rem;font-weight:700;border:none;padding:4px 0;background:transparent" required>
          ${editorToolbarHtml()}
          <textarea class="input-field" name="content" id="editor-content" placeholder="Write your chapter... (paste image links or use the Insert Image button)"></textarea>
        </form>
      </div>
    </div>`;
}

// ---- Insert Image modal (editor toolbar) ----
let _edImgCtx = null; // { editor }
function openImgInsertModal(btn) {
  if (document.getElementById('ed-img-modal')) return;
  const toolbar = btn && btn.closest ? btn.closest('.editor-toolbar') : null;
  const ta = toolbar ? toolbar.nextElementSibling : null;
  const editorEl = (ta && ta.tagName === 'TEXTAREA') ? ta : document.getElementById('editor-content');
  _edImgCtx = { editor: editorEl };
  const overlay = document.createElement('div');
  overlay.className = 'ed-img-overlay';
  const panel = document.createElement('div');
  panel.className = 'ed-img-panel';
  panel.innerHTML = `
    <h3>Insert Image</h3>
    <div class="ed-img-tabs">
      <button type="button" class="btn btn-sm active" data-edtab="link">Image URL</button>
      <button type="button" class="btn btn-sm" data-edtab="file">Upload</button>
    </div>
    <div data-edtab-pane="link">
      <input class="input-field" id="ed-img-url" placeholder="https://example.com/image.png" style="width:100%">
      <img class="ed-img-preview" id="ed-img-url-preview" alt="">
    </div>
    <div data-edtab-pane="file" style="display:none">
      <input type="file" id="ed-img-file" accept="image/*" style="width:100%">
      <img class="ed-img-preview" id="ed-img-file-preview" alt="">
    </div>
    <p id="ed-img-msg" style="font-size:0.6rem;color:var(--text3);min-height:0;margin:0"></p>
    <div class="ed-img-actions">
      <button type="button" class="btn btn-sm ed-img-cancel">Cancel</button>
      <button type="button" class="btn btn-primary ed-img-insert-btn">Insert</button>
    </div>`;
  const modal = document.createElement('div');
  modal.id = 'ed-img-modal';
  modal.className = 'ed-img-modal';
  modal.appendChild(overlay);
  modal.appendChild(panel);
  document.body.appendChild(modal);
}

function insertImgIntoEditor(editorEl, url, altText) {
  if (!editorEl || !url) return;
  const start = editorEl.selectionStart;
  const end = editorEl.selectionEnd;
  const val = editorEl.value || '';
  const prefix = (start > 0 && !/\s$/.test(val[start - 1]) && !/^\s/.test(val.slice(start, start + 1))) ? '\n' : '';
  const suffix = (end < val.length && !/^\s/.test(val[end]) && !/\s$/.test(val.slice(end - 1, end))) ? '\n' : '';
  const ins = prefix + url + suffix;
  editorEl.value = val.slice(0, start) + ins + val.slice(end);
  editorEl.setSelectionRange(start + ins.length, start + ins.length);
  editorEl.focus();
  editorEl.dispatchEvent(new Event('input'));
}

function bindImgInsertModal() {
  const modal = document.getElementById('ed-img-modal');
  if (!modal) return;
  let fileData = null;
  const urlInput = modal.querySelector('#ed-img-url');
  const urlPreview = modal.querySelector('#ed-img-url-preview');
  const fileInput = modal.querySelector('#ed-img-file');
  const filePreview = modal.querySelector('#ed-img-file-preview');
  const msg = modal.querySelector('#ed-img-msg');
  const dismiss = () => { modal.remove(); fileData = null; };
  modal.querySelector('.ed-img-cancel').addEventListener('click', dismiss);
  modal.querySelector('.ed-img-overlay').addEventListener('click', dismiss);
  modal.querySelectorAll('.ed-img-tabs .btn').forEach(tab => {
    tab.addEventListener('click', () => {
      modal.querySelectorAll('.ed-img-tabs .btn').forEach(b => b.classList.toggle('active', b === tab));
      const name = tab.dataset.edtab;
      modal.querySelectorAll('[data-edtab-pane]').forEach(p => p.style.display = (p.dataset.edtabPane === name) ? '' : 'none');
      msg.textContent = '';
    });
  });
  urlInput.addEventListener('input', () => {
    msg.textContent = '';
    if (/^https?:\/\/.+/i.test(urlInput.value.trim())) {
      urlPreview.src = urlInput.value.trim();
      urlPreview.classList.add('show');
    } else {
      urlPreview.classList.remove('show');
      urlPreview.removeAttribute('src');
    }
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files[0];
    msg.textContent = '';
    if (!f) { fileData = null; filePreview.classList.remove('show'); return; }
    if (!/^image\//.test(f.type)) { msg.textContent = 'Please choose an image file.'; return; }
    const r = new FileReader();
    r.onload = e => { fileData = e.target.result; filePreview.src = fileData; filePreview.classList.add('show'); };
    r.readAsDataURL(f);
  });
  modal.querySelector('.ed-img-insert-btn').addEventListener('click', () => {
    const tab = modal.querySelector('.ed-img-tabs .btn.active').dataset.edtab;
    let url = '';
    if (tab === 'file') {
      if (!fileData) { msg.textContent = 'Choose an image file first.'; return; }
      url = fileData;
    } else {
      url = urlInput.value.trim();
      if (!/^https?:\/\/.+/i.test(url)) { msg.textContent = 'Enter a valid image URL.'; return; }
    }
    const editorEl = _edImgCtx && _edImgCtx.editor;
    if (!editorEl) { msg.textContent = 'No editor target found.'; return; }
    insertImgIntoEditor(editorEl, url);
    dismiss();
    _edImgCtx = null;
  });
}

// ---- Characters: shared form + image cropper ----
function characterFormFields(c) {
  c = c || {};
  const img = c.image || c.portrait || '';
  return `
    <div class="form-group">
      <label>Portrait Image</label>
      <div class="img-upload-wrap">
        <input type="file" accept="image/*" id="char-portrait-input" style="display:none">
        <div id="char-portrait-preview" class="img-preview" data-image="${escHtml(img)}" ${img ? `style="${imageBg(img, '')}"` : ''}>${img ? '' : '+'}</div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <button type="button" class="btn btn-sm char-upload-btn" style="width:max-content"><img src="Icons/editpen.png" width="12" style="vertical-align:middle;margin-right:4px">Upload &amp; Crop</button>
          ${img ? '<button type="button" class="btn btn-sm char-remove-img" style="width:max-content;color:var(--red)">Remove Image</button>' : ''}
        </div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Name</label>
        <input class="input-field" name="name" value="${escHtml(c.name || '')}" placeholder="Character name" required>
      </div>
      <div class="form-group">
        <label>Nickname</label>
        <input class="input-field" name="nickname" value="${escHtml(c.nickname || '')}" placeholder="Nickname / alias">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Age</label>
        <input class="input-field" name="age" value="${escHtml(c.age || '')}" placeholder="e.g. 17">
      </div>
      <div class="form-group">
        <label>Height</label>
        <input class="input-field" name="height" value="${escHtml(c.height || '')}" placeholder="e.g. 170 cm">
      </div>
      <div class="form-group">
        <label>Weight</label>
        <input class="input-field" name="weight" value="${escHtml(c.weight || '')}" placeholder="e.g. 60 kg">
      </div>
    </div>
    <div class="form-group">
      <label>Role</label>
      <input class="input-field" name="role" value="${escHtml(c.role || '')}" placeholder="Protagonist, Antagonist, etc.">
    </div>
    <div class="form-group">
      <label>Description</label>
      <textarea class="input-field" name="description" placeholder="Describe your character..." rows="5">${escHtml(c.description || '')}</textarea>
    </div>`;
}

function cropModalHtml() {
  return `
    <div class="crop-modal" id="crop-modal" style="display:none">
      <div class="crop-overlay" id="crop-overlay"></div>
      <div class="crop-panel">
        <div class="crop-panel-header">
          <span class="crop-title">Crop Character Image</span>
          <span class="crop-hint">Drag image or box to position &middot; corners/edges resize &middot; 4:5 portrait &middot; scroll or pinch to zoom</span>
        </div>
        <div class="crop-stage" id="crop-stage">
          <img id="crop-img" alt="crop">
          <div class="crop-box" id="crop-box">
            <span class="crop-handle ch-nw"></span><span class="crop-handle ch-n"></span><span class="crop-handle ch-ne"></span>
            <span class="crop-handle ch-w"></span><span class="crop-handle ch-e"></span>
            <span class="crop-handle ch-sw"></span><span class="crop-handle ch-s"></span><span class="crop-handle ch-se"></span>
          </div>
        </div>
        <div class="crop-zoom-bar">
          <button type="button" class="btn btn-sm crop-zoom-btn" id="crop-zoom-out" title="Zoom out">&minus;</button>
          <span class="crop-zoom-val" id="crop-zoom-val">100%</span>
          <button type="button" class="btn btn-sm crop-zoom-btn" id="crop-zoom-in" title="Zoom in">+</button>
        </div>
        <div class="crop-actions">
          <button type="button" class="btn btn-sm" id="crop-reset">Reset</button>
          <button type="button" class="btn btn-sm" id="crop-cancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="crop-apply">Apply Crop</button>
        </div>
      </div>
    </div>`;
}

// Crop engine state. RATIO = the final crop aspect (4:5 portrait), the same as
// the character card display ratio so saved images fill their containers 1:1.
const CROP_RATIO = 4 / 5;
let cropCtx = null;

function charCropOpen(file, onApply) {
  const modal = document.getElementById('crop-modal');
  const stage = document.getElementById('crop-stage');
  const disp = document.getElementById('crop-img');
  const box = document.getElementById('crop-box');
  if (!modal || !stage || !disp || !box) return;
  const src = file instanceof File ? URL.createObjectURL(file) : file;
  const srcObj = file instanceof File;
  const srcImg = new Image();
  cropCtx = { onApply, srcImg, srcObj, ready: false };
  srcImg.onload = () => {
    cropCtx.ready = true;
    const sr = stage.getBoundingClientRect();
    cropCtx.stageW = sr.width;
    cropCtx.stageH = sr.height;
    cropCtx.nw = srcImg.naturalWidth;
    cropCtx.nh = srcImg.naturalHeight;
    if (!cropCtx.nw || !cropCtx.nh) return cropClose(false);
    cropCtx.fit = Math.min(sr.width / cropCtx.nw, sr.height / cropCtx.nh);
    cropCtx.fill = Math.max(sr.width / cropCtx.nw, sr.height / cropCtx.nh);
    cropCtx.minZoom = cropCtx.fill / cropCtx.fit; // always cover the stage, so a 4:5 box fits
    cropZoomTo(cropCtx.minZoom, true);
    cropReset();
  };
  disp.src = src;
  srcImg.src = src;
  modal.style.display = 'flex';
}

// Move/scale the displayed image (zooming always stays anchored on the crop box center)
function cropZoomTo(z, skipLabel) {
  if (!cropCtx || !cropCtx.ready) return;
  const box = document.getElementById('crop-box');
  const stage = document.getElementById('crop-stage');
  const ir = cropCtx.imgRect || { left: 0, top: 0, width: 0, height: 0 };
  const bx = box ? box.offsetLeft + box.offsetWidth / 2 : stage.offsetWidth / 2;
  const by = box ? box.offsetTop + box.offsetHeight / 2 : stage.offsetHeight / 2;
  const fx = ir.width ? (bx - ir.left) / ir.width : 0.5;
  const fy = ir.height ? (by - ir.top) / ir.height : 0.5;
  const zc = Math.max(cropCtx.minZoom || 1, Math.min(8, z));
  cropCtx.zoom = zc;
  const w = cropCtx.nw * cropCtx.fit * zc;
  const h = cropCtx.nh * cropCtx.fit * zc;
  let left = bx - fx * w;
  let top = by - fy * h;
  const stageW = (stage && stage.offsetWidth) || w;
  const stageH = (stage && stage.offsetHeight) || h;
  if (w < stageW) left = (stageW - w) / 2;
  if (h < stageH) top = (stageH - h) / 2;
  cropCtx.imgRect = { left, top, width: w, height: h };
  applyImageRect();
  if (!skipLabel) updateZoomLabel();
}

function applyImageRect() {
  const img = document.getElementById('crop-img');
  if (!img || !cropCtx || !cropCtx.imgRect) return;
  const ir = cropCtx.imgRect;
  img.style.left = ir.left + 'px';
  img.style.top = ir.top + 'px';
  img.style.width = ir.width + 'px';
  img.style.height = ir.height + 'px';
}

function cropZoomBy(delta) {
  if (!cropCtx || !cropCtx.ready) return;
  cropZoomTo((cropCtx.zoom || cropCtx.minZoom || 1) + delta);
}

function updateZoomLabel() {
  const el = document.getElementById('crop-zoom-val');
  if (el && cropCtx) el.textContent = Math.round(((cropCtx.zoom || 1)) * 100) + '%';
}

function setBox(r) {
  const box = document.getElementById('crop-box');
  if (!box) return;
  box.style.left = r.left + 'px';
  box.style.top = r.top + 'px';
  box.style.width = r.width + 'px';
  box.style.height = r.height + 'px';
}

// Keep a crop rect fully inside the current image rect while preserving the ratio
function clampBox(l, t, w, h) {
  const ir = cropCtx && cropCtx.imgRect;
  if (!ir) return { left: l, top: t, width: w, height: h };
  const mn = Math.min(48, Math.min(ir.width, ir.height));
  w = Math.max(mn, Math.min(w, ir.width));
  h = w / CROP_RATIO;
  if (h > ir.height) { h = ir.height; w = h * CROP_RATIO; }
  if (w > ir.width) { w = ir.width; h = w / CROP_RATIO; }
  if (h < mn) { h = mn; w = h * CROP_RATIO; }
  if (w < mn) { w = mn; h = w / CROP_RATIO; }
  l = Math.max(ir.left, Math.min(l, ir.left + ir.width - w));
  t = Math.max(ir.top, Math.min(t, ir.top + ir.height - h));
  return { left: l, top: t, width: w, height: h };
}

function cropReset() {
  if (!cropCtx || !cropCtx.ready) return;
  cropZoomTo(cropCtx.minZoom, true);
  const ir = cropCtx.imgRect;
  let w = Math.min(ir.width, ir.height * CROP_RATIO) * 0.8;
  let h = w / CROP_RATIO;
  if (h > ir.height) { h = ir.height; w = h * CROP_RATIO; }
  const r = clampBox(ir.left + (ir.width - w) / 2, ir.top + (ir.height - h) / 2, w, h);
  setBox(r);
  updateZoomLabel();
}

// Ratio-locked resize: dragging a handle keeps the opposite corner/edge anchored
// and forces width:height = 4:5.
function resizeFromHandle(mode, o, px, py) {
  const R = o.left + o.width, B = o.top + o.height;
  const Cx = o.left + o.width / 2, Cy = o.top + o.height / 2;
  const mn = 48;
  let L, T, W, H;
  switch (mode) {
    case 'nw': W = Math.max(mn, R - px); H = W / CROP_RATIO; L = R - W; T = B - H; break;
    case 'ne': W = Math.max(mn, px - o.left); H = W / CROP_RATIO; L = o.left; T = B - H; break;
    case 'sw': W = Math.max(mn, R - px); H = W / CROP_RATIO; L = R - W; T = o.top; break;
    case 'se': W = Math.max(mn, px - o.left); H = W / CROP_RATIO; L = o.left; T = o.top; break;
    case 'n': H = Math.max(mn, B - py); W = H * CROP_RATIO; T = B - H; L = Cx - W / 2; break;
    case 's': H = Math.max(mn, py - o.top); W = H * CROP_RATIO; T = o.top; L = Cx - W / 2; break;
    case 'w': W = Math.max(mn, R - px); H = W / CROP_RATIO; L = R - W; T = Cy - H / 2; break;
    case 'e': W = Math.max(mn, px - o.left); H = W / CROP_RATIO; L = o.left; T = Cy - H / 2; break;
    default: return o;
  }
  return clampBox(L, T, W, H);
}

function cropClose(apply) {
  if (cropCtx && cropCtx.srcObj) URL.revokeObjectURL(cropCtx.srcImg.src);
  cropCtx = null;
  const modal = document.getElementById('crop-modal');
  if (modal) modal.style.display = 'none';
}

function charCropApply() {
  if (!cropCtx || !cropCtx.ready) return;
  const ir = cropCtx.imgRect;
  const stage = document.getElementById('crop-stage');
  const box = document.getElementById('crop-box');
  if (!ir || !stage || !box) return;
  const sr = stage.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const bLeft = br.left - sr.left, bTop = br.top - sr.top;
  // Box -> natural image coordinates
  const sx = Math.max(0, Math.min(ir.width ? (bLeft / ir.width) : 0, 1)) * cropCtx.nw;
  const sy = Math.max(0, Math.min(ir.height ? (bTop / ir.height) : 0, 1)) * cropCtx.nh;
  let sw = Math.min((br.width / ir.width) * cropCtx.nw, cropCtx.nw - sx);
  let sh = Math.min((br.height / ir.height) * cropCtx.nh, cropCtx.nh - sy);
  sw = Math.max(1, sw); sh = Math.max(1, sh);
  // Output at exact 4:5 (snap the short side up so nothing is distorted or cut)
  let oW = Math.round(sw), oH = Math.round(sh);
  if (oW / oH < CROP_RATIO) oH = Math.round(oW / CROP_RATIO);
  else oW = Math.round(oH * CROP_RATIO);
  const maxDim = 1200;
  if (Math.max(oW, oH) > maxDim) { const k = maxDim / Math.max(oW, oH); oW = Math.round(oW * k); oH = Math.round(oH * k); }
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, oW); cv.height = Math.max(1, oH);
  const ctx = cv.getContext('2d');
  ctx.drawImage(cropCtx.srcImg, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
  const dataUrl = cv.toDataURL('image/jpeg', 0.92);
  const onApply = cropCtx.onApply;
  cropClose(true);
  if (onApply) onApply(dataUrl);
}

function bindCharCropper() {
  const modal = document.getElementById('crop-modal');
  if (!modal) return;
  const stage = document.getElementById('crop-stage');
  const box = document.getElementById('crop-box');

  document.getElementById('crop-overlay').addEventListener('click', () => cropClose(false));
  document.getElementById('crop-cancel').addEventListener('click', () => cropClose(false));
  document.getElementById('crop-reset').addEventListener('click', cropReset);
  document.getElementById('crop-apply').addEventListener('click', charCropApply);
  const zi = document.getElementById('crop-zoom-in');
  const zo = document.getElementById('crop-zoom-out');
  if (zi) zi.addEventListener('click', () => cropZoomBy(0.25));
  if (zo) zo.addEventListener('click', () => cropZoomBy(-0.25));

  // Mouse-wheel zoom over the stage
  stage.addEventListener('wheel', e => {
    if (!cropCtx || !cropCtx.ready) return;
    e.preventDefault();
    cropZoomBy(e.deltaY < 0 ? 0.1 : -0.1);
  }, { passive: false });

  // Drag the IMAGE (empty stage area) to reposition it under the fixed box
  let imgDrag = null;
  stage.addEventListener('pointerdown', e => {
    if (!cropCtx || !cropCtx.ready || (pinchActive)) return;
    if (box && e.target && e.target.closest && e.target.closest('#crop-box')) return;
    imgDrag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, left: cropCtx.imgRect.left, top: cropCtx.imgRect.top };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', e => {
    if (!cropCtx || !cropCtx.ready || !imgDrag || imgDrag.id !== e.pointerId) return;
    const ir = cropCtx.imgRect;
    const b = box;
    // image may only move while keeping the box fully inside it
    const minL = b.offsetLeft + b.offsetWidth - ir.width;
    const maxL = b.offsetLeft;
    const minT = b.offsetTop + b.offsetHeight - ir.height;
    const maxT = b.offsetTop;
    const nl = Math.max(minL, Math.min(maxL, imgDrag.left + (e.clientX - imgDrag.sx)));
    const nt = Math.max(minT, Math.min(maxT, imgDrag.top + (e.clientY - imgDrag.sy)));
    cropCtx.imgRect.left = nl;
    cropCtx.imgRect.top = nt;
    applyImageRect();
  });
  const endImgDrag = e => { if (imgDrag && imgDrag.id === e.pointerId) imgDrag = null; };
  stage.addEventListener('pointerup', endImgDrag);
  stage.addEventListener('pointercancel', endImgDrag);
  let pinchActive = false;

  // Pinch zoom (two fingers)
  let pinch = null;
  stage.addEventListener('touchstart', e => {
    if (!cropCtx || !cropCtx.ready) return;
    if (e.touches.length === 2) {
      pinchActive = true;
      imgDrag = null;
      const a = e.touches[0], b = e.touches[1];
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), zoom: cropCtx.zoom || cropCtx.minZoom || 1 };
    }
  }, { passive: true });
  stage.addEventListener('touchmove', e => {
    if (!cropCtx || !cropCtx.ready) return;
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const a = e.touches[0], b = e.touches[1];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinch.d > 0) cropZoomTo(pinch.zoom * (d / pinch.d));
    }
  }, { passive: false });
  const endPinch = () => { pinch = null; pinchActive = false; };
  stage.addEventListener('touchend', endPinch);
  stage.addEventListener('touchcancel', endPinch);

  if (stage && box) {
    const drag = { mode: null };
    box.addEventListener('pointerdown', e => {
      if (!cropCtx || !cropCtx.ready || pinchActive) return;
      e.preventDefault();
      const br = box.getBoundingClientRect();
      const mres = (e.target.className.match(/ch-(\w+)/) || [])[1];
      drag.mode = mres || 'move';
      drag.sx = e.clientX; drag.sy = e.clientY;
      drag.ox = br.left; drag.oy = br.top; drag.ow = br.width; drag.oh = br.height;
      box.setPointerCapture(e.pointerId);
    });
    box.addEventListener('pointermove', e => {
      if (!cropCtx || !drag.mode || pinchActive) { drag.mode = null; return; }
      if (!cropCtx.ready) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      let r;
      if (drag.mode === 'move') {
        r = clampBox(drag.ox + dx, drag.oy + dy, drag.ow, drag.oh);
      } else {
        r = resizeFromHandle(drag.mode, { left: drag.ox, top: drag.oy, width: drag.ow, height: drag.oh }, e.clientX, e.clientY);
      }
      setBox(r);
    });
    const endDrag = () => { drag.mode = null; };
    box.addEventListener('pointerup', endDrag);
    box.addEventListener('pointercancel', endDrag);
  }
}

// ---- Create Character ----
function renderCreateCharacter(bookId) {
  const book = getBook(bookId);
  if (!book) return '<div class="page"><h2>Book not found</h2></div>';
  return `
    <div class="page">
      <a class="back-link" href="#/write/works/${bookId}"><img src="Icons/open-book.png" width="12" style="vertical-align:middle;margin-right:4px">Back to ${escHtml(book.title)}</a>
      <h1 class="page-title">New Character</h1>
      <form id="create-character-form" data-book="${bookId}" class="char-form-card" style="display:flex;flex-direction:column;gap:14px">
        ${characterFormFields()}
        <button type="submit" class="btn btn-primary"><img src="Icons/person-plus.png" width="12" style="vertical-align:middle;margin-right:4px">Add Character</button>
      </form>
      ${cropModalHtml()}
    </div>`;
}

// ---- Edit Character (author's own space) ----
function renderEditCharacter(bookId, charId) {
  const book = getBook(bookId);
  const c = (state.characters[bookId] || []).find(x => x.id === charId);
  if (!book || !c) return '<div class="page"><h2>Character not found</h2></div>';
  return `
    <div class="page">
      <a class="back-link" href="#/write/works/${bookId}"><img src="Icons/open-book.png" width="12" style="vertical-align:middle;margin-right:4px">Back to ${escHtml(book.title)}</a>
      <h1 class="page-title">Edit Character</h1>
      <p style="font-size:0.62rem;color:var(--text3);margin:-8px 0 12px"><a href="#/book/${bookId}/character/${charId}" style="color:var(--accent)">View public character page</a></p>
      <form id="edit-character-form" data-book="${bookId}" data-char="${charId}" class="char-form-card" style="display:flex;flex-direction:column;gap:14px">
        ${characterFormFields(c)}
        <div style="display:flex;gap:8px">
          <button type="submit" class="btn btn-primary" style="flex:1"><img src="Icons/settings.png" width="12" style="vertical-align:middle;margin-right:4px">Save Changes</button>
          <button type="button" class="btn btn-sm ws-del-char" data-book="${bookId}" data-char="${charId}" style="color:var(--red)">Delete Character</button>
        </div>
      </form>
      ${cropModalHtml()}
    </div>`;
}

// ---- Editor ----
function renderEditor(bookId, chapterId) {
  const book = getBook(bookId);
  const chapter = (state.chapters[bookId] || []).find(c => c.id === chapterId);
  if (!book || !chapter) return '<div class="page"><h2>Not found</h2></div>';

  return `
    <div class="editor-shell">
      <div class="editor-topbar">
        <a class="back-link" href="#/write/works/${bookId}" style="padding:0;font-size:0.85rem"><img src="Icons/open-book.png" width="12" style="vertical-align:middle;margin-right:4px">Back</a>
        <span style="flex:1;font-size:0.82rem;font-weight:600;min-width:80px">${book.title} - Ch.${chapter.chapterNumber}</span>
        <span id="editor-autosave-status" style="font-size:0.6rem;color:var(--text3);margin-right:6px"></span>
        <button class="btn btn-sm ed-save" data-book="${bookId}" data-ch="${chapterId}" style="font-size:0.65rem"><img src="Icons/settings.png" width="12" style="vertical-align:middle;margin-right:4px">Save</button>
        <button class="btn btn-sm ed-revisions" data-book="${bookId}" data-ch="${chapterId}" style="font-size:0.65rem"><img src="Icons/books-stack-of-three.png" width="12" style="vertical-align:middle;margin-right:4px">History</button>
        <button class="btn btn-primary ed-publish" data-book="${bookId}" data-ch="${chapterId}" style="padding:5px 12px;font-size:0.65rem">${chapter.published?'Unpublish':'Publish'}</button>
      </div>
      <div class="editor-scroll">
        <div class="editor-body">
          <input id="editor-title" class="input-field" style="font-size:1rem;font-weight:700;border:none;padding:4px 0;margin-bottom:12px;background:transparent" value="${chapter.title}" placeholder="Chapter Title">
          ${editorToolbarHtml()}
          <textarea id="editor-content" placeholder="Start writing...">${chapter.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
        </div>
      </div>
    </div>

    <!-- Revision History Modal -->
    <div class="ch-list-modal" id="rev-modal" style="display:none">
      <div class="ch-list-overlay"></div>
      <div class="ch-list-panel">
        <div class="ch-list-header" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line2)">
          <span style="font-weight:600;font-size:0.85rem"><img src="Icons/books-stack-of-three.png" width="14" style="vertical-align:middle;margin-right:6px">Revision History</span>
          <button class="btn btn-sm ic-x rd-rev-close" title="Close"><img src="Icons/icons8-cancel-24.png" alt="Close"></button>
        </div>
        <div class="ch-list-body" id="rev-list-body" style="overflow-y:auto;max-height:60vh">
          <p style="font-size:0.65rem;color:var(--text3);padding:16px;text-align:center">Loading...</p>
        </div>
        <div id="rev-preview-area" style="display:none;border-top:1px solid var(--line2);padding:12px 16px;max-height:200px;overflow-y:auto">
          <h4 id="rev-preview-title" style="font-size:0.75rem;font-weight:600;margin-bottom:6px"></h4>
          <pre id="rev-preview-content" style="font-size:0.65rem;color:var(--text2);white-space:pre-wrap;line-height:1.5"></pre>
          <button class="btn btn-sm btn-primary rd-rev-restore" id="rev-restore-btn" style="margin-top:8px;font-size:0.65rem">Restore This Version</button>
        </div>
      </div>
    </div>`;
}

// ---- Explore ----
let expGenre = null, expRankTab = 'Popular';
function renderExplore(type) {
  const books = state.books.filter(b => b.type === type && isPublicBook(b));
  const filtered = expGenre ? books.filter(b => b.genre === expGenre) : books;
  const rankTabs = ['Popular','New'];
  const sorted = [...books].sort((a,b) => expRankTab === 'New' ? new Date(b.createdAt) - new Date(a.createdAt) : b.flames - a.flames).slice(0, 30);

  return `
    <div class="page">
      <h1 class="page-title">Explore</h1>
      <div class="tabs" style="border-bottom:1px solid var(--line2);margin-bottom:14px">
        <a class="tab${type==='Novel'?' active':''}" href="${type==='Novel'?'#/explore/novel':'#/explore/novel'}">Novel</a>
        <a class="tab${type==='Fanfic'?' active':''}" href="#/explore/fanfic">Fanfic</a>
      </div>
      ${books.length ? `
      <section class="content-section">
        <h2 class="section-title" style="margin-bottom:8px">Genre</h2>
        <div class="genre-grid">${GENRES.map(g => `<span class="genre-tag${expGenre===g?' active':''}" data-exp-genre="${g}">${g}</span>`).join('')}</div>
      </section>
      ${expGenre ? `
      <section class="content-section">
        <h2 class="section-title" style="margin-bottom:8px">Results (${filtered.length})</h2>
        ${filtered.length ? filtered.map(n => hBookCard(n)).join('') : '<p style="font-size:0.72rem;color:var(--text3);padding:16px 0;text-align:center">No books found</p>'}
      </section>` : ''}
      <section class="content-section">
        <div class="section-header"><h2 class="section-title">Rankings</h2></div>
        <div style="display:flex;margin-bottom:8px">
          ${rankTabs.map(t => `<span class="tab${expRankTab===t?' active':''}" data-rank-tab="${t}" style="padding:6px 12px;font-size:0.65rem">${t}</span>`).join('')}
        </div>
        <div class="ranking-list">${sorted.map((n,i) => rankingItem(n,i)).join('')}</div>
      </section>` : `
      <div class="empty-state">
        <h3>No ${type.toLowerCase()}s yet</h3>
        <p>Published books will appear here</p>
        <a class="btn btn-primary" href="#/explore">Browse</a>
      </div>`}
    </div>`;
}

// ---- Profile (Account Settings Center) ----
function renderProfile() {
  const u = state.user;
  const myBooks = getBooksByAuthor();
  const totalViews = myBooks.reduce((s,b) => s + (b.views || 0), 0);
  const totalFlames = myBooks.reduce((s,b) => s + (b.flames || 0), 0);
  const pubBooks = myBooks.filter(b => b.status !== 'Draft').length;
  const draftBooks = myBooks.filter(b => b.status === 'Draft').length;
  const compBooks = myBooks.filter(b => b.status === 'Completed').length;
  const bannerImg = u.banner ? u.banner : '';
  const avatarImg = u.avatar ? u.avatar : '';
  const exp = u.exp || 0;
  const expToNext = u.expToNext || 100;
  const expPct = Math.min(100, Math.round((exp / expToNext) * 100));

  // Achievements
  const achInfo = computeAchievements();
  const achievements = achInfo.achievements;
  const lockedAch = achInfo.locked.length;

  // Recently Read - last 3 books with progress
  const recentlyRead = myBooks.filter(b => b.lastReadAt).sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0)).slice(0, 3);

  // Daily rewards
  const today = new Date().toDateString();
  const dailyStreak = state.dailyStreak || 0;
  const flameLv = u.level || 1;
  const maxFlames = dailyFlameAllowance(flameLv);
  const rem = serverOnline ? (state.flamesRemaining ?? maxFlames) : Math.max(0, maxFlames - (state.flameDate === today ? state.flamesGiven : 0));

  return `
    <div class="page profile-page">
      <!-- Banner -->
      <div class="prof-banner${bannerImg ? ' has-bg' : ''}" data-img-url="${bannerImg}" data-img-context="profile-banner" style="${imageBg(bannerImg, '')}">
        <div class="prof-banner-actions">
          <button class="btn btn-sm banner-btn" onclick="document.getElementById('banner-input').click()">Change Banner</button>
          <input type="file" id="banner-input" accept="image/*" style="display:none">
        </div>
      </div>

      <!-- Avatar + Name + Level + EXP -->
      <div class="prof-header-main">
        <div class="prof-avatar-wrap">
          <div class="${imageClass('prof-avatar', avatarImg)}" data-img-url="${avatarImg}" data-img-context="profile-avatar" style="${imageBg(avatarImg, '')}">${avatarImg ? '' : imageFallback(u.username)}</div>
          <button class="prof-avatar-edit" onclick="document.getElementById('avatar-input').click()"></button>
          <input type="file" id="avatar-input" accept="image/*" style="display:none">
        </div>
        <div class="prof-header-info">
          <h1 class="prof-name">${u.username}</h1>
          <div class="prof-level-row">
            <span class="prof-level-badge">Lv.${u.level} Author</span>
            <span class="prof-join-date">Joined ${u.joinDate || 'recently'}</span>
          </div>
          <div class="prof-exp-row">
            <div class="prof-exp-bar"><div class="prof-exp-fill" style="width:${expPct}%"></div></div>
            <span class="prof-exp-text">${expPct}%</span>
          </div>
          <div class="prof-meta">Writing ${pubBooks} Book${pubBooks !== 1 ? 's' : ''}</div>
          <button class="btn btn-sm prof-edit-btn" onclick="navigate('#/profile/edit')">Edit</button>
        </div>
      </div>

      <!-- Statistics Row with Icons -->
      <div class="prof-stats">
        <div class="prof-stat"><img class="prof-stat-icon" src="Icons/books-stack-of-three.png"><span class="prof-stat-val">${myBooks.length}</span><span class="prof-stat-lbl">Books</span></div>
        <div class="prof-stat"><img class="prof-stat-icon" src="Icons/view.png"><span class="prof-stat-val">${fmt(totalViews)}</span><span class="prof-stat-lbl">Views</span></div>
        <div class="prof-stat"><img class="prof-stat-icon" src="Icons/fire.png"><span class="prof-stat-val">${fmt(totalFlames)}</span><span class="prof-stat-lbl">Flames</span></div>
        <div class="prof-stat"><img class="prof-stat-icon" src="Icons/user1.png"><span class="prof-stat-val">${fmt(u.followers)}</span><span class="prof-stat-lbl">Followers</span></div>
      </div>

      <!-- Daily Flames -->
      <div class="prof-rewards prof-rewards">
        <div class="prof-rewards-left">
          <span class="prof-rewards-icon"><img src="Icons/flames.png" width="22"></span>
          <div>
            <div class="prof-rewards-title">Daily Flames</div>
            <div class="prof-rewards-sub">${rem > 0 ? rem + ' Flame' + (rem > 1 ? 's' : '') + ' available' : 'All used today'}</div>
          </div>
        </div>
        <div class="prof-rewards-right">
          <span class="prof-streak">Lv.${flameLv} (${maxFlames}/day)</span>
          ${dailyStreak > 0 ? `<span class="prof-streak" style="margin-left:6px">Day ${dailyStreak}</span>` : ''}
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="prof-actions">
        <div class="prof-action" onclick="navigate('#/profile/edit')">
          <div class="prof-action-icon"><img src="Icons/user1.png" width="22"></div>
          <span class="prof-action-label">Edit Profile</span>
        </div>
        <div class="prof-action" onclick="navigate('#/inbox')">
          <div class="prof-action-icon"><img src="Icons/inbox.png" width="22"></div>
          <span class="prof-action-label">Inbox${unreadTotal() ? ' (' + unreadTotal() + ')' : ''}</span>
        </div>
        <div class="prof-action" onclick="navigate('#/profile/author')">
          <div class="prof-action-icon"><img src="Icons/user.png" width="22"></div>
          <span class="prof-action-label">Author Page</span>
        </div>
        <div class="prof-action" onclick="navigate('#/write')">
          <div class="prof-action-icon"><img src="Icons/open-book.png" width="22"></div>
          <span class="prof-action-label">New Book</span>
        </div>
      </div>

      <!-- Recently Read -->
      ${recentlyRead.length ? `
      <div class="content-section">
        <div class="section-header"><h3 class="section-title">Continue Reading</h3></div>
        <div class="book-row">
          ${recentlyRead.map(b => `
          <div class="book-card" onclick="navigate('#/book/${b.id}')">
            <div class="book-cover" style="background:${b.color || 'var(--bg-hover)'}">${b.title[0]}</div>
            <div class="book-info"><div class="book-title">${b.title}</div></div>
          </div>`).join('')}
        </div>
      </div>` : ''}

      <!-- Achievements -->
      ${achievements.length ? `
      <div class="content-section">
        <div class="section-header"><h3 class="section-title">Achievements</h3>${lockedAch ? `<span class="prof-ach-locked-note">+${lockedAch} locked</span>` : ''}</div>
        <div class="prof-achievements prof-achievements">
          ${achievements.map(a => `
          <div class="prof-achievement">
            <img src="${a.icon}" class="prof-achievement-icon">
            <span>${a.label}</span>
          </div>`).join('')}
        </div>
      </div>` : ''}

      <!-- My Works -->
      <div class="prof-section prof-section" onclick="navigate('#/write')" style="cursor:pointer">
        <div class="prof-section-icon"><img src="Icons/open-book.png" width="22"></div>
        <div class="prof-section-body"><span class="prof-section-title">My Works</span><span class="prof-section-desc">${pubBooks} published, ${draftBooks} drafts, ${compBooks} completed</span></div>
        <span class="prof-section-arrow">-</span>
      </div>

      <!-- FAQ (expandable) -->
      <div class="prof-section prof-section" id="prof-faq-toggle" style="cursor:pointer">
        <div class="prof-section-icon"><img src="Icons/help.png" width="20"></div>
        <div class="prof-section-body"><span class="prof-section-title">FAQ</span><span class="prof-section-desc">Common questions answered</span></div>
        <span class="prof-section-arrow" id="prof-faq-arrow">+</span>
      </div>
      <div class="prof-faq-content" id="prof-faq-content" style="display:none">
        <div class="prof-faq-item"><strong>How to publish?</strong><p>Create a book in Write, add chapters, then set status from Draft to Ongoing in workspace settings.</p></div>
        <div class="prof-faq-item"><strong>How rankings work?</strong><p>Books are ranked by total flames received. More flames = higher rank on Explore and Featured pages.</p></div>
        <div class="prof-faq-item"><strong>How flames work?</strong><p>Readers send flames to support books. Flames determine rankings and unlock supporter milestones.</p></div>
        <div class="prof-faq-item"><strong>How followers work?</strong><p>Users follow authors to get updates. More followers increase your author level and visibility.</p></div>
        <div class="prof-faq-item"><strong>How monetization works?</strong><p>Monetization is coming soon. Stay tuned for features like tipped chapters and premium content.</p></div>
      </div>

      <!-- Theme -->
      <div class="prof-section prof-section" onclick="navigate('#/profile/themes')" style="cursor:pointer">
        <div class="prof-section-icon"><img src="Icons/theme.png" width="20"></div>
        <div class="prof-section-body"><span class="prof-section-title">Theme</span><span class="prof-section-desc">Dark or Galaxy appearance</span></div>
        <span class="prof-section-arrow">-</span>
      </div>

      <!-- Services (expandable) -->
      <div class="prof-section prof-section" id="prof-services-toggle" style="cursor:pointer">
        <div class="prof-section-icon"><img src="Icons/settings.png" width="20"></div><span class="prof-section-desc">Policies, support, and guidelines</span></div>
        <span class="prof-section-arrow" id="prof-services-arrow">+</span>
      </div>
      <div class="prof-services-content" id="prof-services-content" style="display:none">
        <a class="prof-service-item">Privacy Policy</a>
        <a class="prof-service-item">Terms of Service</a>
        <a class="prof-service-item">Contact Support</a>
        <a class="prof-service-item">Report Problem</a>
        <a class="prof-service-item">Community Guidelines</a>
      </div>

      <!-- Account divider -->
      <div class="prof-account-divider"></div>

      <!-- Logout -->
      <div class="prof-section" style="cursor:pointer;border-left:2px solid var(--red)" onclick="if(confirm('Sign out?')){document.getElementById('sign-out-btn').click()}">
        <div class="prof-section-icon"><img src="Icons/icons8-logout-50.png" width="20" class="prof-icon-dim"></div>
        <div class="prof-section-body"><span class="prof-section-title" style="color:var(--red)">Logout</span><span class="prof-section-desc">Sign out of your account</span></div>
      </div>
      <div class="prof-section" style="cursor:pointer;margin-bottom:24px" onclick="if(confirm('Delete account permanently? This cannot be undone.')){localStorage.clear();location.reload()}">
        <div class="prof-section-icon"><img src="Icons/bin.png" width="20"></div>
        <div class="prof-section-body"><span class="prof-section-title" style="color:var(--text3)">Delete Account</span><span class="prof-section-desc">Permanently remove all data</span></div>
      </div>
    </div>`;
}

// ---- Edit Profile ----
function renderEditProfile() {
  const u = state.user;
  return `
    <div class="page edit-profile-page">
      <a class="back-link" href="#/profile">Back to Profile</a>
      <h1 class="page-title">Edit Profile</h1>
      <form id="edit-profile-form" style="display:flex;flex-direction:column;gap:16px">
        <section class="content-section">
          <h3 class="section-title">Images</h3>
          <div class="edit-img-row">
            <div class="edit-img-group">
              <label>Avatar</label>
              <div class="edit-avatar-preview" id="edit-avatar-preview" data-img-url="${u.avatar || ''}" data-img-context="edit-avatar" style="${imageBg(u.avatar, '')}">${u.avatar ? '' : imageFallback(u.username)}</div>
              <div class="edit-img-actions">
                <button type="button" class="btn btn-sm" onclick="document.getElementById('edit-avatar-input').click()">Upload</button>
                <button type="button" class="btn btn-sm" id="remove-avatar-btn" style="${u.avatar ? '' : 'display:none'}">Remove</button>
              </div>
              <input type="file" id="edit-avatar-input" accept="image/*" style="display:none">
            </div>
            <div class="edit-img-group">
              <label>Banner</label>
              <div class="edit-banner-preview" id="edit-banner-preview" data-img-url="${u.banner || ''}" data-img-context="edit-banner" style="${imageBg(u.banner, '')}"></div>
              <div class="edit-img-actions">
                <button type="button" class="btn btn-sm" onclick="document.getElementById('edit-banner-input').click()">Upload</button>
                <button type="button" class="btn btn-sm" id="remove-banner-btn" style="${u.banner ? '' : 'display:none'}">Remove</button>
              </div>
              <input type="file" id="edit-banner-input" accept="image/*" style="display:none">
            </div>
          </div>
        </section>
        <section class="content-section">
          <h3 class="section-title">Information</h3>
          <div class="form-group"><label>Pen Name</label><input class="input-field" name="username" value="${u.username}"></div>
          <div class="form-group"><label>Bio</label><textarea class="input-field" name="bio" rows="3">${u.bio}</textarea></div>
          <div class="form-group"><label>Website</label><input class="input-field" name="website" value="${u.website || ''}" placeholder="https://"></div>
          <div class="form-group"><label>Discord</label><input class="input-field" name="discord" value="${u.discord || ''}" placeholder="username#0000"></div>
          <div class="form-group"><label>Twitter / X</label><input class="input-field" name="twitter" value="${u.twitter || ''}" placeholder="@username"></div>
          <div class="form-group"><label>Facebook</label><input class="input-field" name="facebook" value="${u.facebook || ''}" placeholder="facebook.com/username"></div>
        </section>
        <button type="submit" class="btn btn-primary" style="width:100%">Save Changes</button>
      </form>
    </div>`;
}

// ---- Author Profile (Creator Hub - Public) ----
let authorTab = 'Overview';
let inboxTab = 'Notifications';
const ACHIEVEMENT_THRESHOLDS = [100000, 500000, 1000000];
const FLAME_MILESTONES = [1000, 5000, 10000, 50000, 100000];

function renderAuthorProfile() {
  const u = state.user;
  const allBooks = state.books;
  const ongoing = allBooks.filter(b => b.status === 'Ongoing');
  const completed = allBooks.filter(b => b.status === 'Completed');
  const hiatus = allBooks.filter(b => b.status === 'Hiatus' || b.status === 'Draft');
  const totalViews = allBooks.reduce((s,b) => s + (b.views || 0), 0);
  const totalFlames = allBooks.reduce((s,b) => s + (b.flames || 0), 0);
  const posts = state.wallPosts || [];
  const comments = state.profileComments || [];
  const supporters = state.supporterHistory || [];
  const topSupporters = [...supporters].sort((a,b) => b.amount - a.amount).slice(0, 20);
  const totalFans = new Set(supporters.map(s => s.user)).size;

  const achievements = [];
  if (allBooks.length >= 1) achievements.push('First Book');
  if (allBooks.length >= 3) achievements.push('3 Books');
  if (allBooks.length >= 5) achievements.push('5 Books');
  ACHIEVEMENT_THRESHOLDS.forEach(t => {
    if (totalViews >= t) achievements.push(fmt(t) + ' Views');
  });
  const topAuthors = [...allBooks].sort((a,b) => b.flames - a.flames).slice(0, 3);
  if (topAuthors.length > 0 && topAuthors[0].flames > 0) achievements.push('Top Ranked');

  const bannerImg = u.banner ? u.banner : '';
  const avatarImg = u.avatar ? u.avatar : '';

  return `
    <div class="page author-profile">
      <div class="author-header">
        <div class="author-banner" data-img-url="${bannerImg}" data-img-context="author-banner" style="${imageBg(bannerImg, '')}"></div>
        <div class="author-header-content">
          <div class="author-info-row">
            <div class="${imageClass('author-avatar', avatarImg)}" data-img-url="${avatarImg}" data-img-context="author-avatar" style="${imageBg(avatarImg, '')}">${avatarImg ? '' : imageFallback(u.username)}</div>
            <div class="author-header-text">
              <h1 class="author-name">${u.username}</h1>
              <div class="author-badges-row">
                <span class="author-level-badge">Lv.${u.level} Author</span>
                ${allBooks.length >= 1 ? '<span class="author-verified">Published Author</span>' : ''}
                ${u.rank > 0 ? `<span class="author-rank-badge">Rank #${u.rank}</span>` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="author-stats">
        <div class="author-stat"><span class="author-stat-val">${fmt(u.followers)}</span><span class="author-stat-lbl">Followers</span></div>
        <div class="author-stat"><span class="author-stat-val">${allBooks.length}</span><span class="author-stat-lbl">Books</span></div>
        <div class="author-stat"><span class="author-stat-val">${fmt(totalViews)}</span><span class="author-stat-lbl">Views</span></div>
        <div class="author-stat"><span class="author-stat-val">${fmt(totalFlames)}</span><span class="author-stat-lbl">Flames</span></div>
      </div>

      ${u.bio ? `<p class="author-bio">${u.bio}</p>` : ''}

      <div class="author-actions">
        ${(state.following || []).includes(u.username) ?
          `<button class="btn btn-sm" disabled style="opacity:0.6;cursor:default">Following</button>` :
          `<button class="btn btn-primary author-follow-btn" data-author="${u.username}">+ Follow</button>`}
        <button class="btn btn-sm author-support-btn">Support</button>
      </div>

      <div class="author-tabs">
        ${['Overview','Books','Wall','Supporters','Comments'].map(t =>
          `<span class="tab${authorTab===t?' active':''}" data-author-tab="${t}">${t}</span>`
        ).join('')}
      </div>

      <div class="author-tab-content">
        ${authorTab === 'Overview' ? renderAuthorOverview(u, allBooks, achievements, totalViews, totalFlames) :
          authorTab === 'Books' ? renderAuthorBooks(ongoing, completed, hiatus) :
          authorTab === 'Wall' ? renderAuthorWall(u, posts) :
          authorTab === 'Supporters' ? renderAuthorSupporters(u, topSupporters, totalFans, totalFlames, supporters) :
          authorTab === 'Comments' ? renderAuthorComments(comments) : ''}
      </div>
    </div>`;
}

function renderAuthorOverview(u, allBooks, achievements, totalViews, totalFlames) {
  return `
    <section class="content-section">
      <h3 class="section-title">About</h3>
      <p style="font-size:0.72rem;color:var(--text2);line-height:1.7">${u.bio || 'No bio yet.'}</p>
    </section>
    ${achievements.length ? `
    <section class="content-section">
      <h3 class="section-title">Achievements</h3>
      <div class="achievement-list">${achievements.map(a => `<span class="achievement-badge">${a}</span>`).join('')}</div>
    </section>` : ''}
    <section class="content-section">
      <h3 class="section-title">Statistics</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:0.68rem">
        ${[['Followers', u.followers], ['Books', allBooks.length], ['Views', fmt(totalViews)], ['Flames', fmt(totalFlames)], ['Chapters', allBooks.reduce((s,b) => s + b.chapterCount, 0)], ['Rank', u.rank > 0 ? '#' + u.rank : 'Unranked']].map(([l,v]) => `
          <div style="display:flex;justify-content:space-between;padding:6px 8px;background:var(--bg-card);border-radius:var(--r);box-shadow:0 2px 8px rgba(0,0,0,0.15)">
            <span style="color:var(--text2)">${l}</span><span style="font-weight:600">${v}</span>
          </div>`).join('')}
      </div>
    </section>`;
}

function renderAuthorBooks(ongoing, completed, hiatus) {
  const hasAny = ongoing.length || completed.length || hiatus.length;
  if (!hasAny) return '<div class="empty-state"><h3>No books yet</h3><p>Create and publish your first book</p></div>';
  return `
    ${ongoing.length ? `<section class="content-section"><h3 class="section-title">Ongoing</h3><div class="book-row">${ongoing.map(bookCard).join('')}</div></section>` : ''}
    ${completed.length ? `<section class="content-section"><h3 class="section-title">Completed</h3><div class="book-row">${completed.map(bookCard).join('')}</div></section>` : ''}
    ${hiatus.length ? `<section class="content-section"><h3 class="section-title">Hiatus / Draft</h3><div class="book-row">${hiatus.map(bookCard).join('')}</div></section>` : ''}`;
}

function renderAuthorWall(u, posts) {
  return `
    <form id="wall-post-form" style="margin-bottom:16px">
      <textarea class="input-field" name="content" placeholder="Share an update with your readers..." rows="2" style="margin-bottom:6px"></textarea>
      <button type="submit" class="btn btn-primary" style="font-size:0.68rem;padding:6px 14px">Post</button>
    </form>
    ${posts.length ? posts.map(p => `
      <div class="wall-post">
        <div class="wall-post-header">
          <span class="wall-post-avatar">${u.username[0]}</span>
          <span class="wall-post-author">${u.username}</span>
          <span class="wall-post-date">${p.date}</span>
        </div>
        <p class="wall-post-content">${p.content}</p>
        <div class="wall-post-actions">
          <button class="btn btn-sm wall-like-btn" data-post="${p.id}" style="font-size:0.55rem;padding:3px 10px">${p.likes} Likes</button>
          <button class="btn btn-sm wall-del-btn" data-post="${p.id}" style="font-size:0.55rem;padding:3px 10px;color:var(--text3)">Delete</button>
        </div>
      </div>
    `).join('') : '<p style="font-size:0.72rem;color:var(--text3);text-align:center;padding:20px">No posts yet. Share your first update.</p>'}`;
}

function renderAuthorSupporters(u, topSupporters, totalFans, totalFlames, supporters) {
  const monthlySupporters = [...supporters].filter(s => {
    const d = new Date(s.date);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).sort((a,b) => b.amount - a.amount).slice(0, 10);

  return `
    <section class="content-section">
      <h3 class="section-title">Top Supporters</h3>
      ${topSupporters.length ? `<div class="supporters-list">${topSupporters.map((s,i) => `
        <div class="supporter-item">
          <span class="supporter-rank ${i===0?'s-rank-gold':i===1?'s-rank-silver':i===2?'s-rank-bronze':''}">${i+1}</span>
          <span class="supporter-avatar">${s.user[0]}</span>
          <span class="supporter-name">${s.user}</span>
          <span class="supporter-amount">${fmt(s.amount)} flames</span>
        </div>`).join('')}</div>` : '<p style="font-size:0.72rem;color:var(--text3);text-align:center;padding:12px">No supporters yet</p>'}
    </section>
    ${monthlySupporters.length ? `
    <section class="content-section">
      <h3 class="section-title">This Month</h3>
      <div class="supporters-list">${monthlySupporters.map((s,i) => `
        <div class="supporter-item">
          <span class="supporter-rank ${i===0?'s-rank-gold':i===1?'s-rank-silver':i===2?'s-rank-bronze':''}">${i+1}</span>
          <span class="supporter-avatar">${s.user[0]}</span>
          <span class="supporter-name">${s.user}</span>
          <span class="supporter-amount">${fmt(s.amount)} flames</span>
        </div>`).join('')}</div>
    </section>` : ''}
    <section class="content-section">
      <h3 class="section-title">Support Milestones</h3>
      <div class="achievement-list">${FLAME_MILESTONES.map(m => `<span class="achievement-badge" style="opacity:${totalFlames >= m ? '1' : '0.25'}">${fmt(m)} Flames</span>`).join('')}</div>
      ${totalFans > 0 ? `<p style="font-size:0.6rem;color:var(--text3);margin-top:8px">${totalFans} unique supporters</p>` : ''}
    </section>`;
}

function renderAuthorComments(comments) {
  return `
    <form id="profile-comment-form" style="margin-bottom:16px">
      <div style="display:flex;gap:8px">
        <input class="input-field" name="user" placeholder="Your name" style="width:120px;flex:none" required>
        <input class="input-field" name="content" placeholder="Leave a message..." style="flex:1" required>
        <button type="submit" class="btn btn-primary" style="font-size:0.68rem;padding:6px 14px;flex-shrink:0">Send</button>
      </div>
    </form>
    ${comments.length ? comments.map(c => `
      <div class="profile-comment">
        <div class="comment-avatar">${c.user[0]}</div>
        <div class="comment-body">
          <strong style="font-size:0.7rem">${c.user}</strong>
          <span style="font-size:0.55rem;color:var(--text3);margin-left:6px">${c.date}</span>
          <p style="font-size:0.68rem;color:var(--text2);margin-top:2px">${c.content}</p>
        </div>
        <button class="btn btn-sm comment-del-btn" data-comment="${c.id}" style="font-size:0.5rem;padding:2px 6px;color:var(--text3);flex-shrink:0">X</button>
      </div>
    `).join('') : '<p style="font-size:0.72rem;color:var(--text3);text-align:center;padding:20px">No messages yet. Leave the first comment.</p>'}`;
}

// ---- Themes ----
function renderThemes() {
  return `
    <div class="page">
      <a class="back-link" href="#/profile">Back to Profile</a>
      <h1 class="page-title">Theme</h1>
      <div class="theme-grid">
        <div class="theme-card${state.theme === 'dark' ? ' active' : ''}" data-theme-btn="dark">
          <div class="theme-preview theme-preview-dark">
            <div class="theme-preview-header"></div>
            <div class="theme-preview-body">
              <div class="theme-preview-line"></div>
              <div class="theme-preview-line short"></div>
              <div class="theme-preview-block"></div>
            </div>
          </div>
          <div class="theme-info">
            <span class="theme-name">Dark</span>
            <span class="theme-desc">Black background, white text</span>
          </div>
          ${state.theme === 'dark' ? '<span class="theme-check">Selected</span>' : ''}
        </div>
        <div class="theme-card${state.theme === 'galaxy' ? ' active' : ''}" data-theme-btn="galaxy">
          <div class="theme-preview theme-preview-galaxy">
            <div class="theme-preview-header"></div>
            <div class="theme-preview-body">
              <div class="theme-preview-line"></div>
              <div class="theme-preview-line short"></div>
              <div class="theme-preview-block"></div>
            </div>
          </div>
          <div class="theme-info">
            <span class="theme-name">Galaxy</span>
            <span class="theme-desc">Subtle star field, deep space</span>
          </div>
          ${state.theme === 'galaxy' ? '<span class="theme-check">Selected</span>' : ''}
        </div>
        <div class="theme-card${state.theme === 'white' ? ' active' : ''}" data-theme-btn="white">
          <div class="theme-preview theme-preview-light">
            <div class="theme-preview-header"></div>
            <div class="theme-preview-body">
              <div class="theme-preview-line"></div>
              <div class="theme-preview-line short"></div>
              <div class="theme-preview-block"></div>
            </div>
          </div>
          <div class="theme-info">
            <span class="theme-name">White</span>
            <span class="theme-desc">Clean white background, dark text</span>
          </div>
          ${state.theme === 'white' ? '<span class="theme-check">Selected</span>' : ''}
        </div>
      </div>
    </div>`;
}

// ---- Inbox ----
function renderInbox() {
  if (!state.loggedIn) return renderSignIn();
  const u = state.user;
  const notifs = state.notifications || [];
  const messages = (state.messages || []).filter(m => m.to === u.username).sort((a,b) => new Date(b.date) - new Date(a.date));
  const unreadMsgs = messages.filter(m => !m.read).length;
  const achInfo = computeAchievements();
  const notifTabs = ['Notifications','Messages','Achievements'];

  return `
    <div class="page inbox-page">
      <a class="back-link" href="#/profile"><img src="Icons/open-book.png" width="12" style="vertical-align:middle;margin-right:4px">Back to Profile</a>
      <h1 class="page-title" style="display:flex;align-items:center;gap:8px"><img src="Icons/inbox.png" width="20">Inbox</h1>

      <div class="inbox-tabs">
        ${notifTabs.map(t => `<span class="tab${inboxTab===t?' active':''}" data-inbox-tab="${t}">${t}${t==='Messages' && unreadMsgs ? ` (${unreadMsgs})` : ''}${t==='Notifications' && notifs.length ? '' : ''}</span>`).join('')}
      </div>

      <div class="inbox-content">
        ${inboxTab === 'Notifications' ? `
          <div class="inbox-actions-row">
            <button class="btn btn-sm" id="inbox-refresh" style="font-size:0.6rem;background:var(--bg-hover);color:var(--text2)">Refresh</button>
            <button class="btn btn-sm" id="inbox-mark-notifs-read" style="font-size:0.6rem;background:var(--bg-hover);color:var(--text2)">Mark all read</button>
          </div>
          ${notifs.length ? notifs.map(n => `
          <div class="inbox-item${n.read ? ' read' : ''}">
            <span class="inbox-item-dot${n.read ? '' : ' unread'}" title="Unread"></span>
            <div class="inbox-item-body">
              <span class="inbox-item-type">${n.type || 'info'}</span>
              <p class="inbox-item-text">${escHtml(n.message || n.text || '')}</p>
              <span class="inbox-item-date">${n.created_at ? new Date(n.created_at).toLocaleString() : (n.date || '')}</span>
            </div>
          </div>`).join('') : '<div class="inbox-empty">No notifications yet</div>'}
        ` : inboxTab === 'Messages' ? `
          <div class="inbox-actions-row">
            <button class="btn btn-sm" id="inbox-mark-msgs-read" style="font-size:0.6rem;background:var(--bg-hover);color:var(--text2)">Mark all read</button>
          </div>
          ${messages.length ? messages.map(m => `
          <div class="inbox-item${m.read ? ' read' : ''}">
            <span class="inbox-item-dot${m.read ? '' : ' unread'}" title="Unread"></span>
            <div class="inbox-item-body">
              <span class="inbox-item-author"><strong>${escHtml(m.from)}</strong> replied to your comment or review</span>
              ${m.target ? `<a class="inbox-item-link" href="${m.link || '#/inbox'}">${escHtml(m.target)}</a>` : ''}
              <p class="inbox-item-quote">${escHtml(m.quote || '')}</p>
              <p class="inbox-item-text">${escHtml(m.text || '')}</p>
              <span class="inbox-item-date">${new Date(m.date || Date.now()).toLocaleString()}</span>
            </div>
          </div>`).join('') : '<div class="inbox-empty">No messages yet. Comments you get replies on will appear here.</div>'}
        ` : `
          <div class="inbox-achievements">
            <div class="inbox-ach-stats">${achInfo.achievements.length} unlocked &middot; ${achInfo.locked.length} locked &middot; track your next goal below</div>
            ${ACHIEVEMENT_GROUPS.map(g => {
              const groupDefs = achInfo.all.filter(a => a.group === g);
              if (!groupDefs.length) return '';
              return `
              <div class="ach-group">
                <div class="ach-group-title">${g}</div>
                <div class="ach-group-grid">
                  ${groupDefs.map(a => a.achieved ? `
                  <div class="ach-glass-card ach-unlocked" title="${escHtml(a.label)} \u00b7 ${escHtml(a.desc)}">
                    <div class="ach-glass-icon"><img src="${a.icon}" alt="${escHtml(a.label)}"></div>
                    <div class="ach-glass-label">${escHtml(a.label)}</div>
                    <div class="ach-glass-desc">${escHtml(a.desc)}</div>
                    <div class="ach-glass-date"><img src="Icons/icons8-check-mark-50.png" width="10" style="vertical-align:middle;margin-right:4px">${a.date ? 'Achieved ' + new Date(a.date).toLocaleDateString() : 'Achieved Today'}</div>
                  </div>` : `
                  <div class="ach-glass-card ach-locked" title="${escHtml(a.label)} \u00b7 ${escHtml(a.desc)}">
                    <div class="ach-glass-icon"><img src="${a.icon}" alt="Locked">${a.mystery && !a.achieved ? '<span class="ach-question">?</span>' : ''}</div>
                    <div class="ach-glass-label">${escHtml(a.label)}</div>
                    <div class="ach-glass-desc">${escHtml(a.desc)}</div>
                    <div class="ach-glass-lock">Locked</div>
                  </div>`).join('')}
                </div>
              </div>`;
            }).join('')}
          </div>
        `}
      </div>
    </div>`;
}

// ---- Sign In ----
function renderSignIn() {
  if (state.loggedIn) return renderProfile();
  return `
    <div class="page auth-page">
      <div class="auth-card">
        <h1 class="auth-title">Sign In</h1>
        <p class="auth-subtitle">Welcome back to Flow World</p>
        <form id="signin-form" class="auth-form">
          <div class="form-group">
            <label>Email</label>
            <input class="input-field" name="email" type="email" placeholder="your@email.com" required>
          </div>
          <div class="form-group">
            <label>Password</label>
            <input class="input-field" name="password" type="password" placeholder="Enter password" required>
          </div>
          <p id="signin-error" class="auth-error"></p>
          <button type="submit" class="btn btn-primary auth-submit">Sign In</button>
        </form>
        <div class="auth-divider"><span>or continue with</span></div>
        <div class="auth-social">
          <button class="btn btn-sm auth-social-btn google-btn" onclick="navigate('#/auth/google')"><img src="Icons/google.png" class="social-icon"> Google</button>
          <button class="btn btn-sm auth-social-btn facebook-btn" onclick="navigate('#/auth/facebook')"><img src="Icons/facebook.png" class="social-icon"> Facebook</button>
          <button class="btn btn-sm auth-social-btn x-btn" onclick="navigate('#/auth/twitter')"><img src="Icons/twitter1.png" class="social-icon"> X</button>
        </div>
        <p class="auth-footer">No account? <a href="#/signup">Sign up</a></p>
      </div>
    </div>`;
}

// ---- Sign Up ----
function renderSignUp() {
  if (state.loggedIn) return renderProfile();
  return `
    <div class="page auth-page">
      <div class="auth-card">
        <h1 class="auth-title">Create Account</h1>
        <p class="auth-subtitle">Join Flow World today</p>
        <form id="signup-form" class="auth-form">
          <div class="form-group">
            <label>Username</label>
            <input class="input-field" name="username" placeholder="Choose a username" required>
          </div>
          <div class="form-group">
            <label>Email</label>
            <input class="input-field" name="email" type="email" placeholder="your@email.com" required>
          </div>
          <div class="form-group">
            <label>Password</label>
            <input class="input-field" name="password" type="password" placeholder="Create a password" required>
          </div>
          <div class="form-group">
            <label>Confirm Password</label>
            <input class="input-field" name="confirm" type="password" placeholder="Confirm password" required>
          </div>
          <p id="signup-error" class="auth-error"></p>
          <button type="submit" class="btn btn-primary auth-submit">Sign Up</button>
        </form>
        <div class="auth-divider"><span>or sign up with</span></div>
        <div class="auth-social">
          <button class="btn btn-sm auth-social-btn google-btn" onclick="navigate('#/auth/google')"><img src="Icons/google.png" class="social-icon"> Google</button>
          <button class="btn btn-sm auth-social-btn facebook-btn" onclick="navigate('#/auth/facebook')"><img src="Icons/facebook.png" class="social-icon"> Facebook</button>
          <button class="btn btn-sm auth-social-btn x-btn" onclick="navigate('#/auth/twitter')"><img src="Icons/twitter1.png" class="social-icon"> X</button>
        </div>
        <p class="auth-footer">Already have an account? <a href="#/signin">Sign in</a></p>
      </div>
    </div>`;
}

// ---- Book Page ----
let bookTab = 'Overview';

// ---- Review rating categories ----
const REVIEW_CATEGORIES = [
  { key: 'story', label: 'Story', desc: 'Plot, premise, and overall storytelling' },
  { key: 'characters', label: 'Characters', desc: 'Character development, personality, and relationships' },
  { key: 'writing', label: 'Writing', desc: 'Prose, grammar, descriptions, and readability' },
  { key: 'pacing', label: 'Pacing', desc: 'How well the story progresses and how engaging the chapters are' },
  { key: 'enjoyment', label: 'Enjoyment', desc: "The reader's overall enjoyment of the book" },
];

function parseRatings(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') { try { return JSON.parse(raw); } catch (e) {} }
  return {};
}

function clampStar(v) {
  const n = parseInt(v, 10);
  return (n >= 1 && n <= 5) ? n : 5;
}

function ratingOverall(ratings) {
  const vals = REVIEW_CATEGORIES.map(c => +ratings[c.key]).filter(v => v >= 1 && v <= 5);
  if (!vals.length) return 5;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.round(avg * 10) / 10;
}

function starsIcon(n) {
  const val = Math.max(0, Math.min(5, Math.round(n || 0)));
  let out = '';
  for (let i = 1; i <= 5; i++) out += `<span class="star-ic${i <= val ? ' on' : ''}">${i <= val ? '&#9733;' : '&#9734;'}</span>`;
  return `<span class="review-rate-stars">${out}</span>`;
}

function avgRating(reviews) {
  const rs = (reviews || []).map(r => +r.rating).filter(v => v >= 1 && v <= 5);
  return rs.length ? (rs.reduce((a, b) => a + b, 0) / rs.length).toFixed(1) : null;
}

function reviewRatingFormHtml() {
  return `
    <div class="review-rating-grid">
      ${REVIEW_CATEGORIES.map(c => `
      <div class="rev-rate-row" data-cat="${c.key}">
        <span class="rev-rate-lbl">${c.label}<small>${c.desc}</small></span>
        <span class="rev-stars">
          ${[1, 2, 3, 4, 5].map(v => `<button type="button" class="star${v === 5 ? ' on' : ''}" data-cat="${c.key}" data-val="${v}" title="${v} star${v > 1 ? 's' : ''}">&#9733;</button>`).join('')}
        </span>
      </div>`).join('')}
    </div>
    <div class="rev-overall-row">Overall Rating: <span class="rev-overall-val">5.0</span> / 5</div>
  `;
}

function recomputeReviewOverall(form) {
  const vals = [];
  form.querySelectorAll('.rev-rate-row').forEach(row => {
    const on = row.querySelector('.star.on');
    if (on) vals.push(+on.dataset.val);
  });
  const ov = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  const el = form.querySelector('.rev-overall-val');
  if (el) el.textContent = ov.toFixed(1);
}

function reviewRatingsBlockHtml(r) {
  const rt = parseRatings(r.ratings);
  const hasCats = REVIEW_CATEGORIES.some(c => +rt[c.key] >= 1 && +rt[c.key] <= 5);
  const overall = hasCats ? ratingOverall(rt) : (+r.rating >= 1 && +r.rating <= 5 ? +r.rating : 5);
  return `
    <div class="review-rating-block">
      ${hasCats ? REVIEW_CATEGORIES.map(c => `
        <div class="review-rate-row">
          <span class="rrl">${c.label}</span>
          ${starsIcon(+rt[c.key])}
          <span class="rrv">${+rt[c.key]}/5</span>
        </div>`).join('') : ''}
      <div class="review-overall-line">
        <span class="rol-lbl">Overall</span>
        <span class="rol-val">${overall.toFixed(1)}</span>
        ${starsIcon(overall)}
      </div>
    </div>`;
}

function reviewItemHtml(r, id, isAuthor) {
  const replies = (r.replies || []).map(rp => `
    <div class="review-reply">
      <strong class="review-reply-author">${escHtml(rp.username)}</strong>
      <span style="font-size:0.52rem;color:var(--text3);margin-left:6px">${rp.createdAt || ''}</span>
      <p class="review-reply-text">${escHtml(rp.content)}</p>
    </div>`).join('');
  return `
    <div class="review-item${r.pinned ? ' pinned' : ''}">
      ${r.pinned ? '<div class="review-pinned-badge">Pinned Review</div>' : ''}
      <div class="review-header">
        <span class="review-avatar">${escHtml(String(r.username || '?')[0])}</span>
        <span class="review-author">${escHtml(r.username)}</span>
        <span class="review-date">${r.editedAt ? r.editedAt + ' (edited)' : r.createdAt}</span>
      </div>
      ${reviewRatingsBlockHtml(r)}
      <p class="review-text">${escHtml(r.content)}</p>
      ${r.favorited ? '<div class="review-fav-badge">Author\'s Favorite</div>' : ''}
      ${replies ? `<div class="review-replies">${replies}</div>` : ''}
      <div class="review-actions">
        ${isAuthor ? `
          <button class="btn btn-sm review-pin-btn" data-book="${id}" data-review="${r.id}" style="font-size:0.55rem;padding:3px 8px">${r.pinned ? 'Unpin' : 'Pin'}</button>
          <button class="btn btn-sm review-fav-btn" data-book="${id}" data-review="${r.id}" style="font-size:0.55rem;padding:3px 8px">${r.favorited ? 'Unfavorite' : 'Favorite'}</button>
          <button class="btn btn-sm review-del-btn" data-book="${id}" data-review="${r.id}" style="font-size:0.55rem;padding:3px 8px;color:var(--red)">Delete</button>
        ` : state.loggedIn && r.username === state.user.username ? `
          <button class="btn btn-sm review-del-btn" data-book="${id}" data-review="${r.id}" style="font-size:0.55rem;padding:3px 8px;color:var(--red)">Delete</button>
        ` : ''}
        ${state.loggedIn ? `<button class="btn btn-sm review-reply-btn" data-book="${id}" data-review="${r.id}" style="font-size:0.55rem;padding:3px 8px;color:var(--accent)">Reply</button>` : ''}
        ${state.loggedIn ? `<button class="btn btn-sm review-like-btn${(r.likes || []).includes(state.user.username) ? ' on' : ''}" data-book="${id}" data-review="${r.id}" style="font-size:0.55rem;padding:3px 8px">${(r.likes || []).length ? 'Like ' + r.likes.length : 'Like'}</button>` : ''}
      </div>
      ${state.loggedIn ? `
      <form class="review-reply-form" data-book="${id}" data-review="${r.id}" style="display:none;margin-top:8px">
        <div style="display:flex;gap:6px">
          <input class="input-field" name="content" placeholder="Reply to review..." style="flex:1;font-size:0.65rem">
          <button type="submit" class="btn btn-sm" style="font-size:0.55rem;padding:3px 10px">Post</button>
        </div>
      </form>` : ''}
    </div>`;
}

function chCommentHtml(c, bookId, chapterId, bookAuthor) {
  if (!c || c.para !== undefined) return '';
  const replies = (c.replies || []).map(rp => `
    <div class="review-reply">
      <strong class="review-reply-author">${escHtml(rp.username)}</strong>
      <span style="font-size:0.52rem;color:var(--text3);margin-left:6px">${rp.createdAt || ''}</span>
      <p class="review-reply-text">${escHtml(rp.content)}</p>
    </div>`).join('');
  const canMod = state.loggedIn && (c.username === state.user.username || bookAuthor === state.user.username);
  const liked = state.loggedIn && (c.likes || []).includes(state.user.username);
  return `
    <div class="ch-comment-item">
      <span class="ch-comment-avatar">${escHtml(String(c.username || '?')[0])}</span>
      <div class="ch-comment-body">
        <span class="ch-comment-author">${escHtml(c.username)}</span>
        <span class="ch-comment-date">${c.createdAt}</span>
        <p class="ch-comment-text">${escHtml(c.content)}</p>
        ${replies ? `<div class="review-replies">${replies}</div>` : ''}
        <div class="ch-comment-actions">
          ${state.loggedIn ? `
          <button class="btn btn-sm ch-comment-like${liked ? ' on' : ''}" data-book="${bookId}" data-chapter="${chapterId}" data-comment="${c.id}" style="font-size:0.5rem;padding:2px 8px">${(c.likes || []).length ? 'Like ' + c.likes.length : 'Like'}</button>
          <button class="btn btn-sm ch-comment-reply-btn" data-book="${bookId}" data-chapter="${chapterId}" data-comment="${c.id}" style="font-size:0.5rem;padding:2px 8px;color:var(--accent)">Reply</button>` : ''}
          ${canMod ? `<button class="btn btn-sm ch-comment-del" data-book="${bookId}" data-chapter="${chapterId}" data-comment="${c.id}" style="font-size:0.5rem;padding:2px 6px;color:var(--red);flex-shrink:0">Delete</button>` : ''}
        </div>
        ${state.loggedIn ? `
        <form class="ch-comment-reply-form" data-book="${bookId}" data-chapter="${chapterId}" data-comment="${c.id}" style="display:none;gap:6px;margin-top:6px">
          <input class="input-field" name="content" placeholder="Reply..." style="flex:1;font-size:0.6rem">
          <button type="submit" class="btn btn-sm" style="font-size:0.5rem;padding:2px 8px">Reply</button>
        </form>` : ''}
      </div>
    </div>`;
}

function paraCommentRowHtml(c, bookId, chapterId, bookAuthor) {
  const canMod = state.loggedIn && (c.username === state.user.username || bookAuthor === state.user.username);
  const liked = state.loggedIn && (c.likes || []).includes(state.user.username);
  return `
    <div class="ch-comment-item">
      <span class="ch-comment-avatar">${escHtml(String(c.username || '?')[0])}</span>
      <div class="ch-comment-body">
        <span class="ch-comment-author">${escHtml(c.username)}</span>
        <span class="ch-comment-date">${c.createdAt}</span>
        <p class="ch-comment-text">${escHtml(c.content)}</p>
        ${state.loggedIn ? `<div class="ch-comment-actions">
          <button class="btn btn-sm para-like${liked ? ' on' : ''}" data-book="${bookId}" data-chapter="${chapterId}" data-comment="${c.id}" style="font-size:0.5rem;padding:2px 8px">${(c.likes || []).length ? 'Like ' + c.likes.length : 'Like'}</button>
        </div>` : ''}
      </div>
      ${canMod ? `<button class="btn btn-sm para-comment-del" data-book="${bookId}" data-chapter="${chapterId}" data-comment="${c.id}" style="font-size:0.5rem;padding:2px 6px;color:var(--red);flex-shrink:0">Delete</button>` : ''}
    </div>`;
}

function renderBookPage(id) {
  const book = getBook(id);
  if (!book) return '<div class="page"><h2>Book not found</h2></div>';
  const isAuthor = state.loggedIn && book.author === state.user.username;
  if (!isAuthor && !isPublicBook(book)) return '<div class="page"><h2>Book not found</h2></div>';

  const chapters = (state.chapters[id] || []).filter(c => c.published);
  const chars = state.characters[id] || [];
  const isFav = state.favorites.includes(id);
  const coverImg = book.cover || '';
  const reviews = getReviews(id);
  const pinnedReviews = reviews.filter(r => r.pinned);
  const normalReviews = reviews.filter(r => !r.pinned);
  const sortedReviews = [...pinnedReviews, ...normalReviews];
  const tabs = ['Overview','Chapters','Characters','Reviews','Supporters'];
  const totalViews = book.views || 0;
  const supporters = state.supporterHistory.filter(s => s.book === book.title) || [];
  const topSupporters = [...supporters].sort((a,b) => b.amount - a.amount).slice(0, 10);
  const recentSupporters = [...supporters].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
  const uniqueSupporters = new Set(supporters.map(s => s.user)).size;

  return `
    <div class="page book-page">
      <div class="book-identity">
        <div class="${coverClass('book-identity-cover', coverImg)}" data-img-url="${coverImg}" data-img-context="book-detail-cover:${id}" style="${imageBg(coverImg, 'background:linear-gradient(135deg,' + coverColor(book.title) + ')')}">${coverImg ? '' : imageFallback(book.title)}</div>
        <div class="book-identity-body">
          <h1 class="book-identity-title">${book.title}</h1>
          <div class="book-identity-meta">
            <span class="book-identity-genre">${book.genre || 'Uncategorized'}</span>
            <span class="book-identity-divider">|</span>
            <span class="book-identity-status" style="color:${book.status==='Draft'?'var(--text3)':book.status==='Completed'?'var(--accent)':'var(--text)'}">${book.status}</span>
          </div>
          <div class="book-identity-stats">
            <div class="bid-stat"><span class="bid-val">${fmt(totalViews)}</span><span class="bid-lbl">Views</span></div>
            <div class="bid-stat"><span class="bid-val">${fmt(book.chapterCount)}</span><span class="bid-lbl">Chapters</span></div>
            <div class="bid-stat"><span class="bid-val">${fmt(book.favorites)}</span><span class="bid-lbl">Followers</span></div>
            <div class="bid-stat"><span class="bid-val">${fmt(book.flames)}</span><span class="bid-lbl">Flames</span></div>
          </div>
          <div class="book-identity-actions">
            <a class="btn btn-primary" href="#/book/${id}/read/${chapters[0] ? chapters[0].id : ''}" style="text-decoration:none;${!chapters.length ? 'opacity:0.5;pointer-events:none;cursor:default' : ''}"><img src="Icons/open-book.png" width="13" style="vertical-align:middle;margin-right:4px">${chapters.length ? 'Start Reading' : 'No Chapters Yet'}</a>
            <button class="btn btn-sm book-fav" data-book="${id}" style="background:${isFav?'rgba(255,255,255,0.15)':'var(--bg-hover)'}">${isFav?'Favorited':'Favorite'}</button>
            <button class="btn btn-flame book-flame" data-book="${id}" style="padding:8px 14px"><img src="Icons/fire.png" width="14" style="vertical-align:middle;margin-right:4px">${(() => {
              if (!state.loggedIn) return 'Give Flame';
              if (isAuthor) return 'Flame';
              const td = new Date().toDateString();
              const lv = state.user.level || 1;
              const maxF = dailyFlameAllowance(lv);
              const rem = serverOnline ? (state.flamesRemaining ?? maxF) : Math.max(0, maxF - (state.flameDate === td ? state.flamesGiven : 0));
              return rem > 0 ? 'Give ' + rem + ' Flame' + (rem > 1 ? 's' : '') : 'Given';
            })()}</button>
            ${state.loggedIn && !isAuthor ? `<span class="flame-rule-tip" title="Flame rule: you only have 2 flames per day, every 00:00 new day, it resets">${flameStatusLine()}</span>` : ''}
          </div>
        </div>
      </div>

      <div class="book-tabs">${tabs.map(t => `<span class="tab${bookTab===t?' active':''}" data-book-tab="${t}">${t}</span>`).join('')}</div>
      <div class="book-tab-content">
        ${bookTab==='Overview' ? `
          <section class="content-section">
            <h3 class="section-title">Synopsis</h3>
            ${book.synopsis ? `<p class="book-identity-synopsis">${book.synopsis}</p>` : '<p style="font-size:0.7rem;color:var(--text3);font-style:italic">No synopsis yet</p>'}
          </section>
          <section class="content-section">
            <h3 class="section-title">Information</h3>
            <div class="book-info-grid">
              ${[['Genre',book.genre||'None'],['Status',book.status],['Type',book.type],['Published',book.createdAt],['Last Update',book.updatedAt]].map(([l,v]) => `
                <div class="book-info-row"><span class="bir-lbl">${l}</span><span class="bir-val">${v}</span></div>`).join('')}
            </div>
          </section>
          <section class="content-section">
            <h3 class="section-title">Recent Activity</h3>
            <div class="recent-activity">
              <div class="act-item"><span class="act-icon">+</span><span>Latest Chapter: ${chapters.length ? 'Ch. ' + chapters[chapters.length-1].chapterNumber + ' - ' + (chapters[chapters.length-1].title||'Untitled') : 'None yet'}</span></div>
              <div class="act-item"><span class="act-icon">+</span><span>Recent Reviews: ${reviews.length ? reviews[reviews.length-1].username + ': ' + reviews[reviews.length-1].content.slice(0,50) + '...' : 'None yet'}</span></div>
              <div class="act-item"><span class="act-icon">+</span><span>Recent Flames: ${supporters.length ? supporters[supporters.length-1].user + ' (' + supporters[supporters.length-1].amount + ')' : 'None yet'}</span></div>
            </div>
          </section>
          <section class="content-section">
            <h3 class="section-title">Reviews (${reviews.length})</h3>
            ${avgRating(reviews) ? `<div class="review-avg-line"><span class="ral-ic">&#9733;</span> Community rating: <strong>${avgRating(reviews)}/5</strong> (${reviews.length} review${reviews.length === 1 ? '' : 's'})</div>` : ''}
            ${state.loggedIn ? `
            <form class="review-form" data-book="${id}">
              ${reviewRatingFormHtml()}
              <textarea class="input-field review-input" name="content" placeholder="Write a review..." rows="3" required></textarea>
              <button type="submit" class="btn btn-primary" style="font-size:0.68rem;padding:6px 14px;margin-top:6px">Post Review</button>
            </form>` : `<p style="font-size:0.72rem;color:var(--text3);margin-bottom:12px"><a href="#/signin" style="color:var(--accent)">Sign in</a> to leave a review</p>`}
            ${sortedReviews.length ? sortedReviews.map(r => reviewItemHtml(r, id, isAuthor)).join('') : '<p style="font-size:0.72rem;color:var(--text3);padding:16px 0;text-align:center">No reviews yet</p>'}
          </section>
        ` : bookTab==='Chapters' ? `
          <div class="chapter-grid">
            ${chapters.length ? chapters.map(ch => `
            <a class="chapter-card" href="#/book/${id}/read/${ch.id}">
              <div class="chapter-card-top">
                <span class="chapter-card-num">Ch. ${ch.chapterNumber}</span>
                <span class="chapter-card-status">Published</span>
              </div>
              <h4 class="chapter-card-title">${ch.title || 'Untitled'}</h4>
              <div class="chapter-card-stats">
                <span>Views: ${ch.views || 0}</span>
                <span>Comments: ${ch.commentCount || 0}</span>
              </div>
            </a>
            `).join('') : '<div class="empty-state" style="grid-column:1/-1"><h3>No chapters yet</h3><p>Published chapters will appear here</p></div>'}
          </div>
        ` : bookTab==='Characters' ? `
          <div class="char-grid">
            ${chars.length ? chars.map(c => `
            <a class="char-card" href="#/book/${id}/character/${c.id}">
              <div class="${imageClass('char-card-img', c.image || c.portrait)}" data-img-url="${c.image || c.portrait || ''}" data-img-context="character:${c.id}" style="${c.image || c.portrait ? imageBg(c.image || c.portrait, '') : 'background:var(--bg-hover)'}">${(c.image || c.portrait) ? '' : imageFallback(c.name)}</div>
              <div class="char-card-body">
                <h4 class="char-card-name">${c.name}</h4>
                <span class="char-card-role">${c.nickname ? escHtml(c.nickname) : escHtml(c.role || 'Character')}</span>
              </div>
            </a>
            `).join('') : '<div class="empty-state" style="grid-column:1/-1"><h3>No characters yet</h3><p>Characters will appear here</p></div>'}
          </div>
        ` : bookTab==='Reviews' ? `
          <section class="content-section">
            <h3 class="section-title">Reviews (${reviews.length})</h3>
            ${avgRating(reviews) ? `<div class="review-avg-line"><span class="ral-ic">&#9733;</span> Community rating: <strong>${avgRating(reviews)}/5</strong> (${reviews.length} review${reviews.length === 1 ? '' : 's'})</div>` : ''}
            ${state.loggedIn ? `
            <form class="review-form" data-book="${id}">
              ${reviewRatingFormHtml()}
              <textarea class="input-field review-input" name="content" placeholder="Write a review..." rows="3" required></textarea>
              <button type="submit" class="btn btn-primary" style="font-size:0.68rem;padding:6px 14px;margin-top:6px">Post Review</button>
            </form>` : `<p style="font-size:0.72rem;color:var(--text3);margin-bottom:12px"><a href="#/signin" style="color:var(--accent)">Sign in</a> to leave a review</p>`}
            ${sortedReviews.length ? sortedReviews.map(r => reviewItemHtml(r, id, isAuthor)).join('') : '<p style="font-size:0.72rem;color:var(--text3);padding:16px 0;text-align:center">No reviews yet</p>'}
          </section>
        ` : bookTab==='Supporters' ? `
          <section class="content-section">
            <h3 class="section-title">Top Flame Givers</h3>
            ${topSupporters.length ? topSupporters.map((s,i) => `
            <div class="supporter-item">
              <span class="supporter-rank ${i===0?'s-rank-gold':i===1?'s-rank-silver':i===2?'s-rank-bronze':''}">${i+1}</span>
              <span class="supporter-avatar">${s.user[0]}</span>
              <span class="supporter-name">${s.user}</span>
              <span class="supporter-amount">${fmt(s.amount)} flames</span>
            </div>`).join('') : '<p style="font-size:0.72rem;color:var(--text3);padding:12px;text-align:center">No supporters yet</p>'}
          </section>
          <section class="content-section">
            <h3 class="section-title">Recent Supporters</h3>
            ${recentSupporters.length ? recentSupporters.slice(0,10).map(s => `
            <div class="supporter-item">
              <span class="supporter-avatar">${s.user[0]}</span>
              <span class="supporter-name">${s.user}</span>
              <span class="supporter-amount" style="font-size:0.6rem">${fmt(s.amount)} flames</span>
              <span style="font-size:0.55rem;color:var(--text3);margin-left:auto">${new Date(s.date).toLocaleDateString()}</span>
            </div>`).join('') : '<p style="font-size:0.72rem;color:var(--text3);padding:12px;text-align:center">No supporters yet</p>'}
          </section>
          <section class="content-section">
            <h3 class="section-title">Flame Statistics</h3>
            <div class="book-info-grid">
              <div class="book-info-row"><span class="bir-lbl">Total Flames</span><span class="bir-val">${fmt(book.flames)}</span></div>
              <div class="book-info-row"><span class="bir-lbl">Unique Supporters</span><span class="bir-val">${uniqueSupporters}</span></div>
              <div class="book-info-row"><span class="bir-lbl">Total Donations</span><span class="bir-val">${supporters.length}</span></div>
              <div class="book-info-row"><span class="bir-lbl">Average per Donation</span><span class="bir-val">${supporters.length > 0 ? Math.round(book.flames / supporters.length) : 0}</span></div>
              <div class="book-info-row"><span class="bir-lbl">Highest Donation</span><span class="bir-val">${supporters.length ? fmt(Math.max(...supporters.map(s => s.amount))) : 0}</span></div>
            </div>
          </section>
        ` : ''}
      </div>
    </div>`;
}

// ---- Character Detail Page ----
function renderCharacterPage(bookId, charId) {
  const book = getBook(bookId);
  if (!book) return '<div class="page"><h2>Book not found</h2></div>';
  const isAuthor = state.loggedIn && book.author === state.user.username;
  if (!isAuthor && !isPublicBook(book)) return '<div class="page"><h2>Book not found</h2></div>';
  const c = (state.characters[bookId] || []).find(x => x.id === charId);
  if (!c) return '<div class="page"><h2>Character not found</h2></div>';
  const img = c.image || c.portrait || '';
  const facts = [['Nickname', c.nickname], ['Age', c.age], ['Height', c.height], ['Weight', c.weight], ['Role', c.role || 'Character']].filter(([, v]) => v && String(v).trim());
  return `
    <div class="page char-detail-page">
      <a class="back-link" href="#/book/${bookId}"><img src="Icons/open-book.png" width="12" style="vertical-align:middle;margin-right:4px">Back to ${escHtml(book.title)}</a>
      ${isAuthor ? `<div class="char-detail-manage"><a class="btn btn-sm" href="#/write/works/${bookId}/characters/${charId}" style="text-decoration:none"><img src="Icons/editpen.png" width="12" style="vertical-align:middle;margin-right:4px">Edit in Your Workspace</a></div>` : ''}

      <div class="char-detail-hero">
        <div class="${imageClass('char-detail-img', img)}" data-img-url="${img}" data-img-context="character-detail:${c.id}" style="${img ? imageBg(img, '') : 'background:var(--bg-hover)'}">${img ? '' : `<span class="char-detail-fallback">${imageFallback(c.name)}</span>`}</div>
        <div class="char-detail-head">
          <h1 class="char-detail-name">${escHtml(c.name)}</h1>
          ${c.nickname ? `<div class="char-detail-nick">"${escHtml(c.nickname)}"</div>` : ''}
          ${c.role ? `<span class="char-detail-role">${escHtml(c.role)}</span>` : ''}
        </div>
      </div>

      ${facts.length ? `
      <div class="char-detail-facts">
        ${facts.map(([l, v]) => `
        <div class="char-fact-card">
          <span class="char-fact-lbl">${l}</span>
          <span class="char-fact-val">${escHtml(v)}</span>
        </div>`).join('')}
      </div>` : ''}

      <section class="content-section char-detail-desc">
        <h3 class="section-title">About ${escHtml(c.name)}</h3>
        ${c.description ? c.description.split(/\r?\n\s*\r?\n/).map(p => `<p class="char-detail-p">${renderRichContent(p)}</p>`).join('') : '<p style="font-size:0.7rem;color:var(--text3);font-style:italic">No description yet</p>'}
      </section>
    </div>`;
}

// ---- Chapter Reader ----
function renderChapterReader(bookId, chapterId) {
  const book = getBook(bookId);
  if (!book) return '<div class="page"><h2>Book not found</h2></div>';
  const isAuthor = state.loggedIn && book.author === state.user.username;
  if (!isAuthor && !isPublicBook(book)) return '<div class="page"><h2>Book not found</h2></div>';
  const chapters = state.chapters[bookId] || [];
  const ch = chapters.find(c => c.id === chapterId);
  if (!ch) return '<div class="page"><h2>Chapter not found</h2></div>';
  if (!isAuthor && !ch.published) return '<div class="page"><h2>Chapter not found</h2></div>';

  // Record chapter view (once per book+chapter+day)
  recordView(bookId, chapterId);

  // Save reading progress
  if (state.loggedIn) {
    const totalChs = chapters.filter(c => c.published).length || 1;
    const chIdx = chapters.indexOf(ch);
    const completion = Math.round(((chIdx + 1) / totalChs) * 100);
    if (!state.readingProgress) state.readingProgress = [];
    let prog = state.readingProgress.find(p => p.book_id === bookId);
    if (prog) {
      prog.chapter_id = chapterId;
      prog.completion_pct = completion;
      prog.last_read_at = new Date().toISOString();
    } else {
      state.readingProgress.push({ book_id: bookId, chapter_id: chapterId, completion_pct: completion, last_read_at: new Date().toISOString() });
    }
    saveState();
    syncUpdateProgress(bookId, { chapter_id: chapterId, completion_pct: completion });
    // Award EXP for reading (once per chapter session)
    if (!state._readExpCache) state._readExpCache = {};
    if (!state._readExpCache[chapterId]) {
      state._readExpCache[chapterId] = true;
      gainExp(5, 'read');
    }
  }

  const idx = chapters.indexOf(ch);
  const prevCh = idx > 0 ? chapters[idx - 1] : null;
  const nextCh = idx < chapters.length - 1 ? chapters[idx + 1] : null;
  const publishedChs = chapters.filter(c => c.published);

  // Flame data
  const td = new Date().toDateString();
  const lv = state.user.level || 1;
  const maxF = dailyFlameAllowance(lv);
  const rem = serverOnline ? (state.flamesRemaining ?? maxF) : (state.flameDate === td ? Math.max(0, maxF - state.flamesGiven) : maxF);

  // EXP data
  const userExp = state.user.exp || 0;
  const userLvl = state.user.level || 1;
  const expNeeded = expForLevel(userLvl);
  const expPct = Math.min(100, Math.round((userExp / expNeeded) * 100));
  const flameRules = `${maxF}/day`;

  // Comments
  const chComments = getChapterComments(bookId, chapterId).filter(c => c.para === undefined);

  // Reader content (continuous scroll or page-by-page)
  const blocks = chapterBlocks(ch.content);
  const paged = state.readerScrollMode === 'paged';
  if (paged && state._readerFor !== chapterId) {
    state.readerPageIndex = 0;
    state._readerFor = chapterId;
  }
  let contentHtml;
  if (!paged) {
    contentHtml = blocks.map((b, i) => paragraphHtml(bookId, chapterId, b, i)).join('');
  } else {
    const pages = paginateBlocks(blocks, READER_PAGE_CHARS);
    const pi = Math.min(state.readerPageIndex || 0, pages.length - 1);
    state.readerPageIndex = pi;
    let acc = 0;
    pages.slice(0, pi).forEach(p => { acc += p.length; });
    const body = pages[pi].map((b, k) => paragraphHtml(bookId, chapterId, b, acc + k)).join('');
    contentHtml = `<div class="reader-pages" id="reader-pages" data-total="${pages.length}" data-book="${bookId}" data-chapter="${chapterId}">
      <div class="rp-track" id="rp-track">
        <div class="rp-page">${readerPageNavHtml(pi, pages.length)}${body}</div>
      </div>
    </div>`;
  }
  const readerFont = Math.max(0.8, Math.min(1.6, +(state.readerFontSize || 1)));

  return `
    <div class="page reader-page">
      <div class="reader-header">
        <a class="back-link" href="#/book/${bookId}" style="padding:0"><img src="Icons/open-book.png" width="14" style="vertical-align:middle;margin-right:4px">Back to Book</a>
        <span class="reader-chapter-info">Ch. ${ch.chapterNumber} &middot; ${ch.title}</span>
        <span class="reader-header-actions">
          <a class="btn btn-sm rd-comments-link" href="#/book/${bookId}/comments/${chapterId}" style="font-size:0.6rem;padding:3px 8px"><img src="Icons/icons8-comments-50.png" width="13" style="vertical-align:middle;margin-right:4px">Comments</a>
          <button class="btn btn-sm rd-menu-toggle" style="font-size:0.6rem;padding:3px 8px"><img src="Icons/settings.png" width="12" style="vertical-align:middle;margin-right:4px">Menu</button>
        </span>
      </div>
      <h1 class="reader-title">${ch.title}</h1>
      <div class="reader-content" id="reader-content" data-book="${bookId}" data-chapter="${chapterId}" style="font-size:${readerFont}rem">${contentHtml}</div>

      <!-- Paragraph Comment Modal -->
      <div class="para-modal" id="para-comment-modal" style="display:none">
        <div class="para-overlay"></div>
        <div class="para-panel">
          <div class="para-header">
            <span style="font-weight:600;font-size:0.85rem"><img src="Icons/icons8-comments-50.png" width="15" style="vertical-align:middle;margin-right:6px">Paragraph Comments</span>
            <button class="btn btn-sm ic-x para-close" title="Close"><img src="Icons/icons8-cancel-24.png" alt="Close"></button>
          </div>
          ${state.loggedIn ? `
          <form class="para-form" style="display:flex;gap:6px;padding:10px 14px;border-bottom:1px solid var(--line2)">
            <textarea class="input-field" name="content" rows="1" placeholder="Comment on this paragraph..." style="flex:1;font-size:0.7rem;resize:none"></textarea>
            <button type="submit" class="btn btn-primary" style="font-size:0.62rem;padding:4px 10px;align-self:center">Post</button>
          </form>` : ''}
          <div class="para-body" id="para-body" style="overflow-y:auto;max-height:50vh;padding:4px 0"></div>
        </div>
      </div>

      <!-- Highlighted Passage Modal -->
      <div class="hl-modal" id="hl-modal" style="display:none">
        <div class="hl-overlay"></div>
        <div class="hl-panel">
          <div class="hl-header">
            <span style="font-weight:600;font-size:0.85rem"><img src="Icons/icons8-comments-50.png" width="15" style="vertical-align:middle;margin-right:6px">Highlighted Passage</span>
            <button class="btn btn-sm ic-x hl-close" title="Close"><img src="Icons/icons8-cancel-24.png" alt="Close"></button>
          </div>
          <div class="hl-quote" id="hl-quote"></div>
          ${state.loggedIn ? `
          <form class="hl-form" style="display:flex;gap:6px;padding:10px 14px;border-bottom:1px solid var(--line2)">
            <textarea class="input-field" name="content" rows="1" placeholder="Comment on this passage..." style="flex:1;font-size:0.7rem;resize:none"></textarea>
            <button type="submit" class="btn btn-primary" style="font-size:0.62rem;padding:4px 10px;align-self:center">Comment</button>
          </form>` : `<p class="hl-login" style="padding:8px 14px;font-size:0.65rem;color:var(--text3);border-bottom:1px solid var(--line2)"><a href="#/signin" style="color:var(--accent)">Sign in</a> to comment on this passage</p>`}
          <div class="hl-body" id="hl-body" style="overflow-y:auto;max-height:50vh;padding:4px 0"></div>
        </div>
      </div>

      <!-- Image Zoom Overlay -->
      <div class="img-zoom-overlay" id="img-zoom-overlay" style="display:none">
        <div class="img-zoom-toolbar">
          <button class="img-zoom-btn" id="img-zoom-out">Zoom Out</button>
          <span class="img-zoom-scale" id="img-zoom-scale">100%</span>
          <button class="img-zoom-btn" id="img-zoom-in">Zoom In</button>
          <button class="img-zoom-btn" id="img-zoom-close">Close</button>
        </div>
        <img id="img-zoom-image" alt="Zoomed image">
      </div>

      <!-- End of Chapter -->
      <div class="end-section">

        <!-- Chapter Complete Card -->
        <div class="end-card">
          <div class="end-card-label">Chapter Complete</div>
          <p class="end-card-sub">Enjoyed this chapter? Support the author!</p>
        </div>

        <!-- Flame Section -->
        ${state.loggedIn && !isAuthor ? `<div class="end-card">
          <div class="end-card-label"><img src="Icons/flames.png" width="16" style="vertical-align:middle;margin-right:6px">Support Author</div>
          <div class="end-flame-info">Available Today: <strong>${rem}</strong> / ${maxF}</div>
          <button class="btn btn-primary rd-give-flame" data-book="${bookId}" ${rem <= 0 ? 'disabled' : ''} style="${rem <= 0 ? 'opacity:0.4;cursor:default' : ''}"><img src="Icons/fire.png" width="14" style="vertical-align:middle;margin-right:4px">Give Flame</button>
          <div class="flame-feedback" id="flame-feedback" style="display:none"><img src="Icons/fire-flame.png" width="14" style="vertical-align:middle;margin-right:4px">+1 Flame Sent</div>
          <div class="end-flame-rules">
            <span>Lv 1-4: 2/day</span>
            <span>Lv 5-10: 3/day</span>
            <span>Lv 11-20: 4/day</span>
            <span>Lv 21+: 5/day</span>
            <span class="flame-rule-tip" style="width:auto">${flameStatusLine()}</span>
          </div>
        </div>` : ''}

        <!-- EXP Bar -->
        ${state.loggedIn ? `<div class="end-card">
          <div class="end-exp-header">
            <span class="end-exp-level">Level ${userLvl}</span>
            <span class="end-exp-numbers">${userExp} / ${expNeeded} EXP</span>
          </div>
          <div class="end-exp-bar">
            <div class="end-exp-fill" style="width:${expPct}%"></div>
          </div>
        </div>` : ''}

        <!-- Comments Section -->
        <div class="end-card">
          <div class="end-card-label"><img src="Icons/icons8-comments-50.png" width="15" style="vertical-align:middle;margin-right:6px">Chapter Discussion</div>
          ${state.loggedIn ? `
          <form class="ch-comment-form" data-book="${bookId}" data-chapter="${chapterId}" style="margin-bottom:10px">
            <textarea class="input-field" name="content" placeholder="Comment on this chapter..." rows="2" style="margin-bottom:6px"></textarea>
            <button type="submit" class="btn btn-primary" style="font-size:0.65rem;padding:5px 12px">Post Comment</button>
          </form>` : `<p class="end-comment-login" style="font-size:0.65rem;color:var(--text3);margin-bottom:10px"><a href="#/signin" style="color:var(--accent)">Sign in</a> to comment</p>`}
          <div class="ch-comments">
            ${chComments.length ? chComments.map(c => chCommentHtml(c, bookId, chapterId, book.author)).join('') : '<p style="font-size:0.65rem;color:var(--text3);text-align:center;padding:8px 0">No comments yet</p>'}
          </div>
        </div>

        <!-- Navigation -->
        <div class="end-nav">
          ${prevCh ? `<a class="btn btn-sm" href="#/book/${bookId}/read/${prevCh.id}"><img src="Icons/open-book.png" width="12" style="vertical-align:middle;margin-right:4px">Previous</a>` : '<span></span>'}
          <button class="btn btn-sm rd-chapter-list" data-book="${bookId}"><img src="Icons/books-stack-of-three.png" width="12" style="vertical-align:middle;margin-right:4px">Chapters</button>
          ${nextCh ? `<a class="btn btn-primary" href="#/book/${bookId}/read/${nextCh.id}">Next <img src="Icons/open-book.png" width="12" style="vertical-align:middle;margin-left:4px"></a>` : `<a class="btn btn-sm" href="#/book/${bookId}"><img src="Icons/open-book.png" width="12" style="vertical-align:middle;margin-right:4px">Back to Book</a>`}
        </div>

      </div>
    </div>

    <!-- Reader Settings Sheet -->
    <div class="reader-sheet" id="reader-sheet">
      <div class="reader-sheet-overlay"></div>
      <div class="reader-sheet-panel">
        <div class="reader-sheet-title"><span><img src="Icons/settings.png" width="15" style="vertical-align:middle;margin-right:6px">Reader Settings</span> <button class="btn btn-sm ic-x rd-sheet-close" title="Close"><img src="Icons/icons8-cancel-24.png" alt="Close"></button></div>
        <div class="reader-sheet-row">
          <span class="reader-sheet-label">Font Size</span>
          <span class="reader-sheet-btns">
            <button class="btn btn-sm rd-font-minus" style="font-size:0.7rem;padding:4px 10px;background:var(--bg-hover)">A&#8722;</button>
            <span class="rd-font-val">${readerFont.toFixed(1)}</span>
            <button class="btn btn-sm rd-font-plus" style="font-size:0.85rem;padding:4px 10px;background:var(--bg-hover)">A+</button>
          </span>
        </div>
        <div class="reader-sheet-row">
          <span class="reader-sheet-label">Scroll Mode</span>
          <button class="btn btn-sm rd-scroll-toggle" style="font-size:0.65rem;padding:4px 10px;background:var(--bg-hover);color:var(--accent)">${paged ? 'Page by Page' : 'Continuous'}</button>
        </div>
        <div class="reader-sheet-actions">
          <button class="btn btn-sm rd-chapter-list" data-book="${bookId}" style="font-size:0.62rem;padding:4px 10px"><img src="Icons/books-stack-of-three.png" width="13" style="vertical-align:middle;margin-right:4px">Chapters</button>
          <a class="btn btn-sm" href="#/book/${bookId}/comments/${chapterId}" style="font-size:0.62rem;padding:4px 10px"><img src="Icons/icons8-comments-50.png" width="13" style="vertical-align:middle;margin-right:4px">Comments</a>
          <a class="btn btn-sm" href="#/book/${bookId}" style="font-size:0.62rem;padding:4px 10px"><img src="Icons/open-book.png" width="13" style="vertical-align:middle;margin-right:4px">Book Page</a>
        </div>
      </div>
    </div>

    <!-- Chapter List Modal -->
    <div class="ch-list-modal" id="ch-list-modal" style="display:none">
      <div class="ch-list-overlay"></div>
      <div class="ch-list-panel">
        <div class="ch-list-header" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line2)">
          <span style="font-weight:600;font-size:0.85rem"><img src="Icons/books-stack-of-three.png" width="15" style="vertical-align:middle;margin-right:6px">Chapters</span>
          <button class="btn btn-sm ic-x rd-ch-list-close" title="Close"><img src="Icons/icons8-cancel-24.png" alt="Close"></button>
        </div>
        <div class="ch-list-body" style="overflow-y:auto;max-height:60vh">
          ${publishedChs.map(ch => `
          <a class="ch-list-item${ch.id === chapterId ? ' active' : ''}" href="#/book/${bookId}/read/${ch.id}" style="display:flex;align-items:center;padding:10px 16px;text-decoration:none;color:inherit;font-size:0.72rem;border-bottom:1px solid var(--line2);transition:0.1s">
            <span style="min-width:40px;color:var(--text3);font-size:0.62rem;font-weight:600">Ch.${ch.chapterNumber}</span>
            <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${ch.title || 'Untitled'}</span>
            ${ch.id === chapterId ? '<span style="font-size:0.5rem;color:var(--accent);font-weight:600">Reading</span>' : ''}
          </a>
          `).join('')}
        </div>
      </div>
    </div>`;
}

function renderChapterComments(bookId, chapterId) {
  const book = getBook(bookId);
  if (!book) return '<div class="page"><h2>Book not found</h2></div>';
  const isAuthor = state.loggedIn && book.author === state.user.username;
  if (!isAuthor && !isPublicBook(book)) return '<div class="page"><h2>Book not found</h2></div>';
  const chapters = state.chapters[bookId] || [];
  const ch = chapters.find(c => c.id === chapterId);
  if (!ch) return '<div class="page"><h2>Chapter not found</h2></div>';
  if (!isAuthor && !ch.published) return '<div class="page"><h2>Chapter not found</h2></div>';
  const chComments = getChapterComments(bookId, chapterId).filter(c => c.para === undefined);
  const paraCount = getChapterComments(bookId, chapterId).filter(c => c.para !== undefined).length;
  return `
    <div class="page reader-page">
      <div class="reader-header">
        <a class="back-link" href="#/book/${bookId}/read/${chapterId}" style="padding:0"><img src="Icons/open-book.png" width="14" style="vertical-align:middle;margin-right:4px">Back to Reader</a>
        <span class="reader-chapter-info">Ch. ${ch.chapterNumber} &middot; ${ch.title}</span>
        <span class="reader-header-actions" style="font-size:0.55rem;color:var(--text3)">${paraCount} paragraph comment${paraCount === 1 ? '' : 's'}</span>
      </div>
      <h1 class="reader-title">Chapter Discussion</h1>
      <div class="end-card" style="text-align:left">
        <div class="end-card-label"><img src="Icons/icons8-comments-50.png" width="15" style="vertical-align:middle;margin-right:6px">Comments on this chapter</div>
        ${state.loggedIn ? `
        <form class="ch-comment-form" data-book="${bookId}" data-chapter="${chapterId}" style="margin-bottom:10px">
          <textarea class="input-field" name="content" placeholder="Comment on this chapter..." rows="2" style="margin-bottom:6px"></textarea>
          <button type="submit" class="btn btn-primary" style="font-size:0.65rem;padding:5px 12px">Post Comment</button>
        </form>` : `<p class="end-comment-login" style="font-size:0.65rem;color:var(--text3);margin-bottom:10px"><a href="#/signin" style="color:var(--accent)">Sign in</a> to comment</p>`}
        <div class="ch-comments">
          ${chComments.length ? chComments.map(c => chCommentHtml(c, bookId, chapterId, book.author)).join('') : '<p style="font-size:0.65rem;color:var(--text3);text-align:center;padding:8px 0">No comments yet</p>'}
        </div>
      </div>
    </div>`;
}

// ---- Workspace: highlighted passages management ----
function hlManageRowHtml(bookId, chapterId, rec, bookAuthor) {
  const rows = (rec.comments || []).map(c => {
    const canMod = state.loggedIn && (c.username === state.user.username || bookAuthor === state.user.username);
    return `
      <div class="ch-comment-item">
        <span class="ch-comment-avatar">${escHtml(String(c.username || '?')[0])}</span>
        <div class="ch-comment-body">
          <span class="ch-comment-author">${escHtml(c.username)}</span>
          <span class="ch-comment-date">${c.createdAt}</span>
          <p class="ch-comment-text">${escHtml(c.content)}</p>
          ${canMod ? `<button class="btn btn-sm hl-del" data-book="${bookId}" data-chapter="${chapterId}" data-hl="${rec.id}" data-para="${rec.para}" data-comment="${c.id}" style="font-size:0.5rem;padding:2px 6px;color:var(--red);flex-shrink:0">Delete</button>` : ''}
        </div>
      </div>`;
  }).join('');
  return `
    <div class="hl-manage-card">
      <div class="hl-manage-head">
        <span class="hl-manage-meta">Para ${rec.para + 1} &middot; ${(rec.comments || []).length} comment${(rec.comments || []).length === 1 ? '' : 's'}</span>
        <button class="btn btn-sm hl-del-rec" data-book="${bookId}" data-chapter="${chapterId}" data-hl="${rec.id}" style="font-size:0.55rem;padding:3px 8px;color:var(--red)">Delete Highlight</button>
      </div>
      <blockquote class="hl-manage-quote">&#8220;${escHtml(rec.text)}&#8221;</blockquote>
      <div class="hl-comments">${rows || '<p style="font-size:0.6rem;color:var(--text3);padding:4px 0">No comments yet</p>'}</div>
    </div>`;
}

function renderHighlightsPage(bookId) {
  const book = getBook(bookId);
  const isAuthor = state.loggedIn && book && book.author === state.user.username;
  if (!book || !isAuthor) return '<div class="page"><h2>Book not found</h2></div>';
  const groups = getAllBookHighlights(bookId);
  const totalHls = groups.reduce((s, g) => s + g.highlights.length, 0);
  return `
    <div class="page">
      <a class="back-link" href="#/write/works/${bookId}" style="padding:0"><img src="Icons/open-book.png" width="14" style="vertical-align:middle;margin-right:4px">Back to Workspace</a>
      <div class="book-settings-header" style="margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:12px">
          <div>
            <div class="book-settings-title">Highlights &amp; Passage Comments</div>
            <span class="book-settings-genre">${book.title} &middot; ${totalHls} highlight${totalHls === 1 ? '' : 's'}</span>
          </div>
        </div>
      </div>
      <p style="font-size:0.68rem;color:var(--text3);margin-bottom:14px">Readers highlight a passage in a chapter and attach a comment to it. You can view and delete them here.</p>
      ${groups.length ? groups.map(g => `
        <section class="content-section">
          <h3 class="section-title">Ch. ${g.chapter.chapterNumber} &middot; ${escHtml(g.chapter.title || 'Untitled')} <span style="font-size:0.55rem;color:var(--text3);font-weight:400">(${g.highlights.length})</span></h3>
          ${g.highlights.map(h => hlManageRowHtml(bookId, g.chapter.id, h, book.author)).join('')}
        </section>`).join('')
      : '<div class="empty-state"><h3>No highlights yet</h3><p>Readers can highlight a passage and comment on it while reading your chapters.</p></div>'}
    </div>`;
}

// ============================================================
// EVENT BINDING
// ============================================================
function bindPageEvents(route) {
  bindReaderSwipe();

  // ---- Create Book form ----
  const createForm = document.getElementById('create-book-form');
  if (createForm) {
    createForm.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(createForm);
      const data = Object.fromEntries(fd.entries());
      if (!data.title.trim()) return;
      const book = createBook(data);
      navigate('#/write/works/' + book.id);
    });
  }

  // ---- Create Chapter form ----
  const chForm = document.getElementById('create-chapter-form');
  if (chForm) {
    chForm.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(chForm);
      const bookId = chForm.dataset.book;
      const data = { title: fd.get('title'), content: fd.get('content'), published: false };
      if (!data.title.trim()) return;
      createChapter(bookId, data);
      navigate('#/write/works/' + bookId);
    });
    const pubBtn = chForm.closest('.editor-shell') ? chForm.closest('.editor-shell').querySelector('.ed-publish-new') : chForm.querySelector('.ws-save-publish');
    if (pubBtn) {
      pubBtn.addEventListener('click', () => {
        const fd = new FormData(chForm);
        const bookId = chForm.dataset.book;
        const data = { title: fd.get('title'), content: fd.get('content'), published: true };
        if (!data.title.trim()) return;
        createChapter(bookId, data);
        navigate('#/write/works/' + bookId);
      });
    }
  }

  // ---- Character forms (create / edit) ----
  const preview = document.getElementById('char-portrait-preview');
  const fileInput = document.getElementById('char-portrait-input');
  if (preview && fileInput) {
    const applyToPreview = (dataUrl) => {
      preview.dataset.image = dataUrl;
      preview.style.backgroundImage = 'url(' + dataUrl + ')';
      preview.textContent = '';
    };
    preview.addEventListener('click', () => fileInput.click());
    const uploadBtn = document.querySelector('.char-upload-btn');
    if (uploadBtn) uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (!f) return;
      fileInput.value = '';
      charCropOpen(f, applyToPreview);
    });
    document.querySelectorAll('.char-remove-img').forEach(el => {
      el.addEventListener('click', () => {
        delete preview.dataset.image;
        preview.style.backgroundImage = '';
        preview.textContent = '+';
      });
    });
  }
  bindCharCropper();

  const charForm = document.getElementById('create-character-form');
  if (charForm) {
    charForm.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(charForm);
      const bookId = charForm.dataset.book;
      const data = {
        name: fd.get('name'), nickname: fd.get('nickname'), age: fd.get('age'),
        height: fd.get('height'), weight: fd.get('weight'),
        role: fd.get('role'), description: fd.get('description'),
        image: preview ? preview.dataset.image || '' : ''
      };
      if (!data.name.trim()) return;
      createCharacter(bookId, data);
      navigate('#/write/works/' + bookId);
    });
  }

  const editCharForm = document.getElementById('edit-character-form');
  if (editCharForm) {
    editCharForm.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(editCharForm);
      const bookId = editCharForm.dataset.book, charId = editCharForm.dataset.char;
      const data = {
        name: fd.get('name'), nickname: fd.get('nickname'), age: fd.get('age'),
        height: fd.get('height'), weight: fd.get('weight'),
        role: fd.get('role'), description: fd.get('description'),
        image: preview ? preview.dataset.image || '' : ''
      };
      if (!data.name.trim()) return;
      updateCharacter(bookId, charId, data);
      navigate('#/write/works/' + bookId);
    });
  }

  // ---- Workspace tabs ----
  document.querySelectorAll('[data-ws-tab]').forEach(el => {
    el.addEventListener('click', () => { wsTab = el.dataset.wsTab; render(); });
  });

  // ---- Workspace delete chapter ----
  document.querySelectorAll('.ws-del-ch').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm('Delete this chapter?')) return;
      deleteChapter(el.dataset.book, el.dataset.ch);
      render();
    });
  });

  // ---- Workspace publish/unpublish chapter ----
  document.querySelectorAll('.ws-pub-ch').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const ch = (state.chapters[el.dataset.book] || []).find(c => c.id === el.dataset.ch);
      if (ch) {
        updateChapter(el.dataset.book, el.dataset.ch, { published: !ch.published });
        render();
      }
    });
  });

  // ---- Workspace edit chapter ----
  document.querySelectorAll('.ws-edit-ch').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      navigate('#/write/works/' + el.dataset.book + '/editor/' + el.dataset.ch);
    });
  });

  // ---- Workspace delete character ----
  document.querySelectorAll('.ws-del-char').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm('Delete this character?')) return;
      deleteCharacter(el.dataset.book, el.dataset.char);
      navigate('#/write/works/' + el.dataset.book);
    });
  });

  // ---- Workspace delete book ----
  document.querySelectorAll('.ws-del-book').forEach(el => {
    el.addEventListener('click', () => {
      if (!confirm('Delete this book permanently?')) return;
      deleteBook(el.dataset.book);
      navigate('#/write');
    });
  });

  // ---- Workspace publish/unpublish book ----
  document.querySelectorAll('.ws-pub-book').forEach(el => {
    el.addEventListener('click', () => {
      const book = getBook(el.dataset.book);
      if (book) {
        updateBook(el.dataset.book, { status: book.status === 'Draft' ? 'Ongoing' : 'Draft' });
        render();
      }
    });
  });

  // ---- Editor save ----
  document.querySelectorAll('.ed-save').forEach(el => {
    el.addEventListener('click', () => {
      const title = document.getElementById('editor-title')?.value || '';
      const content = document.getElementById('editor-content')?.value || '';
      updateChapter(el.dataset.book, el.dataset.ch, { title, content });
      const status = document.getElementById('editor-autosave-status');
      if (status) { status.textContent = 'Saved'; setTimeout(() => { status.textContent = ''; }, 2000); }
    });
  });

  // ---- Editor autosave ----
  const editorTitle = document.getElementById('editor-title');
  const editorContent = document.getElementById('editor-content');
  let autoSaveTimer = null;
  function doAutoSave() {
    const bookId = document.querySelector('.ed-save')?.dataset?.book;
    const chId = document.querySelector('.ed-save')?.dataset?.ch;
    if (!bookId || !chId) return;
    const title = editorTitle?.value || '';
    const content = editorContent?.value || '';
    updateChapter(bookId, chId, { title, content });
    const status = document.getElementById('editor-autosave-status');
    if (status) { status.textContent = 'Auto-saved'; setTimeout(() => { status.textContent = 'Draft saved'; }, 2000); }
  }
  if (editorTitle && editorContent) {
    [editorTitle, editorContent].forEach(el => {
      el.addEventListener('input', () => {
        const status = document.getElementById('editor-autosave-status');
        if (status) status.textContent = 'Unsaved changes';
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(doAutoSave, 30000);
      });
    });
  }

  // ---- Editor: Bold / Italic / Underline formatting + Insert Image ----
  document.querySelectorAll('.ed-fmt').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => {
      if (btn.dataset.imgInsert) { openImgInsertModal(btn); return; }
      const toolbar = btn.closest('.editor-toolbar');
      const ta = toolbar ? toolbar.nextElementSibling : null;
      const editorContentEl = (ta && ta.tagName === 'TEXTAREA') ? ta : document.getElementById('editor-content');
      if (!editorContentEl) return;
      const fmt = btn.dataset.fmt;
      const start = editorContentEl.selectionStart;
      const end = editorContentEl.selectionEnd;
      const val = editorContentEl.value || '';
      let selected = val.slice(start, end);
      // Toggle: if already wrapped, unwrap
      if (selected.startsWith(fmt) && selected.endsWith(fmt) && selected.length > fmt.length * 2) {
        editorContentEl.value = val.slice(0, start) + selected.slice(fmt.length, selected.length - fmt.length) + val.slice(end);
        editorContentEl.setSelectionRange(start, start + selected.length - fmt.length * 2);
      } else {
        const wrap = selected ? selected : 'text';
        editorContentEl.value = val.slice(0, start) + fmt + wrap + fmt + val.slice(end);
        editorContentEl.setSelectionRange(start + fmt.length, start + fmt.length + wrap.length);
      }
      editorContentEl.focus();
      editorContentEl.dispatchEvent(new Event('input'));
    });
  });
  bindImgInsertModal();

  // ---- Editor revisions ----
  document.querySelectorAll('.ed-revisions').forEach(el => {
    el.addEventListener('click', async () => {
      const chId = el.dataset.ch;
      const modal = document.getElementById('rev-modal');
      const body = document.getElementById('rev-list-body');
      const preview = document.getElementById('rev-preview-area');
      if (!modal || !body) return;
      modal.style.display = 'block';
      preview.style.display = 'none';
      body.innerHTML = '<p style="font-size:0.65rem;color:var(--text3);padding:16px;text-align:center">Loading...</p>';

      let revisions = [];
      if (serverOnline) {
        const res = await syncGetRevisions(chId);
        if (res) revisions = res;
      }
      if (!revisions.length) {
        body.innerHTML = '<p style="font-size:0.65rem;color:var(--text3);padding:16px;text-align:center">No revision history available</p>';
        return;
      }
      body.innerHTML = revisions.map(r => `
        <div class="rev-item" style="display:flex;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line2);cursor:pointer;transition:0.1s"
             data-rev-id="${r.id}" data-ch-id="${chId}">
          <div style="flex:1">
            <div style="font-size:0.75rem;font-weight:600">Version ${r.version}</div>
            <div style="font-size:0.6rem;color:var(--text3)">${new Date(r.created_at).toLocaleString()}</div>
          </div>
          <button class="btn btn-sm rev-preview-btn" data-rev-id="${r.id}" data-ch-id="${chId}" style="font-size:0.55rem;padding:3px 8px">Preview</button>
        </div>
      `).join('');
    });
  });

  // ---- Revision preview ----
  document.addEventListener('click', e => {
    const btn = e.target.closest('.rev-preview-btn');
    if (!btn) return;
    const revId = btn.dataset.revId;
    const chId = btn.dataset.chId;
    const previewArea = document.getElementById('rev-preview-area');
    const previewTitle = document.getElementById('rev-preview-title');
    const previewContent = document.getElementById('rev-preview-content');
    const restoreBtn = document.getElementById('rev-restore-btn');
    if (!previewArea) return;
    previewArea.style.display = 'block';

    if (serverOnline) {
      syncGetRevision(chId, revId).then(rev => {
        if (rev) {
          previewTitle.textContent = rev.title || 'Untitled';
          previewContent.textContent = (rev.content || '').slice(0, 500) + ((rev.content || '').length > 500 ? '...' : '');
          restoreBtn.dataset.revId = revId;
          restoreBtn.dataset.chId = chId;
        }
      });
    }
  });

  // ---- Revision restore ----
  document.addEventListener('click', e => {
    const btn = e.target.closest('.rd-rev-restore');
    if (!btn) return;
    const revId = btn.dataset.revId;
    const chId = btn.dataset.chId;
    if (!confirm('Restore this version? Current changes will be saved as a new revision.')) return;
    if (serverOnline) {
      syncRestoreRevision(chId, revId).then(chapter => {
        if (chapter) {
          document.getElementById('editor-title').value = chapter.title;
          document.getElementById('editor-content').value = chapter.content;
          const modal = document.getElementById('rev-modal');
          if (modal) modal.style.display = 'none';
          const status = document.getElementById('editor-autosave-status');
          if (status) status.textContent = 'Version restored';
          updateChapter(document.querySelector('.ed-save')?.dataset?.book, chId, { title: chapter.title, content: chapter.content });
        }
      });
    }
  });

  // ---- Revision modal close ----
  document.querySelectorAll('.rd-rev-close, .ch-list-overlay').forEach(el => {
    el.addEventListener('click', () => {
      const modal = document.getElementById('rev-modal');
      if (modal) modal.style.display = 'none';
    });
  });

  // ---- Editor publish ----
  document.querySelectorAll('.ed-publish').forEach(el => {
    el.addEventListener('click', () => {
      const title = document.getElementById('editor-title')?.value || '';
      const content = document.getElementById('editor-content')?.value || '';
      const ch = (state.chapters[el.dataset.book] || []).find(c => c.id === el.dataset.ch);
      if (ch) {
        updateChapter(el.dataset.book, el.dataset.ch, { title, content, published: !ch.published });
        render();
      }
    });
  });

  // ---- Explore genre/tab ----
  document.querySelectorAll('[data-exp-genre]').forEach(el => {
    el.addEventListener('click', () => { expGenre = expGenre === el.dataset.expGenre ? null : el.dataset.expGenre; render(); });
  });
  document.querySelectorAll('[data-rank-tab]').forEach(el => {
    el.addEventListener('click', () => { expRankTab = el.dataset.rankTab; render(); });
  });

  // ---- Book tabs ----
  document.querySelectorAll('[data-book-tab]').forEach(el => {
    el.addEventListener('click', () => { bookTab = el.dataset.bookTab; render(); });
  });

  // ---- Book cover click (upload for owner) ----
  document.querySelectorAll('[data-book-cover]').forEach(el => {
    el.addEventListener('click', () => {
      const bookId = el.dataset.bookCover;
      const book = getBook(bookId);
      if (!book || book.author !== state.user.username) return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', function() {
        const f = this.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = e => { updateBook(bookId, { cover: e.target.result }); render(); };
        r.readAsDataURL(f);
      });
      input.click();
    });
  });

  // ---- Settings cover upload ----
  const settingsCoverInput = document.getElementById('settings-cover-input');
  if (settingsCoverInput) {
    settingsCoverInput.addEventListener('change', function() {
      const f = this.files[0];
      if (!f) return;
      const route = getRoute();
      const parts = route.split('/');
      const id = parts[3] || parts[2];
      const r = new FileReader();
      r.onload = e => { updateBook(id, { cover: e.target.result }); render(); };
      r.readAsDataURL(f);
    });
  }

  // ---- Settings cover remove ----
  const settingsCoverRemove = document.getElementById('settings-cover-remove');
  if (settingsCoverRemove) {
    settingsCoverRemove.addEventListener('click', () => {
      const route = getRoute();
      const parts = route.split('/');
      const id = parts[3] || parts[2];
      updateBook(id, { cover: '' });
      render();
    });
  }

  // ---- Settings publish/unpublish ----
  const settingsPublishBtn = document.getElementById('settings-publish-btn');
  if (settingsPublishBtn) {
    settingsPublishBtn.addEventListener('click', () => {
      const book = getBook(settingsPublishBtn.dataset.book);
      if (!book) return;
      if (book.status !== 'Draft' && !confirm('Unpublish this book? It will be hidden from public.')) return;
      updateBook(settingsPublishBtn.dataset.book, { status: book.status === 'Draft' ? 'Ongoing' : 'Draft' });
      render();
    });
  }

  // ---- Settings delete ----
  const settingsDeleteBtn = document.getElementById('settings-delete-btn');
  if (settingsDeleteBtn) {
    settingsDeleteBtn.addEventListener('click', () => {
      if (!confirm('Delete this book permanently? This cannot be undone.')) return;
      deleteBook(settingsDeleteBtn.dataset.book);
      navigate('#/');
    });
  }

  // ---- Settings save details ----
  const settingsSaveBtn = document.getElementById('settings-details-save');
  if (settingsSaveBtn) {
    settingsSaveBtn.addEventListener('click', () => {
      const id = settingsSaveBtn.dataset.book;
      const title = document.getElementById('settings-details-title').value.trim();
      const synopsis = document.getElementById('settings-details-synopsis').value.trim();
      const genre = document.getElementById('settings-details-genre').value;
      const type = document.getElementById('settings-details-type').value;
      const status = document.getElementById('settings-details-status').value;
      const tagsRaw = document.getElementById('settings-details-tags').value;
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
      updateBook(id, { title, synopsis, genre, type, status, tags });
      render();
    });
  }

  // ---- Review form ----
  document.querySelectorAll('.review-form').forEach(form => {
    form.querySelectorAll('.star').forEach(st => {
      st.addEventListener('click', () => {
        const row = st.closest('.rev-rate-row');
        const val = +st.dataset.val;
        row.querySelectorAll('.star').forEach(s => s.classList.toggle('on', +s.dataset.val <= val));
        recomputeReviewOverall(form);
      });
    });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const bookId = form.dataset.book;
      const input = form.querySelector('.review-input');
      const content = input?.value?.trim();
      if (!content) return;
      const ratings = {};
      form.querySelectorAll('.rev-rate-row').forEach(row => {
        const on = row.querySelector('.star.on');
        if (on) ratings[row.dataset.cat] = +on.dataset.val;
      });
      REVIEW_CATEGORIES.forEach(c => { if (!ratings[c.key]) ratings[c.key] = 5; });
      createReview(bookId, { content, ratings });
      render();
    });
  });

  // ---- Review pin ----
  document.querySelectorAll('.review-pin-btn').forEach(el => {
    el.addEventListener('click', () => { togglePinReview(el.dataset.book, el.dataset.review); render(); });
  });

  // ---- Review favorite ----
  document.querySelectorAll('.review-fav-btn').forEach(el => {
    el.addEventListener('click', () => { toggleFavoriteReview(el.dataset.book, el.dataset.review); render(); });
  });

  // ---- Review delete ----
  document.querySelectorAll('.review-del-btn').forEach(el => {
    el.addEventListener('click', () => {
      if (!confirm('Delete this review?')) return;
      deleteReview(el.dataset.book, el.dataset.review);
      render();
    });
  });

  // ---- Review reply (toggle form + submit) ----
  document.querySelectorAll('.review-reply-btn').forEach(el => {
    el.addEventListener('click', () => {
      const book = el.dataset.book, review = el.dataset.review;
      const form = document.querySelector(`.review-reply-form[data-book="${book}"][data-review="${review}"]`);
      if (form) form.style.display = form.style.display === 'none' ? '' : 'none';
    });
  });
  document.querySelectorAll('.review-reply-form').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const book = form.dataset.book, review = form.dataset.review;
      const input = form.querySelector('input[name="content"]');
      const content = input?.value?.trim();
      if (!content) return;
      replyToReview(book, review, content);
      render();
    });
  });

  // ---- Book favorite ----
  document.querySelectorAll('.book-fav').forEach(el => {
    el.addEventListener('click', () => { toggleFavorite(el.dataset.book); render(); });
  });

  // ---- Book flames ----
  document.querySelectorAll('.book-flame').forEach(el => {
    el.addEventListener('click', () => {
      if (!state.loggedIn) { navigate('#/signin'); return; }
      if (giveFlames(el.dataset.book)) {
        saveState();
        render();
      }
    });
  });

  // ---- Theme selection ----
  document.querySelectorAll('[data-theme-btn]').forEach(el => {
    el.addEventListener('click', () => { state.theme = el.dataset.themeBtn; saveState(); render(); });
  });

  // ---- Inbox tabs ----
  document.querySelectorAll('[data-inbox-tab]').forEach(el => {
    el.addEventListener('click', () => { inboxTab = el.dataset.inboxTab; render(); });
  });

  // ---- Inbox: refresh notifications ----
  const inboxRefresh = document.getElementById('inbox-refresh');
  if (inboxRefresh) {
    inboxRefresh.addEventListener('click', async () => {
      if (!serverOnline) return;
      const notifs = await apiFetch('/api/user/notifications');
      if (notifs && Array.isArray(notifs)) {
        const local = (state.notifications || []).filter(n => n.local);
        state.notifications = local.concat(notifs);
        saveState();
        render();
      }
    });
  }

  // ---- Inbox: mark all notifications read ----
  const markNotifsBtn = document.getElementById('inbox-mark-notifs-read');
  if (markNotifsBtn) {
    markNotifsBtn.addEventListener('click', () => {
      (state.notifications || []).forEach(n => n.read = 1);
      saveState();
      if (serverOnline) apiSync('PUT', '/api/user/notifications/read-all');
      render();
    });
  }

  // ---- Inbox: mark all messages read ----
  const markMsgsBtn = document.getElementById('inbox-mark-msgs-read');
  if (markMsgsBtn) {
    markMsgsBtn.addEventListener('click', () => {
      (state.messages || []).forEach(m => { if (m.to === state.user.username) m.read = true; });
      saveState();
      render();
    });
  }

  // ---- Inbox: tap item opens link / reads ----
  document.querySelectorAll('.inbox-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('a')) return;
      if (e.target.closest('.inbox-read-btn')) return;
      const link = el.querySelector('a.inbox-item-link');
      if (link && link.getAttribute('href') && link.getAttribute('href') !== '#/inbox') {
        navigate(link.getAttribute('href'));
      }
    });
  });

  // ---- Author tabs ----
  document.querySelectorAll('[data-author-tab]').forEach(el => {
    el.addEventListener('click', () => { authorTab = el.dataset.authorTab; render(); });
  });

  // ---- Wall post form ----
  const wallForm = document.getElementById('wall-post-form');
  if (wallForm) {
    wallForm.addEventListener('submit', e => {
      e.preventDefault();
      const content = wallForm.querySelector('[name="content"]')?.value?.trim();
      if (!content) return;
      const post = { id: 'p' + Date.now(), content, date: new Date().toLocaleDateString(), likes: 0 };
      state.wallPosts.push(post);
      saveState();
      render();
    });
  }

  // ---- Wall post like ----
  document.querySelectorAll('.wall-like-btn').forEach(el => {
    el.addEventListener('click', () => {
      const post = state.wallPosts.find(p => p.id === el.dataset.post);
      if (post) { post.likes += 1; saveState(); render(); }
    });
  });

  // ---- Wall post delete ----
  document.querySelectorAll('.wall-del-btn').forEach(el => {
    el.addEventListener('click', () => {
      if (!confirm('Delete this post?')) return;
      state.wallPosts = state.wallPosts.filter(p => p.id !== el.dataset.post);
      saveState();
      render();
    });
  });

  // ---- Profile comment form ----
  const commentForm = document.getElementById('profile-comment-form');
  if (commentForm) {
    commentForm.addEventListener('submit', e => {
      e.preventDefault();
      const user = commentForm.querySelector('[name="user"]')?.value?.trim() || 'Anonymous';
      const content = commentForm.querySelector('[name="content"]')?.value?.trim();
      if (!content) return;
      const c = { id: 'c' + Date.now(), user, content, date: new Date().toLocaleDateString() };
      state.profileComments.push(c);
      saveState();
      render();
    });
  }

  // ---- Comment delete ----
  document.querySelectorAll('.comment-del-btn').forEach(el => {
    el.addEventListener('click', () => {
      if (!confirm('Delete this comment?')) return;
      state.profileComments = state.profileComments.filter(c => c.id !== el.dataset.comment);
      saveState();
      render();
    });
  });

  // ---- Follow author ----
  document.querySelectorAll('.author-follow-btn').forEach(el => {
    el.addEventListener('click', () => {
      const author = el.dataset.author;
      if (!state.following) state.following = [];
      if (state.following.includes(author)) return;
      state.following.push(author);
      if (state.user.username === author) state.user.followers = (state.user.followers || 0) + 1;
      saveState();
      render();
    });
  });

  // ---- Support author (uses your available flame budget) ----
  const currentRemaining = () => {
    if (serverOnline) return Math.max(0, state.flamesRemaining ?? dailyFlameAllowance(state.user.level || 1));
    const td = new Date().toDateString();
    if (state.flameDate !== td) return dailyFlameAllowance(state.user.level || 1);
    return Math.max(0, dailyFlameAllowance(state.user.level || 1) - state.flamesGiven);
  };
  document.querySelectorAll('.author-support-btn').forEach(el => {
    el.addEventListener('click', () => {
      const max = currentRemaining();
      if (max <= 0) { alert('You have no flames left today. They reset at 00:00.'); return; }
      const amount = prompt(`How many flames to send? (You have ${max} today):`, String(max));
      if (!amount) return;
      const num = parseInt(amount);
      if (isNaN(num) || num <= 0) return;
      const send = Math.min(num, max);
      const giver = state.user.username;
      if (serverOnline) state.flamesRemaining = Math.max(0, (state.flamesRemaining || 0) - send);
      else state.flamesGiven = (state.flamesGiven || 0) + send;
      state.supporterHistory.push({ user: giver, amount: send, date: new Date().toISOString() });
      saveState();
      render();
    });
  });

  // ---- Sign In form ----
  const signinForm = document.getElementById('signin-form');
  if (signinForm) {
    signinForm.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(signinForm);
      const email = fd.get('email').trim();
      const password = fd.get('password').trim();
      const err = document.getElementById('signin-error');

      // Try backend first
      const data = await apiFetch('/api/auth/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (data && data.loggedIn) {
        state.loggedIn = true;
        state.user = { ...state.user, ...data.user };
        saveState();
        navigate('#/');
        return;
      }

      // Fallback to localStorage auth
      const acct = accounts[email];
      if (!acct || acct.password !== password) {
        err.textContent = 'Invalid email or password';
        err.style.display = 'block';
        return;
      }
      loginAs(email);
      navigate('#/');
    });
  }

  // ---- Sign Up form ----
  const signupForm = document.getElementById('signup-form');
  if (signupForm) {
    signupForm.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(signupForm);
      const username = fd.get('username').trim();
      const email = fd.get('email').trim();
      const password = fd.get('password').trim();
      const confirm = fd.get('confirm').trim();
      const err = document.getElementById('signup-error');
      if (!username) { err.textContent = 'Username is required'; err.style.display = 'block'; return; }
      if (!email) { err.textContent = 'Email is required'; err.style.display = 'block'; return; }
      if (password.length < 4) { err.textContent = 'Password must be at least 4 characters'; err.style.display = 'block'; return; }
      if (password !== confirm) { err.textContent = 'Passwords do not match'; err.style.display = 'block'; return; }

      // Try backend first
      const data = await apiFetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
      });
      if (data && data.loggedIn) {
        state.loggedIn = true;
        state.user = { ...state.user, ...data.user };
        saveState();
        navigate('#/');
        return;
      }

      // Fallback to localStorage auth
      if (accounts[email]) { err.textContent = 'An account with this email already exists'; err.style.display = 'block'; return; }
      accounts[email] = { password, username, profile: { username, bio: 'Hello! I write stories.', level: 1, rank: 0, followers: 0 } };
      saveAccounts();
      loginAs(email);
      navigate('#/');
    });
  }

  // ---- Sign Out ----
  const signOutBtn = document.getElementById('sign-out-btn');
  if (signOutBtn) {
    signOutBtn.addEventListener('click', async () => {
      await apiFetch('/api/auth/signout', { method: 'POST' });
      logoutUser();
      navigate('#/');
    });
  }

  // ---- Profile: FAQ Toggle ----
  const faqToggle = document.getElementById('prof-faq-toggle');
  if (faqToggle) {
    faqToggle.addEventListener('click', () => {
      const content = document.getElementById('prof-faq-content');
      const arrow = document.getElementById('prof-faq-arrow');
      if (content) { content.style.display = content.style.display === 'none' ? 'block' : 'none'; }
      if (arrow) { arrow.textContent = arrow.textContent === '+' ? '-' : '+'; }
    });
  }

  // ---- Profile: Services Toggle ----
  const servicesToggle = document.getElementById('prof-services-toggle');
  if (servicesToggle) {
    servicesToggle.addEventListener('click', () => {
      const content = document.getElementById('prof-services-content');
      const arrow = document.getElementById('prof-services-arrow');
      if (content) { content.style.display = content.style.display === 'none' ? 'block' : 'none'; }
      if (arrow) { arrow.textContent = arrow.textContent === '+' ? '-' : '+'; }
    });
  }

  // ---- Daily Claim ----
  const claimBtn = document.getElementById('claim-daily-btn');
  if (claimBtn) {
    claimBtn.addEventListener('click', () => {
      state.lastDailyClaim = new Date().toDateString();
      state.dailyStreak = (state.dailyStreak || 0) + 1;
      saveState();
      render();
    });
  }

  // ---- Inbox badge (header) ----
  const inboxBadge = document.getElementById('inbox-badge');
  if (inboxBadge) {
    inboxBadge.addEventListener('click', () => navigate('#/inbox'));
  }

  // ---- Profile: Banner Upload ----
  const bannerInput = document.getElementById('banner-input');
  if (bannerInput) {
    bannerInput.addEventListener('change', function() {
      const file = this.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        state.user.banner = e.target.result;
        saveState();
        syncUpdateProfile({ banner: state.user.banner });
        render();
      };
      reader.readAsDataURL(file);
    });
  }

  // ---- Profile: Avatar Upload ----
  const avatarInput = document.getElementById('avatar-input');
  if (avatarInput) {
    avatarInput.addEventListener('change', function() {
      const file = this.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        state.user.avatar = e.target.result;
        saveState();
        syncUpdateProfile({ avatar: state.user.avatar });
        render();
      };
      reader.readAsDataURL(file);
    });
  }

  // ---- Edit Profile: Avatar Upload ----
  const editAvatarInput = document.getElementById('edit-avatar-input');
  if (editAvatarInput) {
    editAvatarInput.addEventListener('change', function() {
      const file = this.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        state.user.avatar = e.target.result;
        saveState();
        syncUpdateProfile({ avatar: state.user.avatar });
        render();
      };
      reader.readAsDataURL(file);
    });
  }

  // ---- Edit Profile: Remove Avatar ----
  const removeAvatarBtn = document.getElementById('remove-avatar-btn');
  if (removeAvatarBtn) {
    removeAvatarBtn.addEventListener('click', () => {
      state.user.avatar = '';
      saveState();
      syncUpdateProfile({ avatar: '' });
      render();
    });
  }

  // ---- Edit Profile: Banner Upload ----
  const editBannerInput = document.getElementById('edit-banner-input');
  if (editBannerInput) {
    editBannerInput.addEventListener('change', function() {
      const file = this.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => {
        state.user.banner = e.target.result;
        saveState();
        syncUpdateProfile({ banner: state.user.banner });
        render();
      };
      reader.readAsDataURL(file);
    });
  }

  // ---- Edit Profile: Remove Banner ----
  const removeBannerBtn = document.getElementById('remove-banner-btn');
  if (removeBannerBtn) {
    removeBannerBtn.addEventListener('click', () => {
      state.user.banner = '';
      saveState();
      syncUpdateProfile({ banner: '' });
      render();
    });
  }

  // ---- Edit Profile: Save Form ----
  const editForm = document.getElementById('edit-profile-form');
  if (editForm) {
    editForm.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(editForm);
      state.user.username = fd.get('username').trim() || state.user.username;
      state.user.bio = fd.get('bio').trim() || '';
      state.user.website = fd.get('website').trim() || '';
      state.user.discord = fd.get('discord').trim() || '';
      state.user.twitter = fd.get('twitter').trim() || '';
      state.user.facebook = fd.get('facebook').trim() || '';
      saveState();
      syncUpdateProfile({ username: state.user.username, bio: state.user.bio, avatar: state.user.avatar || '', banner: state.user.banner || '' });
      navigate('#/profile');
    });
  }

  // ---- Reader: Give Flame ----
  document.querySelectorAll('.rd-give-flame').forEach(el => {
    el.addEventListener('click', function() {
      const bookId = this.dataset.book;
      if (giveSingleFlame(bookId)) {
        saveState();
        const fb = document.getElementById('flame-feedback');
        if (fb) {
          fb.style.display = 'block';
          fb.classList.add('flame-anim');
          setTimeout(() => { fb.classList.remove('flame-anim'); render(); }, 1200);
        } else { render(); }
      }
    });
  });

  // ---- Reader: Chapter Comment Form ----
  document.querySelectorAll('.ch-comment-form').forEach(form => {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const bookId = form.dataset.book;
      const chapterId = form.dataset.chapter;
      const input = form.querySelector('[name="content"]');
      const content = input?.value?.trim();
      if (!content) return;
      createChapterComment(bookId, chapterId, content);
      render();
    });
  });

  // ---- Reader: Delete Chapter Comment ----
  document.querySelectorAll('.ch-comment-del').forEach(el => {
    el.addEventListener('click', function() {
      if (!confirm('Delete this comment?')) return;
      deleteChapterComment(this.dataset.book, this.dataset.chapter, this.dataset.comment);
      render();
    });
  });

  // ---- Reader: Reply to Chapter Comment ----
  document.querySelectorAll('.ch-comment-reply-form').forEach(form => {
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      const input = this.querySelector('[name="content"]');
      const content = input?.value?.trim();
      if (!content) return;
      replyToChapterComment(this.dataset.book, this.dataset.chapter, this.dataset.comment, content);
      render();
    });
  });

  // ---- Reader: Show Chapter List ----
  document.querySelectorAll('.rd-chapter-list').forEach(el => {
    el.addEventListener('click', function() {
      const modal = document.getElementById('ch-list-modal');
      if (modal) modal.style.display = 'block';
    });
  });

  // ---- Reader: Close Chapter List ----
  document.querySelectorAll('.rd-ch-list-close').forEach(el => {
    el.addEventListener('click', function() {
      const modal = document.getElementById('ch-list-modal');
      if (modal) modal.style.display = 'none';
    });
  });
  document.querySelectorAll('.ch-list-overlay').forEach(el => {
    el.addEventListener('click', function() {
      const modal = document.getElementById('ch-list-modal');
      if (modal) modal.style.display = 'none';
    });
  });

  // ---- Reader: Image Zoom ----
  const zoomOverlay = document.getElementById('img-zoom-overlay');
  const zoomImage = document.getElementById('img-zoom-image');
  let zoomLevel = 1;
  const ZOOM_MIN = 0.5, ZOOM_MAX = 4, ZOOM_STEP = 0.25;

  function updateZoomDisplay() {
    const scale = document.getElementById('img-zoom-scale');
    if (scale) scale.textContent = Math.round(zoomLevel * 100) + '%';
    if (zoomImage) zoomImage.style.transform = 'scale(' + zoomLevel + ')';
  }
  function openZoom(src) {
    if (!zoomOverlay || !zoomImage) return;
    zoomLevel = 1;
    zoomImage.src = src;
    zoomOverlay.style.display = 'flex';
    updateZoomDisplay();
    document.body.style.overflow = 'hidden';
  }
  function closeZoom() {
    if (!zoomOverlay) return;
    zoomOverlay.style.display = 'none';
    document.body.style.overflow = '';
  }

  document.querySelectorAll('.reader-img').forEach(el => {
    el.addEventListener('click', () => openZoom(el.dataset.zoomSrc || el.src));
  });
  if (zoomOverlay) {
    zoomOverlay.addEventListener('click', e => {
      if (e.target === zoomOverlay) closeZoom();
    });
  }
  document.getElementById('img-zoom-close')?.addEventListener('click', closeZoom);
  document.getElementById('img-zoom-in')?.addEventListener('click', () => {
    zoomLevel = Math.min(ZOOM_MAX, zoomLevel + ZOOM_STEP); updateZoomDisplay();
  });
  document.getElementById('img-zoom-out')?.addEventListener('click', () => {
    zoomLevel = Math.max(ZOOM_MIN, zoomLevel - ZOOM_STEP); updateZoomDisplay();
  });

  // ---- Reader: Paragraph comment modal (handled via module-level delegation in the highlights section) ----
  // para-form, para-close/overlay, para-like, para-comment-del, .hl*, .sel-* handlers
  // are registered once on `document` so they keep working after individual paragraphs re-render.

  // ---- Reader: Comment likes + reply toggle (end-list + comments page) ----
  document.querySelectorAll('.ch-comment-like').forEach(el => {
    el.addEventListener('click', () => {
      toggleChapterCommentLike(el.dataset.book, el.dataset.chapter, el.dataset.comment);
      render();
    });
  });
  document.querySelectorAll('.ch-comment-reply-btn').forEach(el => {
    el.addEventListener('click', () => {
      const f = document.querySelector(`.ch-comment-reply-form[data-book="${el.dataset.book}"][data-chapter="${el.dataset.chapter}"][data-comment="${el.dataset.comment}"]`);
      if (f) f.style.display = (f.style.display === 'none' || f.style.display === '') ? 'flex' : 'none';
    });
  });

  // ---- Review likes ----
  document.querySelectorAll('.review-like-btn').forEach(el => {
    el.addEventListener('click', () => {
      toggleReviewLike(el.dataset.book, el.dataset.review);
      render();
    });
  });

  // ---- Reader: Settings sheet + font size + scroll mode + pagination ----
  const sheet = document.getElementById('reader-sheet');
  const readerEl = document.getElementById('reader-content');
  function sheetSet(open) {
    if (!sheet) return;
    sheet.classList.toggle('open', !!open);
  }
  document.querySelectorAll('.rd-menu-toggle').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); sheetSet(true); });
  });
  document.querySelectorAll('.rd-sheet-close, .reader-sheet-overlay').forEach(el => {
    el.addEventListener('click', () => sheetSet(false));
  });
  if (readerEl) {
    readerEl.addEventListener('click', e => {
      if (e.target.closest('a, img, button, input, textarea, form, .hl, .sel-popup, .sel-form')) return;
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) return;
      sheetSet(!(sheet && sheet.classList.contains('open')));
    });
    const onReaderSelect = () => {
      const sel = window.getSelection && window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { hideSelPop(); return; }
      const text = (sel.toString() || '').trim();
      if (!text || text.length > 300) return;
      const range = sel.getRangeAt(0);
      const startP = closestParaEl(range.startContainer);
      const endP = closestParaEl(range.endContainer);
      if (!startP || !endP || startP !== endP) { hideSelPop(); return; }
      const bookId = readerEl.dataset.book, chapterId = readerEl.dataset.chapter;
      if (!bookId || !chapterId) return;
      const para = +startP.dataset.para;
      const start = domOffsetInto(startP, range.startContainer, range.startOffset);
      const end = domOffsetInto(startP, range.endContainer, range.endOffset);
      const plain = startP.textContent || '';
      const s = Math.max(0, Math.min(start, plain.length));
      const e2 = Math.max(s, Math.min(end, plain.length));
      if (e2 <= s) { hideSelPop(); return; }
      _sel = { bookId, chapterId, para, start: s, end: e2, text: plain.slice(s, e2) };
      let rc = range.getBoundingClientRect();
      if (!rc || (!rc.width && !rc.height)) {
        const n = range.startContainer;
        rc = (n && typeof n.getBoundingClientRect === 'function') ? n.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
      }
      showSelPop(rc);
    };
    readerEl.addEventListener('mouseup', onReaderSelect);
    readerEl.addEventListener('keyup', onReaderSelect);
    readerEl.addEventListener('scroll', hideSelPop, { passive: true });
  }
  function setFontSize(delta) {
    const nv = Math.round((Math.max(0.8, Math.min(1.6, (state.readerFontSize || 1) + delta))) * 10) / 10;
    state.readerFontSize = nv;
    saveState();
    if (readerEl) readerEl.style.fontSize = nv + 'rem';
    const val = document.querySelector('.rd-font-val');
    if (val) val.textContent = nv.toFixed(1);
  }
  document.querySelectorAll('.rd-font-plus').forEach(el => el.addEventListener('click', () => setFontSize(0.1)));
  document.querySelectorAll('.rd-font-minus').forEach(el => el.addEventListener('click', () => setFontSize(-0.1)));
  document.querySelectorAll('.rd-scroll-toggle').forEach(el => {
    el.addEventListener('click', () => {
      state.readerScrollMode = state.readerScrollMode === 'paged' ? 'continuous' : 'paged';
      saveState();
      render();
    });
  });
  document.querySelectorAll('.rd-page-prev').forEach(el => {
    el.addEventListener('click', () => {
      state.readerPageIndex = Math.max(0, (state.readerPageIndex || 0) - 1);
      saveState();
      render();
    });
  });
  document.querySelectorAll('.rd-page-next').forEach(el => {
    el.addEventListener('click', () => {
      state.readerPageIndex = (state.readerPageIndex || 0) + 1;
      saveState();
      render();
    });
  });
}

// ============================================================
// INIT
// ============================================================
window.addEventListener('hashchange', render);
window.addEventListener('popstate', render);
(async function init() {
  await initAuth();
  render();
})();
