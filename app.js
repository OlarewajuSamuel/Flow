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
    wallPosts: [],
    profileComments: [],
    supporterHistory: [],
    notifications: [],
    flameDate: '',
    flamesGiven: 0,
    flameAllowance: 2,
    flamesRemaining: 2,
    reviews: {},
    chapterComments: {},
    chapterReactions: {},
    readingProgress: [],
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

// ── Server data sync ────────────────────────────
async function loadServerData() {
  if (!serverOnline) return;
  // Load public books plus the signed-in author's private workspace books.
  const publicBooks = await apiFetch('/api/books');
  const ownBooks = state.user.id ? await apiFetch(`/api/books?author_id=${state.user.id}`) : [];
  const mergedBooks = [...(publicBooks || []), ...(ownBooks || [])].reduce((map, book) => {
    map.set(book.id, normalizeServerBook(book));
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
      if (reviews && Array.isArray(reviews)) state.reviews[book.id] = reviews;
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
  const res = await apiFetch(path, opts);
  if (!res) { serverOnline = false; }
  return res;
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
    name: char.name, biography: char.description, portrait: char.image
  });
  if (res) {
    Object.assign(char, { ...res, image: res.portrait || char.image, description: res.biography || char.description });
    saveState();
  }
}

async function syncDeleteCharacter(charId) {
  await apiSync('DELETE', `/api/characters/${charId}`);
}

async function syncRecordView(bookId) {
  await apiSync('POST', `/api/books/${bookId}/view`);
}

async function syncGetFlamesRemaining() {
  const res = await apiSync('GET', '/api/user/flames/remaining');
  return res;
}

async function syncGiveFlame(bookId) {
  const res = await apiSync('POST', `/api/books/${bookId}/flame`);
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
  saveState();
  syncCreateChapter(bookId, chapter);
  return chapter;
}

function updateChapter(bookId, chapterId, data) {
  const chapters = state.chapters[bookId] || [];
  const ch = chapters.find(c => c.id === chapterId);
  if (!ch) return;
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
  const ch = { id: genId(), bookId, name: data.name, role: data.role || '', description: data.description || '', image: data.image || '' };
  chars.push(ch);
  state.characters[bookId] = chars;
  saveState();
  syncCreateCharacter(bookId, ch);
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
    syncGiveFlame(bookId).then(res => {
      if (res) {
        state.flamesRemaining = res.remaining;
        book.flames = res.bookFlames;
        if (res.expReward) applyExpReward(res.expReward);
        saveState();
        render();
      }
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
  gainExp(remaining * 10, 'flame');
  saveState();
  return true;
}

function recordView(bookId) {
  const book = getBook(bookId);
  if (!book) return;
  book.views = (book.views || 0) + 1;
  const d = new Date().toISOString().split('T')[0];
  if (!book.dailyViews) book.dailyViews = {};
  book.dailyViews[d] = (book.dailyViews[d] || 0) + 1;
  saveState();
  syncRecordView(bookId);
}

// ---- Review CRUD ----
function getReviews(bookId) { return state.reviews[bookId] || []; }

function createReview(bookId, data) {
  const reviews = getReviews(bookId);
  const r = { id: genId(), bookId, username: state.user.username, content: data.content, createdAt: new Date().toLocaleDateString(), editedAt: null, pinned: false, favorited: false };
  reviews.push(r);
  state.reviews[bookId] = reviews;
  saveState();
  if (serverOnline) {
    syncCreateReview(bookId, data).then(res => {
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
}

// ---- Chapter Comment CRUD ----
function getChapterComments(bookId, chapterId) {
  const key = bookId + '_' + chapterId;
  return state.chapterComments[key] || [];
}
function createChapterComment(bookId, chapterId, content) {
  const key = bookId + '_' + chapterId;
  if (!state.chapterComments[key]) state.chapterComments[key] = [];
  const c = { id: genId(), username: state.user.username, content, createdAt: new Date().toLocaleDateString() };
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

function giveSingleFlame(bookId) {
  const book = getBook(bookId);
  if (!book || book.author === state.user.username) return false;

  if (serverOnline) {
    const ch = state.chapters[bookId];
    const chId = ch && ch.length ? ch[ch.length-1].id : '';
    const endpoint = chId ? syncGiveSingleFlame(chId) : syncGiveFlame(bookId);
    endpoint.then(res => {
      if (!res) return;
      state.flamesRemaining = res.remaining;
      book.flames = res.bookFlames;
      if (res.expReward) applyExpReward(res.expReward);
      saveState();
      render();
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
  if (route.startsWith('/write/works/')) hideNav = true;

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
  else if (route.startsWith('/book/') && route.includes('/read/')) {
    const parts = route.split('/');
    mainContent = renderChapterReader(parts[2], parts[4]);
  } else if (route.startsWith('/book/')) {
    const id = route.split('/')[2];
    mainContent = renderBookPage(id);
  } else mainContent = renderFeatured();

  root.innerHTML = `
    <div class="app-layout">
      ${hideNav ? '' : `<header class="top-header"><span class="app-logo">Flow World</span><div class="header-auth">${state.loggedIn ? `<span class="auth-user">${state.user.username}</span>${(state.notifications||[]).length ? `<span class="notif-badge">${state.notifications.length}</span>` : ''}<button class="btn btn-sm auth-btn" id="sign-out-btn">Sign out</button>` : `<button class="btn btn-sm auth-btn" onclick="navigate('#/signin')">Sign in</button><button class="btn btn-primary auth-btn" onclick="navigate('#/signup')">Sign up</button>`}</div></header>`}
      <main class="main-content">${mainContent}</main>
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
    <div class="${coverClass('book-cover', n.cover)}" data-img-url="${n.cover || ''}" data-img-context="book-cover:${n.id}" style="${imageBg(n.cover, 'background:linear-gradient(135deg,' + coverColor(n.title) + ')')}">${badge}<span>${n.cover ? '' : imageFallback(n.title)}</span></div>
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
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="font-size:0.85rem;font-weight:600">Chapters (${chapters.length})</h3>
            <button class="btn btn-sm" onclick="navigate('#/write/works/${id}/chapters/new')"><img src="Icons/editpen.png" width="12" style="vertical-align:middle;margin-right:4px">Add Chapter</button>
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
          ${chars.length ? chars.map(c => `
            <div class="char-item">
              <div class="char-avatar">${c.name[0]}</div>
              <div style="flex:1">
                <h4 style="font-size:0.75rem;font-weight:600">${c.name}</h4>
                <span style="font-size:0.6rem;color:var(--text2)">${c.role}</span>
                <p style="font-size:0.65rem;color:var(--text3);margin-top:2px">${c.description}</p>
              </div>
              <button class="btn btn-sm ws-del-char" data-book="${id}" data-char="${c.id}" style="font-size:0.55rem;padding:3px 8px;color:var(--red)">Delete</button>
            </div>
          `).join('') : '<p style="font-size:0.72rem;color:var(--text3);padding:16px 0;text-align:center">No characters yet.</p>'}
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
function renderCreateChapter(bookId) {
  const book = getBook(bookId);
  if (!book) return '<div class="page"><h2>Book not found</h2></div>';
  return `
    <div class="page">
      <a class="back-link" href="#/write/works/${bookId}">Back to ${book.title}</a>
      <h1 class="page-title">New Chapter</h1>
      <form id="create-chapter-form" data-book="${bookId}" style="display:flex;flex-direction:column;gap:14px">
        <div class="form-group">
          <label>Chapter Title</label>
          <input class="input-field" name="title" placeholder="Chapter title" required>
        </div>
        <div class="form-group">
          <label>Content</label>
          <textarea class="input-field" name="content" placeholder="Write your chapter..." rows="12" style="min-height:200px"></textarea>
        </div>
        <div style="display:flex;gap:8px">
          <button type="submit" class="btn btn-primary" style="flex:1"><img src="Icons/settings.png" width="12" style="vertical-align:middle;margin-right:4px">Save Draft</button>
          <button type="button" class="btn btn-sm ws-save-publish" data-book="${bookId}" style="flex:1;background:rgba(255,255,255,0.1);color:var(--accent)"><img src="Icons/editpen.png" width="12" style="vertical-align:middle;margin-right:4px">Save &amp; Publish</button>
        </div>
      </form>
    </div>`;
}

// ---- Create Character ----
function renderCreateCharacter(bookId) {
  const book = getBook(bookId);
  if (!book) return '<div class="page"><h2>Book not found</h2></div>';
  return `
    <div class="page">
      <a class="back-link" href="#/write/works/${bookId}">Back to ${book.title}</a>
      <h1 class="page-title">New Character</h1>
      <form id="create-character-form" data-book="${bookId}" style="display:flex;flex-direction:column;gap:14px">
        <div class="form-group">
          <label>Portrait Image</label>
          <div class="img-upload-wrap">
            <input type="file" accept="image/*" id="char-portrait-input" style="display:none">
            <div id="char-portrait-preview" class="img-preview" style="width:80px;height:80px;border-radius:50%">+</div>
          </div>
        </div>
        <div class="form-group">
          <label>Character Name</label>
          <input class="input-field" name="name" placeholder="Character name" required>
        </div>
        <div class="form-group">
          <label>Role</label>
          <input class="input-field" name="role" placeholder="Protagonist, Antagonist, etc.">
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea class="input-field" name="description" placeholder="Describe your character..." rows="4"></textarea>
        </div>
        <button type="submit" class="btn btn-primary"><img src="Icons/person-plus.png" width="12" style="vertical-align:middle;margin-right:4px">Add Character</button>
      </form>
    </div>`;
}

// ---- Editor ----
function renderEditor(bookId, chapterId) {
  const book = getBook(bookId);
  const chapter = (state.chapters[bookId] || []).find(c => c.id === chapterId);
  if (!book || !chapter) return '<div class="page"><h2>Not found</h2></div>';

  return `
    <div style="display:flex;flex-direction:column;height:100vh;background:var(--bg)">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--bg-card);box-shadow:0 2px 8px rgba(0,0,0,0.2)">
        <a class="back-link" href="#/write/works/${bookId}" style="padding:0;font-size:0.85rem"><img src="Icons/open-book.png" width="12" style="vertical-align:middle;margin-right:4px">Back</a>
        <span style="flex:1;font-size:0.82rem;font-weight:600">${book.title} - Ch.${chapter.chapterNumber}</span>
        <span id="editor-autosave-status" style="font-size:0.6rem;color:var(--text3);margin-right:6px"></span>
        <button class="btn btn-sm ed-save" data-book="${bookId}" data-ch="${chapterId}" style="font-size:0.65rem"><img src="Icons/settings.png" width="12" style="vertical-align:middle;margin-right:4px">Save</button>
        <button class="btn btn-sm ed-revisions" data-book="${bookId}" data-ch="${chapterId}" style="font-size:0.65rem"><img src="Icons/books-stack-of-three.png" width="12" style="vertical-align:middle;margin-right:4px">History</button>
        <button class="btn btn-primary ed-publish" data-book="${bookId}" data-ch="${chapterId}" style="padding:5px 12px;font-size:0.65rem">${chapter.published?'Unpublish':'Publish'}</button>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;padding:16px 20px;overflow-y:auto">
        <input id="editor-title" class="input-field" style="font-size:1rem;font-weight:700;border:none;padding:4px 0;margin-bottom:12px;background:transparent" value="${chapter.title}" placeholder="Chapter Title">
        <textarea id="editor-content" style="flex:1;width:100%;background:transparent;border:none;resize:none;font-size:0.85rem;line-height:1.7;padding:4px 0;color:var(--text)" placeholder="Start writing...">${chapter.content}</textarea>
      </div>
    </div>

    <!-- Revision History Modal -->
    <div class="ch-list-modal" id="rev-modal" style="display:none">
      <div class="ch-list-overlay"></div>
      <div class="ch-list-panel">
        <div class="ch-list-header" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line2)">
          <span style="font-weight:600;font-size:0.85rem"><img src="Icons/books-stack-of-three.png" width="14" style="vertical-align:middle;margin-right:6px">Revision History</span>
          <button class="btn btn-sm rd-rev-close" style="font-size:0.65rem">x</button>
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
  const achievements = [];
  if (myBooks.length >= 1) achievements.push({ icon: 'Icons/book.png', label: 'First Book' });
  if (myBooks.length >= 3) achievements.push({ icon: 'Icons/books-stack-of-three.png', label: '3 Books' });
  if (myBooks.length >= 5) achievements.push({ icon: 'Icons/books-stack-of-three.png', label: '5 Books' });
  if (totalViews >= 100) achievements.push({ icon: 'Icons/view.png', label: '100 Views' });
  if (totalViews >= 1000) achievements.push({ icon: 'Icons/view.png', label: '1K Views' });
  if (totalViews >= 100000) achievements.push({ icon: 'Icons/view.png', label: '100K Views' });
  if (totalFlames >= 1) achievements.push({ icon: 'Icons/fire.png', label: 'First Flame' });
  if (totalFlames >= 100) achievements.push({ icon: 'Icons/fire-flame.png', label: '100 Flames' });
  if (compBooks >= 1) achievements.push({ icon: 'Icons/icons8-check-mark-50.png', label: 'Completed Work' });

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
        <div class="prof-action" id="prof-inbox-toggle" style="cursor:pointer">
          <div class="prof-action-icon"><img src="Icons/inbox.png" width="22"></div>
          <span class="prof-action-label">Inbox${(state.notifications||[]).length ? ' (' + state.notifications.length + ')' : ''}</span>
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

      <!-- Inbox -->
      <div class="prof-inbox prof-inbox" id="prof-inbox" style="display:none">
        ${(state.notifications||[]).length ? state.notifications.map(n => `
        <div class="prof-inbox-item">
          <span class="prof-inbox-text">${n.text}</span>
          <span class="prof-inbox-date">${n.date}</span>
        </div>`).join('') : '<div class="prof-inbox-empty">No notifications yet</div>'}
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
        <div class="section-header"><h3 class="section-title">Achievements</h3></div>
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
        <button class="btn btn-primary author-follow-btn">+ Follow</button>
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
function renderBookPage(id) {
  const book = getBook(id);
  if (!book) return '<div class="page"><h2>Book not found</h2></div>';
  const isAuthor = state.loggedIn && book.author === state.user.username;
  if (!isAuthor && !isPublicBook(book)) return '<div class="page"><h2>Book not found</h2></div>';

  recordView(id);
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
            <button class="btn btn-sm book-fav" data-book="${id}" style="background:${isFav?'rgba(255,255,255,0.15)':'var(--bg-hover)'}">${isFav?'Favorited':'Favorite'}</button>
            ${chapters.length ? `<a class="btn btn-primary" href="#/book/${id}/read/${chapters[0].id}" style="text-decoration:none">Start Reading</a>` : ''}
            ${state.loggedIn && !isAuthor ? (() => {
  const td = new Date().toDateString();
  const lv = state.user.level || 1;
  const maxF = dailyFlameAllowance(lv);
  const rem = serverOnline ? (state.flamesRemaining ?? maxF) : Math.max(0, maxF - (state.flameDate === td ? state.flamesGiven : 0));
  return `<button class="btn btn-flame book-flame" data-book="${id}" style="padding:5px 10px">${rem > 0 ? 'Give ' + rem + ' Flame' + (rem > 1 ? 's' : '') : 'Given'}</button>`;
})() : ''}
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
            ${state.loggedIn ? `
            <form class="review-form" data-book="${id}">
              <textarea class="input-field review-input" name="content" placeholder="Write a review..." rows="3" required></textarea>
              <button type="submit" class="btn btn-primary" style="font-size:0.68rem;padding:6px 14px;margin-top:6px">Post Review</button>
            </form>` : `<p style="font-size:0.72rem;color:var(--text3);margin-bottom:12px"><a href="#/signin" style="color:var(--accent)">Sign in</a> to leave a review</p>`}
            ${sortedReviews.length ? sortedReviews.map(r => `
            <div class="review-item${r.pinned ? ' pinned' : ''}">
              ${r.pinned ? '<div class="review-pinned-badge">Pinned Review</div>' : ''}
              <div class="review-header">
                <span class="review-avatar">${r.username[0]}</span>
                <span class="review-author">${r.username}</span>
                <span class="review-date">${r.editedAt ? r.editedAt + ' (edited)' : r.createdAt}</span>
              </div>
              <p class="review-text">${r.content}</p>
              ${r.favorited ? '<div class="review-fav-badge">Author\'s Favorite</div>' : ''}
              <div class="review-actions">
                ${isAuthor ? `
                  <button class="btn btn-sm review-pin-btn" data-book="${id}" data-review="${r.id}" style="font-size:0.55rem;padding:3px 8px">${r.pinned ? 'Unpin' : 'Pin'}</button>
                  <button class="btn btn-sm review-fav-btn" data-book="${id}" data-review="${r.id}" style="font-size:0.55rem;padding:3px 8px">${r.favorited ? 'Unfavorite' : 'Favorite'}</button>
                  <button class="btn btn-sm review-del-btn" data-book="${id}" data-review="${r.id}" style="font-size:0.55rem;padding:3px 8px;color:var(--red)">Delete</button>
                ` : state.loggedIn && r.username === state.user.username ? `
                  <button class="btn btn-sm review-del-btn" data-book="${id}" data-review="${r.id}" style="font-size:0.55rem;padding:3px 8px;color:var(--red)">Delete</button>
                ` : ''}
              </div>
            </div>
            `).join('') : '<p style="font-size:0.72rem;color:var(--text3);padding:16px 0;text-align:center">No reviews yet</p>'}
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
            <div class="char-card">
              <div class="${imageClass('char-card-img', c.image || c.portrait)}" data-img-url="${c.image || c.portrait || ''}" data-img-context="character:${c.id}" style="${imageBg(c.image || c.portrait, '')}">${(c.image || c.portrait) ? '' : imageFallback(c.name)}</div>
              <h4 class="char-card-name">${c.name}</h4>
              <span class="char-card-role">${c.role || 'Character'}</span>
            </div>
            `).join('') : '<div class="empty-state" style="grid-column:1/-1"><h3>No characters yet</h3><p>Characters will appear here</p></div>'}
          </div>
        ` : bookTab==='Reviews' ? `
          <section class="content-section">
            <h3 class="section-title">Reviews (${reviews.length})</h3>
            ${state.loggedIn ? `
            <form class="review-form" data-book="${id}">
              <textarea class="input-field review-input" name="content" placeholder="Write a review..." rows="3" required></textarea>
              <button type="submit" class="btn btn-primary" style="font-size:0.68rem;padding:6px 14px;margin-top:6px">Post Review</button>
            </form>` : `<p style="font-size:0.72rem;color:var(--text3);margin-bottom:12px"><a href="#/signin" style="color:var(--accent)">Sign in</a> to leave a review</p>`}
            ${sortedReviews.length ? sortedReviews.map(r => `
            <div class="review-item${r.pinned ? ' pinned' : ''}">
              ${r.pinned ? '<div class="review-pinned-badge">Pinned Review</div>' : ''}
              <div class="review-header">
                <span class="review-avatar">${r.username[0]}</span>
                <span class="review-author">${r.username}</span>
                <span class="review-date">${r.editedAt ? r.editedAt + ' (edited)' : r.createdAt}</span>
              </div>
              <p class="review-text">${r.content}</p>
              ${r.favorited ? '<div class="review-fav-badge">Author\'s Favorite</div>' : ''}
              <div class="review-actions">
                ${isAuthor ? `
                  <button class="btn btn-sm review-pin-btn" data-book="${id}" data-review="${r.id}" style="font-size:0.55rem;padding:3px 8px">${r.pinned ? 'Unpin' : 'Pin'}</button>
                  <button class="btn btn-sm review-fav-btn" data-book="${id}" data-review="${r.id}" style="font-size:0.55rem;padding:3px 8px">${r.favorited ? 'Unfavorite' : 'Favorite'}</button>
                  <button class="btn btn-sm review-del-btn" data-book="${id}" data-review="${r.id}" style="font-size:0.55rem;padding:3px 8px;color:var(--red)">Delete</button>
                ` : state.loggedIn && r.username === state.user.username ? `
                  <button class="btn btn-sm review-del-btn" data-book="${id}" data-review="${r.id}" style="font-size:0.55rem;padding:3px 8px;color:var(--red)">Delete</button>
                ` : ''}
              </div>
            </div>
            `).join('') : '<p style="font-size:0.72rem;color:var(--text3);padding:16px 0;text-align:center">No reviews yet</p>'}
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
  const chComments = getChapterComments(bookId, chapterId);

  return `
    <div class="page reader-page">
      <div class="reader-header">
        <a class="back-link" href="#/book/${bookId}" style="padding:0"><img src="Icons/open-book.png" width="14" style="vertical-align:middle;margin-right:4px">Back to Book</a>
        <span class="reader-chapter-info">Ch. ${ch.chapterNumber} &middot; ${ch.title}</span>
      </div>
      <h1 class="reader-title">${ch.title}</h1>
      <div class="reader-content">${ch.content}</div>

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
          <div class="end-card-label"><img src="Icons/inbox.png" width="14" style="vertical-align:middle;margin-right:6px">Chapter Discussion</div>
          ${state.loggedIn ? `
          <form class="ch-comment-form" data-book="${bookId}" data-chapter="${chapterId}" style="margin-bottom:10px">
            <textarea class="input-field" name="content" placeholder="Comment on this chapter..." rows="2" style="margin-bottom:6px"></textarea>
            <button type="submit" class="btn btn-primary" style="font-size:0.65rem;padding:5px 12px">Post Comment</button>
          </form>` : `<p class="end-comment-login" style="font-size:0.65rem;color:var(--text3);margin-bottom:10px"><a href="#/signin" style="color:var(--accent)">Sign in</a> to comment</p>`}
          <div class="ch-comments">
            ${chComments.length ? chComments.map(c => `
            <div class="ch-comment-item">
              <span class="ch-comment-avatar">${c.username[0]}</span>
              <div class="ch-comment-body">
                <span class="ch-comment-author">${c.username}</span>
                <span class="ch-comment-date">${c.createdAt}</span>
                <p class="ch-comment-text">${c.content}</p>
              </div>
              ${state.loggedIn && (c.username === state.user.username || book.author === state.user.username) ? `<button class="btn btn-sm ch-comment-del" data-book="${bookId}" data-chapter="${chapterId}" data-comment="${c.id}" style="font-size:0.5rem;padding:2px 6px;color:var(--red);flex-shrink:0">x</button>` : ''}
            </div>
            `).join('') : '<p style="font-size:0.65rem;color:var(--text3);text-align:center;padding:8px 0">No comments yet</p>'}
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

    <!-- Chapter List Modal -->
    <div class="ch-list-modal" id="ch-list-modal" style="display:none">
      <div class="ch-list-overlay"></div>
      <div class="ch-list-panel">
        <div class="ch-list-header" style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line2)">
          <span style="font-weight:600;font-size:0.85rem">Chapters</span>
          <button class="btn btn-sm rd-ch-list-close" style="font-size:0.65rem">x</button>
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

// ============================================================
// EVENT BINDING
// ============================================================
function bindPageEvents(route) {
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
    const pubBtn = chForm.querySelector('.ws-save-publish');
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

  // ---- Create Character form ----
  const charForm = document.getElementById('create-character-form');
  if (charForm) {
    const preview = document.getElementById('char-portrait-preview');
    const fileInput = document.getElementById('char-portrait-input');
    if (preview && fileInput) {
      preview.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        const f = fileInput.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => { preview.style.backgroundImage = 'url(' + r.result + ')'; preview.textContent = ''; preview.dataset.image = r.result; };
        r.readAsDataURL(f);
      });
    }
    charForm.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(charForm);
      const bookId = charForm.dataset.book;
      const data = { name: fd.get('name'), role: fd.get('role'), description: fd.get('description'), image: preview ? preview.dataset.image || '' : '' };
      if (!data.name.trim()) return;
      createCharacter(bookId, data);
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
      render();
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
    form.addEventListener('submit', e => {
      e.preventDefault();
      const bookId = form.dataset.book;
      const input = form.querySelector('.review-input');
      const content = input?.value?.trim();
      if (!content) return;
      createReview(bookId, { content });
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

  // ---- Book favorite ----
  document.querySelectorAll('.book-fav').forEach(el => {
    el.addEventListener('click', () => { toggleFavorite(el.dataset.book); render(); });
  });

  // ---- Book flames ----
  document.querySelectorAll('.book-flame').forEach(el => {
    el.addEventListener('click', () => {
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
      state.user.followers += 1;
      saveState();
      render();
    });
  });

  // ---- Support author ----
  document.querySelectorAll('.author-support-btn').forEach(el => {
    el.addEventListener('click', () => {
      const amount = prompt('Enter flame amount to send:', '10');
      if (!amount) return;
      const num = parseInt(amount);
      if (isNaN(num) || num <= 0) return;
      const giver = state.user.username;
      state.supporterHistory.push({ user: giver, amount: num, date: new Date().toISOString() });
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

  // ---- Inbox Toggle ----
  const inboxToggle = document.getElementById('prof-inbox-toggle');
  if (inboxToggle) {
    inboxToggle.addEventListener('click', () => {
      const inbox = document.getElementById('prof-inbox');
      if (inbox) { inbox.style.display = inbox.style.display === 'none' ? 'block' : 'none'; }
    });
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
      const fb = document.getElementById('flame-feedback');
      if (serverOnline) {
        const chs = state.chapters[bookId];
        const chId = chs && chs.length ? chs[chs.length-1].id : null;
        const promise = chId ? syncGiveSingleFlame(chId) : syncGiveFlame(bookId);
        promise.then(res => {
          if (res) {
            const book = getBook(bookId);
            if (book) book.flames = res.bookFlames;
            state.flamesRemaining = res.remaining;
            if (res.expReward) applyExpReward(res.expReward);
            saveState();
            if (fb) {
              fb.style.display = 'block';
              fb.classList.add('flame-anim');
              setTimeout(() => { fb.classList.remove('flame-anim'); render(); }, 1200);
            } else { render(); }
          }
        });
      } else {
        if (giveSingleFlame(bookId)) {
          saveState();
          gainExp(10, 'flame');
          if (fb) {
            fb.style.display = 'block';
            fb.classList.add('flame-anim');
            setTimeout(() => { fb.classList.remove('flame-anim'); render(); }, 1200);
          } else { render(); }
        }
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
