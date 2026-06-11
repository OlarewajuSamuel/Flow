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
  try {
    const saved = localStorage.getItem('novelState');
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return {
    theme: 'dark',
    loggedIn: false,
    user: { username: 'Guest', bio: '', level: 1, rank: 0, followers: 0, email: '', avatar: '', banner: '', website: '', discord: '', twitter: '', facebook: '', joinDate: '' },
    books: [],
    chapters: {},
    characters: {},
    favorites: [],
    flames: {},
    wallPosts: [],
    profileComments: [],
    supporterHistory: [],
  };
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

// Try backend auth; fall back to localStorage
async function initAuth() {
  const data = await apiFetch('/api/auth/me');
  if (data && data.loggedIn) {
    state.loggedIn = true;
    state.user = { ...state.user, ...data.user };
    saveState();
  } else if (state.loggedIn && state.user.email && accounts[state.user.email]) {
    loginAs(state.user.email);
  }
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
    status: 'Draft',
    chapterCount: 0,
    views: 0,
    favorites: 0,
    flames: 0,
    rating: 0,
    ratingCount: 0,
    createdAt: today(),
    updatedAt: today(),
  };
  state.books.push(book);
  state.chapters[book.id] = [];
  state.characters[book.id] = [];
  saveState();
  return book;
}

function updateBook(id, data) {
  const book = getBook(id);
  if (!book) return;
  Object.assign(book, data, { updatedAt: today() });
  saveState();
}

function deleteBook(id) {
  state.books = state.books.filter(b => b.id !== id);
  delete state.chapters[id];
  delete state.characters[id];
  state.favorites = state.favorites.filter(f => f !== id);
  delete state.flames[id];
  saveState();
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
  return chapter;
}

function updateChapter(bookId, chapterId, data) {
  const chapters = state.chapters[bookId] || [];
  const ch = chapters.find(c => c.id === chapterId);
  if (!ch) return;
  Object.assign(ch, data, { updatedAt: today() });
  saveState();
}

function deleteChapter(bookId, chapterId) {
  state.chapters[bookId] = (state.chapters[bookId] || []).filter(c => c.id !== chapterId);
  const book = getBook(bookId);
  if (book) {
    book.chapterCount = state.chapters[bookId].length;
    book.updatedAt = today();
  }
  saveState();
}

function createCharacter(bookId, data) {
  const chars = state.characters[bookId] || [];
  const ch = { id: genId(), bookId, name: data.name, role: data.role || '', description: data.description || '' };
  chars.push(ch);
  state.characters[bookId] = chars;
  saveState();
  return ch;
}

function deleteCharacter(bookId, charId) {
  state.characters[bookId] = (state.characters[bookId] || []).filter(c => c.id !== charId);
  saveState();
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
}

function giveFlames(bookId, amount) {
  if (!state.flames[bookId]) state.flames[bookId] = 0;
  state.flames[bookId] += amount;
  const book = getBook(bookId);
  if (book) book.flames = (book.flames || 0) + amount;
  saveState();
}

function recordView(bookId) {
  const book = getBook(bookId);
  if (book) book.views = (book.views || 0) + 1;
  saveState();
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
  else if (route.startsWith('/book/')) {
    const id = route.split('/')[2];
    mainContent = renderBookPage(id);
  } else mainContent = renderFeatured();

  root.innerHTML = `
    <div class="app-layout">
      ${hideNav ? '' : `<header class="top-header"><span class="app-logo">Flow World</span><div class="header-auth">${state.loggedIn ? `<span class="auth-user">${state.user.username}</span><button class="btn btn-sm auth-btn" id="sign-out-btn">Sign out</button>` : `<button class="btn btn-sm auth-btn" onclick="navigate('#/signin')">Sign in</button><button class="btn btn-primary auth-btn" onclick="navigate('#/signup')">Sign up</button>`}</div></header>`}
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
  const books = state.books;
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
    <div class="book-cover" style="background:linear-gradient(135deg,${coverColor(n.title)})">${badge}<span>${n.title[0]}</span></div>
    <div class="book-info"><div class="book-title">${n.title}</div><span class="book-author">${n.author}</span><div class="book-stats"><span>${fmt(n.flames)}</span></div></div>
  </a>`;
}

function rankingItem(n, i) {
  const cls = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '';
  return `<a class="ranking-item" href="#/book/${n.id}">
    <span class="ranking-pos ${cls}">${i + 1}</span>
    <div class="ranking-cover" style="background:linear-gradient(135deg,${coverColor(n.title)})">${n.title[0]}</div>
    <div class="ranking-info"><h4>${n.title}</h4><span class="ranking-author">${n.author}</span><span class="ranking-meta">${fmt(n.flames)}</span></div>
  </a>`;
}

// ---- Library ----
function renderLibrary() {
  const favs = state.favorites;
  const favBooks = state.books.filter(b => favs.includes(b.id));
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
    <div class="book-cov-m" style="background:linear-gradient(135deg,${coverColor(n.title)})">${n.title[0]}</div>
    <div class="ranking-info"><h4>${n.title}</h4><span class="ranking-author">${n.author}</span><span class="ranking-meta">${fmt(n.flames)}</span></div>
  </a>`;
}

// ---- Write ----
function renderWriteWorks() {
  const myBooks = getBooksByAuthor();
  return `
    <div class="page write-page">
      <h1 class="page-title">Write</h1>
      <div class="tabs">
        <a class="tab active" href="#/write">Works</a>
      </div>
      ${myBooks.length ? `<div class="works-list">${myBooks.map(w => `
        <a class="work-item" href="#/write/works/${w.id}">
          <div class="work-cover" style="background:linear-gradient(135deg,${coverColor(w.title)})">${w.title.slice(0,2)}</div>
          <div class="work-info"><h3>${w.title}</h3>
            <div class="work-stats-row"><span>${w.chapterCount} chapters</span><span>${fmt(w.views)} views</span><span>${fmt(w.flames)} flames</span></div>
            <div style="display:flex;gap:6px;align-items:center;margin-top:3px">
              <span class="status-badge" style="background:${w.status==='Draft'?'var(--accent-subtle)':'rgba(255,255,255,0.1)'};color:${w.status==='Draft'?'var(--text2)':'var(--accent)'}">${w.status}</span>
              <span style="font-size:0.55rem;color:var(--text3)">${w.updatedAt}</span>
            </div>
          </div>
        </a>`).join('')}</div>` : `
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
      <a class="back-link" href="#/write">Back to Works</a>
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
let wsTab = 'Chapters';
function renderWorkspaceBook(id) {
  const book = getBook(id);
  if (!book) return '<div class="page"><h2>Book not found</h2></div>';

  const chapters = state.chapters[id] || [];
  const chars = state.characters[id] || [];

  return `
    <div class="page">
      <a class="back-link" href="#/write">Back to Works</a>
      <div style="display:flex;gap:14px;margin-bottom:14px">
        <div class="work-cover" style="width:56px;height:76px;background:linear-gradient(135deg,${coverColor(book.title)})">${book.title.slice(0,2)}</div>
        <div style="flex:1">
          <h1 style="font-size:0.95rem;font-weight:700">${book.title}</h1>
          <p style="font-size:0.65rem;color:var(--text2)">${book.synopsis ? book.synopsis.slice(0,100) + '...' : 'No synopsis'}</p>
          <span class="status-badge" style="background:${book.status==='Draft'?'var(--accent-subtle)':'rgba(255,255,255,0.1)'};color:${book.status==='Draft'?'var(--text2)':'var(--accent)'};margin-top:4px;display:inline-block">${book.status}</span>
        </div>
      </div>
      <div class="workspace-tabs" style="display:flex;gap:0;border-bottom:1px solid var(--line2);margin-bottom:14px;overflow-x:auto">
        ${['Chapters','Characters','Settings'].map(t => `<span class="tab${wsTab===t?' active':''}" data-ws-tab="${t}" style="font-size:0.7rem">${t}</span>`).join('')}
      </div>
      <div class="ws-content">
        ${wsTab === 'Chapters' ? `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="font-size:0.85rem;font-weight:600">Chapters (${chapters.length})</h3>
            <button class="btn btn-sm" onclick="navigate('#/write/works/${id}/chapters/new')">+ Add Chapter</button>
          </div>
          ${chapters.length ? chapters.map(ch => `
            <div class="chapter-item">
              <span class="chapter-num">Ch. ${ch.chapterNumber}</span>
              <span class="chapter-title">${ch.title || 'Untitled'}</span>
              <span class="chapter-status ${ch.published?'published':'draft'}">${ch.published?'Published':'Draft'}</span>
              <span class="chapter-date">${ch.createdAt}</span>
              <button class="btn btn-sm ws-edit-ch" data-book="${id}" data-ch="${ch.id}" style="font-size:0.55rem;padding:3px 8px">Edit</button>
              <button class="btn btn-sm ws-pub-ch" data-book="${id}" data-ch="${ch.id}" style="font-size:0.55rem;padding:3px 8px">${ch.published?'Unpublish':'Publish'}</button>
              <button class="btn btn-sm ws-del-ch" data-book="${id}" data-ch="${ch.id}" style="font-size:0.55rem;padding:3px 8px;color:var(--red)">Delete</button>
            </div>
          `).join('') : '<p style="font-size:0.72rem;color:var(--text3);padding:16px 0;text-align:center">No chapters yet. Add your first chapter.</p>'}
        ` : wsTab === 'Characters' ? `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <h3 style="font-size:0.85rem;font-weight:600">Characters (${chars.length})</h3>
            <button class="btn btn-sm" onclick="navigate('#/write/works/${id}/characters/new')">+ Add Character</button>
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
        ` : `
          <div style="display:flex;flex-direction:column;gap:14px">
            <div style="font-size:0.72rem;color:var(--text2)"><strong style="color:var(--text)">Title:</strong> ${book.title}</div>
            <div style="font-size:0.72rem;color:var(--text2)"><strong style="color:var(--text)">Genre:</strong> ${book.genre || 'None'}</div>
            <div style="font-size:0.72rem;color:var(--text2)"><strong style="color:var(--text)">Type:</strong> ${book.type}</div>
            <div style="font-size:0.72rem;color:var(--text2)"><strong style="color:var(--text)">Chapters:</strong> ${book.chapterCount}</div>
            <div style="font-size:0.72rem;color:var(--text2)"><strong style="color:var(--text)">Views:</strong> ${book.views}</div>
            <div style="font-size:0.72rem;color:var(--text2)"><strong style="color:var(--text)">Flames:</strong> ${book.flames}</div>
            <div style="font-size:0.72rem;color:var(--text2)"><strong style="color:var(--text)">Published:</strong> ${book.status !== 'Draft' ? 'Yes' : 'No'}</div>
            <hr style="border:none;border-top:1px solid var(--line2);margin:4px 0">
            <button class="btn btn-sm ws-pub-book" data-book="${id}" style="background:rgba(255,255,255,0.1);color:var(--accent)">${book.status === 'Draft' ? 'Publish Book' : 'Unpublish Book'}</button>
            <button class="btn btn-sm ws-del-book" data-book="${id}" style="color:var(--red)">Delete Book</button>
          </div>`}
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
          <button type="submit" class="btn btn-primary" style="flex:1">Save Draft</button>
          <button type="button" class="btn btn-sm ws-save-publish" data-book="${bookId}" style="flex:1;background:rgba(255,255,255,0.1);color:var(--accent)">Save & Publish</button>
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
        <button type="submit" class="btn btn-primary">Add Character</button>
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
        <a class="back-link" href="#/write/works/${bookId}" style="padding:0;font-size:0.85rem">[back]</a>
        <span style="flex:1;font-size:0.82rem;font-weight:600">${book.title} - Ch.${chapter.chapterNumber}</span>
        <button class="btn btn-sm ed-save" data-book="${bookId}" data-ch="${chapterId}" style="font-size:0.65rem">Save</button>
        <button class="btn btn-primary ed-publish" data-book="${bookId}" data-ch="${chapterId}" style="padding:5px 12px;font-size:0.65rem">${chapter.published?'Unpublish':'Publish'}</button>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;padding:16px 20px;overflow-y:auto">
        <input id="editor-title" class="input-field" style="font-size:1rem;font-weight:700;border:none;padding:4px 0;margin-bottom:12px;background:transparent" value="${chapter.title}" placeholder="Chapter Title">
        <textarea id="editor-content" style="flex:1;width:100%;background:transparent;border:none;resize:none;font-size:0.85rem;line-height:1.7;padding:4px 0;color:var(--text)" placeholder="Start writing...">${chapter.content}</textarea>
      </div>
    </div>`;
}

// ---- Explore ----
let expGenre = null, expRankTab = 'Popular';
function renderExplore(type) {
  const books = state.books.filter(b => b.type === type && b.status !== 'Draft');
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
  if (compBooks >= 1) achievements.push({ icon: 'Icons/check-mark.png', label: 'Completed Work' });

  // Recently Read - last 3 books with progress
  const recentlyRead = myBooks.filter(b => b.lastReadAt).sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0)).slice(0, 3);

  // Daily rewards
  const today = new Date().toDateString();
  const lastClaim = state.lastDailyClaim || '';
  const canClaim = lastClaim !== today;
  const dailyStreak = state.dailyStreak || 0;

  return `
    <div class="page profile-page">
      <!-- Banner -->
      <div class="prof-banner${bannerImg ? ' has-bg' : ''}" style="${bannerImg ? 'background-image:url(' + bannerImg + ')' : ''}">
        <div class="prof-banner-actions">
          <button class="btn btn-sm banner-btn" onclick="document.getElementById('banner-input').click()">Change Banner</button>
          <input type="file" id="banner-input" accept="image/*" style="display:none">
        </div>
      </div>

      <!-- Avatar + Name + Level + EXP -->
      <div class="prof-header-main">
        <div class="prof-avatar-wrap">
          <div class="prof-avatar${avatarImg ? ' has-img' : ''}" style="${avatarImg ? 'background-image:url(' + avatarImg + ')' : ''}">${avatarImg ? '' : u.username[0]}</div>
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

      <!-- Daily Rewards -->
      <div class="prof-rewards">
        <div class="prof-rewards-left">
          <span class="prof-rewards-icon">+</span>
          <div>
            <div class="prof-rewards-title">Daily Reward</div>
            <div class="prof-rewards-sub">${canClaim ? 'Claim 5 Flames' : 'Claimed today'}</div>
          </div>
        </div>
        <div class="prof-rewards-right">
          ${canClaim ? '<button class="btn btn-primary btn-sm" id="claim-daily-btn">Claim</button>' : '<span class="prof-rewards-check">Claimed</span>'}
          ${dailyStreak > 0 ? `<span class="prof-streak">Day ${dailyStreak}</span>` : ''}
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="prof-actions">
        <div class="prof-action" onclick="navigate('#/profile/edit')">
          <div class="prof-action-icon"><img src="Icons/user1.png" width="22"></div>
          <span class="prof-action-label">Edit Profile</span>
        </div>
        <div class="prof-action" onclick="navigate('#/profile/author')">
          <div class="prof-action-icon"><img src="Icons/user.png" width="22"></div>
          <span class="prof-action-label">Author Page</span>
        </div>
        <div class="prof-action" onclick="navigate('#/write')">
          <div class="prof-action-icon"><img src="Icons/open-book.png" width="22"></div>
          <span class="prof-action-label">New Book</span>
        </div>
        <div class="prof-action" onclick="navigate('#/explore')">
          <div class="prof-action-icon"><img src="Icons/bookexplore.png" width="22"></div>
          <span class="prof-action-label">Explore</span>
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
        <div class="section-header"><h3 class="section-title">Achievements</h3></div>
        <div class="prof-achievements">
          ${achievements.map(a => `
          <div class="prof-achievement">
            <img src="${a.icon}" class="prof-achievement-icon">
            <span>${a.label}</span>
          </div>`).join('')}
        </div>
      </div>` : ''}

      <!-- My Works -->
      <div class="prof-section" onclick="navigate('#/write')" style="cursor:pointer">
        <div class="prof-section-icon"><img src="Icons/open-book.png" width="22"></div>
        <div class="prof-section-body"><span class="prof-section-title">My Works</span><span class="prof-section-desc">${pubBooks} published, ${draftBooks} drafts, ${compBooks} completed</span></div>
        <span class="prof-section-arrow">-</span>
      </div>

      <!-- FAQ (expandable) -->
      <div class="prof-section" id="prof-faq-toggle" style="cursor:pointer">
        <div class="prof-section-icon"><span style="font-size:1.1rem;font-weight:700">?</span></div>
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
      <div class="prof-section" onclick="navigate('#/profile/themes')" style="cursor:pointer">
        <div class="prof-section-icon"><span style="font-size:1.1rem">*</span></div>
        <div class="prof-section-body"><span class="prof-section-title">Theme</span><span class="prof-section-desc">Dark or Galaxy appearance</span></div>
        <span class="prof-section-arrow">-</span>
      </div>

      <!-- Services (expandable) -->
      <div class="prof-section" id="prof-services-toggle" style="cursor:pointer">
        <div class="prof-section-icon"><span style="font-size:1.1rem;font-weight:700">!</span></div>
        <div class="prof-section-body"><span class="prof-section-title">Services</span><span class="prof-section-desc">Policies, support, and guidelines</span></div>
        <span class="prof-section-arrow" id="prof-services-arrow">+</span>
      </div>
      <div class="prof-services-content" id="prof-services-content" style="display:none">
        <a class="prof-service-item">Privacy Policy</a>
        <a class="prof-service-item">Terms of Service</a>
        <a class="prof-service-item">Contact Support</a>
        <a class="prof-service-item">Report Problem</a>
        <a class="prof-service-item">Community Guidelines</a>
      </div>

      <!-- Logout / Delete -->
      <div class="prof-section" style="cursor:pointer;border-left:2px solid var(--red)" onclick="if(confirm('Sign out?')){document.getElementById('sign-out-btn').click()}">
        <div class="prof-section-icon"><img src="Icons/icons8-logout-50.png" width="20" style="filter:brightness(0.5)"></div>
        <div class="prof-section-body"><span class="prof-section-title" style="color:var(--red)">Logout</span><span class="prof-section-desc">Sign out of your account</span></div>
      </div>
      <div class="prof-section" style="cursor:pointer;margin-bottom:24px" onclick="if(confirm('Delete account permanently? This cannot be undone.')){localStorage.clear();location.reload()}">
        <div class="prof-section-icon"><span style="font-size:1.1rem;color:var(--text3)">-</span></div>
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
              <div class="edit-avatar-preview" id="edit-avatar-preview" style="background-image:${u.avatar ? 'url(' + u.avatar + ')' : 'none'}">${u.avatar ? '' : u.username[0]}</div>
              <div class="edit-img-actions">
                <button type="button" class="btn btn-sm" onclick="document.getElementById('edit-avatar-input').click()">Upload</button>
                <button type="button" class="btn btn-sm" id="remove-avatar-btn" style="${u.avatar ? '' : 'display:none'}">Remove</button>
              </div>
              <input type="file" id="edit-avatar-input" accept="image/*" style="display:none">
            </div>
            <div class="edit-img-group">
              <label>Banner</label>
              <div class="edit-banner-preview" id="edit-banner-preview" style="background-image:${u.banner ? 'url(' + u.banner + ')' : 'none'}"></div>
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
        <div class="author-banner" style="${bannerImg ? 'background-image:url(' + bannerImg + ')' : ''}"></div>
        <div class="author-header-content">
          <div class="author-info-row">
            <div class="author-avatar${avatarImg?' has-img':''}" style="${avatarImg ? 'background-image:url(' + avatarImg + ')' : ''}">${avatarImg ? '' : u.username[0]}</div>
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
          <div style="display:flex;justify-content:space-between;padding:6px 8px;background:var(--bg-card);border-radius:var(--r)">
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
  const darkActive = state.theme !== 'galaxy';
  return `
    <div class="page">
      <a class="back-link" href="#/profile">Back to Profile</a>
      <h1 class="page-title">Theme</h1>
      <div class="theme-grid">
        <div class="theme-card${darkActive ? ' active' : ''}" data-theme-btn="dark">
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
          ${darkActive ? '<span class="theme-check">Selected</span>' : ''}
        </div>
        <div class="theme-card${!darkActive ? ' active' : ''}" data-theme-btn="galaxy">
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
          ${!darkActive ? '<span class="theme-check">Selected</span>' : ''}
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
let bookTab = 'Info';
function renderBookPage(id) {
  const book = getBook(id);
  if (!book) return '<div class="page"><h2>Book not found</h2></div>';

  recordView(id);
  const tabs = ['Info','Chapters','Characters'];
  const chapters = (state.chapters[id] || []).filter(c => c.published);
  const chars = state.characters[id] || [];
  const isFav = state.favorites.includes(id);

  return `
    <div class="page book-page">
      <div class="book-hero">
        <div class="book-hero-cover" style="background:linear-gradient(135deg,${coverColor(book.title)})">${book.title[0]}</div>
        <div class="book-hero-info">
          <h1>${book.title}</h1>
          <div class="book-hero-author">by ${book.author}</div>
          ${book.tags.length ? `<div class="book-hero-tags">${book.tags.slice(0,4).map(t => `<span class="hashtag" style="font-size:0.55rem;padding:2px 8px">${t}</span>`).join('')}</div>` : ''}
          <div class="book-hero-stats">
            <div class="hero-stat"><span class="hero-stat-value">${fmt(book.views)}</span><span class="hero-stat-label">Views</span></div>
            <div class="hero-stat"><span class="hero-stat-value">${fmt(book.favorites)}</span><span class="hero-stat-label">Fav</span></div>
            <div class="hero-stat"><span class="hero-stat-value">${fmt(book.flames)}</span><span class="hero-stat-label">Flames</span></div>
          </div>
          <div class="book-hero-actions">
            <button class="btn btn-sm book-fav" data-book="${id}" style="background:${isFav?'rgba(255,255,255,0.15)':'var(--bg-hover)'}">${isFav?'Favorited':'Favorite'}</button>
            <div style="display:flex;gap:4px;align-items:center">
              <input class="flame-input" id="flame-input" placeholder="Amount" value="10">
              <button class="btn btn-flame book-flame" data-book="${id}" style="padding:5px 10px">Give</button>
            </div>
          </div>
          ${book.synopsis ? `<p style="font-size:0.7rem;color:var(--text2);line-height:1.5">${book.synopsis}</p>` : ''}
        </div>
      </div>
      <div class="book-tabs">${tabs.map(t => `<span class="tab${bookTab===t?' active':''}" data-book-tab="${t}">${t}</span>`).join('')}</div>
      <div class="book-tab-content">
        ${bookTab==='Info' ? `
          <div style="font-size:0.7rem">
            ${[['Genre',book.genre||'None'],['Status',book.status],['Chapters',book.chapterCount],['Type',book.type]].map(([l,v]) => `
              <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--line2)"><span style="color:var(--text2)">${l}</span><span>${v}</span></div>`).join('')}
          </div>
        ` : bookTab==='Chapters' ? `
          <h3 style="font-size:0.85rem;font-weight:600;margin-bottom:8px">Chapters (${chapters.length})</h3>
          ${chapters.length ? chapters.map(ch => `
            <div class="chapter-item"><span class="chapter-num">Ch. ${ch.chapterNumber}</span><span class="chapter-title">${ch.title || 'Untitled'}</span><span class="chapter-date">${ch.createdAt}</span></div>
          `).join('') : '<p style="font-size:0.72rem;color:var(--text3);padding:16px 0;text-align:center">No published chapters yet</p>'}
        ` : bookTab==='Characters' ? `
          <h3 style="font-size:0.85rem;font-weight:600;margin-bottom:8px">Characters (${chars.length})</h3>
          ${chars.length ? chars.map(c => `
            <div class="char-item">
              <div class="char-avatar">${c.name[0]}</div>
              <div><h4 style="font-size:0.75rem;font-weight:600">${c.name}</h4><span style="font-size:0.6rem;color:var(--text2)">${c.role}</span><p style="font-size:0.65rem;color:var(--text3);margin-top:2px">${c.description}</p></div>
            </div>
          `).join('') : '<p style="font-size:0.72rem;color:var(--text3);padding:16px 0;text-align:center">No characters yet</p>'}
        ` : ''}
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
    charForm.addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(charForm);
      const bookId = charForm.dataset.book;
      const data = { name: fd.get('name'), role: fd.get('role'), description: fd.get('description') };
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
      alert('Saved');
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

  // ---- Book favorite ----
  document.querySelectorAll('.book-fav').forEach(el => {
    el.addEventListener('click', () => { toggleFavorite(el.dataset.book); render(); });
  });

  // ---- Book flames ----
  document.querySelectorAll('.book-flame').forEach(el => {
    el.addEventListener('click', () => {
      const input = document.getElementById('flame-input');
      const amount = parseInt(input?.value) || 10;
      giveFlames(el.dataset.book, amount);
      state.supporterHistory.push({ user: state.user.username, amount, date: new Date().toISOString() });
      saveState();
      render();
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

  // ---- Profile: Banner Upload ----
  const bannerInput = document.getElementById('banner-input');
  if (bannerInput) {
    bannerInput.addEventListener('change', function() {
      const file = this.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = e => { state.user.banner = e.target.result; saveState(); render(); };
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
      reader.onload = e => { state.user.avatar = e.target.result; saveState(); render(); };
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
      navigate('#/profile');
    });
  }
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
