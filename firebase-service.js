// ── Firebase Namespace ──────────────────────────────
window.FB = {};

(function(ns) {
  let auth, db, storage;
  let _initialized = false;

  ns.initFirebase = function() {
    if (_initialized) return;
    if (typeof firebase === 'undefined') {
      console.warn('Firebase SDK not loaded. Using localStorage fallback.');
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      auth = firebase.auth();
      db = firebase.firestore();
      storage = firebase.storage();
      _initialized = true;
      db.enablePersistence().catch(() => {});
    } catch (e) {
      console.warn('Firebase init failed:', e);
    }
  };

  ns.isFirebaseReady = function() { return _initialized; };

  // ── Helpers ─────────────────────────────────────────
  const _today = () => new Date().toISOString().split('T')[0];
  const _uid = () => db.collection('_').doc().id;
  const _expForLevel = lvl => lvl * 100;
  const _dailyFlameAllowance = lvl => lvl >= 21 ? 5 : lvl >= 11 ? 4 : lvl >= 5 ? 3 : 2;

  // ── Auth ────────────────────────────────────────────
  ns.onAuthChanged = function(callback) {
    ns.initFirebase();
    if (!auth) return;
    auth.onAuthStateChanged(callback);
  };

  ns.signUpWithEmail = async function(email, password, username) {
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: username });
    await db.collection(COLLECTIONS.USERS).doc(cred.user.uid).set({
      uid: cred.user.uid, email, username, bio: '', avatar: '', banner: '',
      level: 1, exp: 0, lifetimeExp: 0, dailyFlamesRemaining: 2,
      lastFlameReset: _today(), followers: 0, theme: 'dark',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return cred.user;
  };

  ns.signInWithEmail = async function(email, password) {
    const cred = await auth.signInWithEmailAndPassword(email, password);
    return cred.user;
  };

  ns.signOut = async function() {
    await auth.signOut();
  };

  // ── User ────────────────────────────────────────────
  ns.getUser = async function(uid) {
    const doc = await db.collection(COLLECTIONS.USERS).doc(uid).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  };

  // ── Daily Reset ─────────────────────────────────────
  ns.checkDailyReset = async function(userId) {
    const user = await ns.getUser(userId);
    if (!user) return;
    if (user.lastFlameReset !== _today()) {
      const allowance = _dailyFlameAllowance(user.level);
      await db.collection(COLLECTIONS.USERS).doc(userId).update({
        dailyFlamesRemaining: allowance, lastFlameReset: _today()
      });
      return allowance;
    }
    return user.dailyFlamesRemaining;
  };

  // ── EXP System ──────────────────────────────────────
  ns.awardExp = async function(userId, amount) {
    const ref = db.collection(COLLECTIONS.USERS).doc(userId);
    return await db.runTransaction(async t => {
      const userDoc = await t.get(ref);
      if (!userDoc.exists) return null;
      const user = userDoc.data();
      let exp = (user.exp || 0) + amount;
      let level = user.level || 1;
      let lifetime = (user.lifetimeExp || 0) + amount;
      let leveledUp = false;
      while (exp >= _expForLevel(level)) {
        exp -= _expForLevel(level);
        level++;
        leveledUp = true;
      }
      const update = { exp, level, lifetimeExp: lifetime };
      if (leveledUp) {
        update.dailyFlamesRemaining = _dailyFlameAllowance(level);
        update.lastFlameReset = _today();
      }
      t.update(ref, update);
      return { level, exp, needed: _expForLevel(level), leveledUp };
    });
  };

  // ── Daily Quest System ─────────────────────────────
  ns.completeDailyQuest = async function(userId, questType, expReward) {
    const date = _today();
    const ref = db.collection(COLLECTIONS.DAILY_QUESTS).doc(`${userId}_${questType}_${date}`);
    return await db.runTransaction(async t => {
      const doc = await t.get(ref);
      if (doc.exists) return { alreadyCompleted: true };
      t.set(ref, {
        userId, questType, date, expAwarded: expReward,
        completedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return null;
    }).then(async result => {
      if (result && result.alreadyCompleted) return result;
      return await ns.awardExp(userId, expReward);
    });
  };

  // ── Books ───────────────────────────────────────────
  ns.getBooks = async function(authorId) {
    let query = db.collection(COLLECTIONS.BOOKS);
    if (authorId) query = query.where('authorId', '==', authorId);
    else query = query.where('published', '==', true).where('visibility', '==', 'public');
    const snap = await query.orderBy('updatedAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };

  ns.getBook = async function(bookId) {
    const doc = await db.collection(COLLECTIONS.BOOKS).doc(bookId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  };

  ns.createBook = async function(data, authorId) {
    const id = _uid();
    const book = {
      authorId, title: data.title || 'Untitled', synopsis: data.synopsis || '',
      genre: data.genre || '', type: data.type || 'Novel',
      tags: data.tags || [], cover: data.cover || '',
      status: data.status || 'Draft', visibility: 'public',
      published: false, chapterCount: 0, views: 0, flames: 0, favorites: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection(COLLECTIONS.BOOKS).doc(id).set(book);
    return { id, ...book };
  };

  ns.updateBook = async function(bookId, data) {
    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection(COLLECTIONS.BOOKS).doc(bookId).update(data);
  };

  ns.deleteBook = async function(bookId) {
    const chapters = await db.collection(COLLECTIONS.CHAPTERS).where('bookId', '==', bookId).get();
    chapters.forEach(d => d.ref.delete());
    const chars = await db.collection(COLLECTIONS.CHARACTERS).where('bookId', '==', bookId).get();
    chars.forEach(d => d.ref.delete());
    const reviews = await db.collection(COLLECTIONS.REVIEWS).where('bookId', '==', bookId).get();
    reviews.forEach(d => d.ref.delete());
    await db.collection(COLLECTIONS.BOOKS).doc(bookId).delete();
  };

  ns.togglePublishBook = async function(bookId) {
    const book = await ns.getBook(bookId);
    if (!book) return;
    const published = !book.published;
    await ns.updateBook(bookId, { published });
    return published;
  };

  ns.recordView = async function(bookId, userId, chapterId) {
    if (userId) {
      const lockId = chapterId ? `user_${userId}_${chapterId}_${_today()}` : `user_${userId}_${bookId}_${_today()}`;
      const lockRef = db.collection(COLLECTIONS.DAILY_VIEWS).doc(lockId);
      const lockDoc = await lockRef.get();
      if (lockDoc.exists) return;
      await lockRef.set({ userId, bookId, chapterId: chapterId || '', date: _today(), count: 1 });
    }
    const date = _today();
    const ref = db.collection(COLLECTIONS.DAILY_VIEWS).doc(`${bookId}_${date}`);
    await db.runTransaction(async t => {
      const doc = await t.get(ref);
      if (doc.exists) t.update(ref, { count: firebase.firestore.FieldValue.increment(1) });
      else t.set(ref, { bookId, date, count: 1 });
    });
    await db.collection(COLLECTIONS.BOOKS).doc(bookId).update({
      views: firebase.firestore.FieldValue.increment(1)
    });
  };

  // ── Chapters ────────────────────────────────────────
  ns.getChapters = async function(bookId) {
    const snap = await db.collection(COLLECTIONS.CHAPTERS)
      .where('bookId', '==', bookId).orderBy('createdAt', 'asc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };

  ns.getChapter = async function(chapterId) {
    const doc = await db.collection(COLLECTIONS.CHAPTERS).doc(chapterId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  };

  ns.createChapter = async function(bookId, data) {
    const id = _uid();
    const wc = (data.content || '').length;
    const chapter = {
      bookId, title: data.title || 'Untitled', content: data.content || '',
      authorNotes: data.authorNotes || '', published: data.published || false,
      wordCount: wc, chapterNumber: data.chapterNumber || 1,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection(COLLECTIONS.CHAPTERS).doc(id).set(chapter);
    await db.collection(COLLECTIONS.CHAPTER_REVISIONS).doc(_uid()).set({
      chapterId: id, title: chapter.title, content: chapter.content,
      version: 1, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    await db.collection(COLLECTIONS.BOOKS).doc(bookId).update({
      chapterCount: firebase.firestore.FieldValue.increment(1),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { id, ...chapter };
  };

  ns.updateChapter = async function(chapterId, data) {
    if (data.content !== undefined) data.wordCount = data.content.length;
    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection(COLLECTIONS.CHAPTERS).doc(chapterId).update(data);
    const chapter = await ns.getChapter(chapterId);
    const maxRevSnap = await db.collection(COLLECTIONS.CHAPTER_REVISIONS)
      .where('chapterId', '==', chapterId).orderBy('version', 'desc').limit(1).get();
    const maxVer = maxRevSnap.empty ? 0 : maxRevSnap.docs[0].data().version;
    await db.collection(COLLECTIONS.CHAPTER_REVISIONS).doc(_uid()).set({
      chapterId, title: data.title || chapter.title, content: data.content || chapter.content,
      version: maxVer + 1, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  };

  ns.deleteChapter = async function(chapterId) {
    const ch = await ns.getChapter(chapterId);
    if (!ch) return;
    await db.collection(COLLECTIONS.CHAPTERS).doc(chapterId).delete();
    await db.collection(COLLECTIONS.BOOKS).doc(ch.bookId).update({
      chapterCount: firebase.firestore.FieldValue.increment(-1),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  };

  // ── Chapter Revisions ────────────────────────────────
  ns.getRevisions = async function(chapterId) {
    const snap = await db.collection(COLLECTIONS.CHAPTER_REVISIONS)
      .where('chapterId', '==', chapterId).orderBy('version', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };

  ns.getRevision = async function(revId) {
    const doc = await db.collection(COLLECTIONS.CHAPTER_REVISIONS).doc(revId).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  };

  ns.restoreRevision = async function(chapterId, revId) {
    const rev = await ns.getRevision(revId);
    if (!rev) return;
    await db.collection(COLLECTIONS.CHAPTERS).doc(chapterId).update({
      title: rev.title, content: rev.content,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const maxRevSnap = await db.collection(COLLECTIONS.CHAPTER_REVISIONS)
      .where('chapterId', '==', chapterId).orderBy('version', 'desc').limit(1).get();
    const maxVer = maxRevSnap.empty ? 0 : maxRevSnap.docs[0].data().version;
    await db.collection(COLLECTIONS.CHAPTER_REVISIONS).doc(_uid()).set({
      chapterId, title: rev.title, content: rev.content,
      version: maxVer + 1, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return await ns.getChapter(chapterId);
  };

  // ── Characters ─────────────────────────────────────
  ns.getCharacters = async function(bookId) {
    const snap = await db.collection(COLLECTIONS.CHARACTERS)
      .where('bookId', '==', bookId).orderBy('createdAt', 'asc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };

  ns.createCharacter = async function(bookId, data) {
    const id = _uid();
    await db.collection(COLLECTIONS.CHARACTERS).doc(id).set({
      bookId, name: data.name || '', biography: data.biography || '',
      appearance: data.appearance || '', relationships: data.relationships || [],
      abilities: data.abilities || [], portrait: data.portrait || '',
      gallery: data.gallery || [],
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { id, bookId, ...data };
  };

  ns.updateCharacter = async function(charId, data) {
    data.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    await db.collection(COLLECTIONS.CHARACTERS).doc(charId).update(data);
  };

  ns.deleteCharacter = async function(charId) {
    await db.collection(COLLECTIONS.CHARACTERS).doc(charId).delete();
  };

  // ── Reviews ─────────────────────────────────────────
  ns.getReviews = async function(bookId) {
    const snap = await db.collection(COLLECTIONS.REVIEWS)
      .where('bookId', '==', bookId).orderBy('pinned', 'desc').orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };

  ns.createReview = async function(bookId, userId, data) {
    const id = _uid();
    const user = await ns.getUser(userId);
    await db.collection(COLLECTIONS.REVIEWS).doc(id).set({
      bookId, userId, username: user.username, rating: data.rating || 5,
      content: data.content || '', likes: 0, pinned: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    ns.completeDailyQuest(userId, 'review', 20).catch(() => {});
    ns.getBook(bookId).then(book => {
      if (book && book.authorId !== userId) ns.createNotification(book.authorId, 'review', `${user.username} reviewed your book`).catch(() => {});
    }).catch(() => {});
    return { id, bookId, userId, username: user.username, ...data, likes: 0, pinned: false };
  };

  ns.deleteReview = async function(reviewId) {
    await db.collection(COLLECTIONS.REVIEWS).doc(reviewId).delete();
  };

  ns.togglePinReview = async function(reviewId, bookId) {
    const pinned = await db.collection(COLLECTIONS.REVIEWS)
      .where('bookId', '==', bookId).where('pinned', '==', true).get();
    pinned.forEach(d => d.ref.update({ pinned: false }));
    const rev = await db.collection(COLLECTIONS.REVIEWS).doc(reviewId).get();
    if (rev.exists) await rev.ref.update({ pinned: !rev.data().pinned });
  };

  ns.likeReview = async function(reviewId, userId) {
    const ref = db.collection(COLLECTIONS.REVIEWS).doc(reviewId);
    const likeRef = db.collection(COLLECTIONS.REVIEWS).doc(reviewId).collection('likes').doc(userId);
    return await db.runTransaction(async t => {
      const likeDoc = await t.get(likeRef);
      if (likeDoc.exists) {
        t.delete(likeRef);
        t.update(ref, { likes: firebase.firestore.FieldValue.increment(-1) });
        return { liked: false };
      } else {
        t.set(likeRef, { userId, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        t.update(ref, { likes: firebase.firestore.FieldValue.increment(1) });
        return { liked: true };
      }
    });
  };

  // ── Chapter Comments ───────────────────────────────
  ns.getChapterComments = async function(chapterId) {
    const snap = await db.collection(COLLECTIONS.COMMENTS)
      .where('chapterId', '==', chapterId).orderBy('createdAt', 'asc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };

  ns.createComment = async function(chapterId, userId, content) {
    const id = _uid();
    const user = await ns.getUser(userId);
    await db.collection(COLLECTIONS.COMMENTS).doc(id).set({
      chapterId, userId, username: user.username, content,
      likes: 0, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const expPromise = ns.completeDailyQuest(userId, 'comment', 10);
    ns.getChapter(chapterId).then(ch => {
      if (ch) ns.getBook(ch.bookId).then(book => {
        if (book && book.authorId !== userId) ns.createNotification(book.authorId, 'comment', `${user.username} commented on your chapter`).catch(() => {});
      }).catch(() => {});
    }).catch(() => {});
    return { id, chapterId, userId, username: user.username, content, likes: 0, expResult: expPromise };
  };

  ns.deleteComment = async function(commentId) {
    await db.collection(COLLECTIONS.COMMENTS).doc(commentId).delete();
  };

  // ── Flames ─────────────────────────────────────────
  ns.getFlamesRemaining = async function(userId) {
    const user = await ns.getUser(userId);
    if (!user) return { remaining: 0, allowance: 2, level: 1 };
    return { remaining: user.dailyFlamesRemaining, allowance: _dailyFlameAllowance(user.level), level: user.level };
  };

  ns.getBookFlames = async function(bookId) {
    const doc = await db.collection(COLLECTIONS.BOOK_FLAMES).doc(bookId).get();
    return doc.exists ? doc.data().total || 0 : 0;
  };

  ns.giveFlame = async function(bookId, userId) {
    const book = await ns.getBook(bookId);
    if (!book) return { error: 'Book not found' };
    if (book.authorId === userId) return { error: 'Cannot flame your own book' };

    const userRef = db.collection(COLLECTIONS.USERS).doc(userId);
    const bfRef = db.collection(COLLECTIONS.BOOK_FLAMES).doc(bookId);

    const result = await db.runTransaction(async t => {
      const userDoc = await t.get(userRef);
      if (!userDoc.exists) return { error: 'No flames remaining' };
      const remaining = userDoc.data().dailyFlamesRemaining || 0;
      if (remaining <= 0) return { error: 'No flames remaining' };

      t.update(userRef, { dailyFlamesRemaining: remaining - 1 });

      const bf = await t.get(bfRef);
      if (bf.exists) t.update(bfRef, { total: firebase.firestore.FieldValue.increment(1) });
      else t.set(bfRef, { bookId, total: 1 });

      return { remaining: remaining - 1 };
    });

    if (result.error) return result;

    ns.createNotification(book.authorId, 'flame', 'Someone gave flames to your book').catch(() => {});
    const expResult = await ns.awardExp(userId, 10);
    const bookFlames = await ns.getBookFlames(bookId);
    return { remaining: result.remaining, bookFlames, given: 1, expGained: 10, expResult };
  };

  ns.giveSingleFlame = async function(chapterId, userId) {
    const ch = await ns.getChapter(chapterId);
    if (!ch) return { error: 'Chapter not found' };
    return await ns.giveFlame(ch.bookId, userId);
  };

  // ── Reading Progress ───────────────────────────────
  ns.updateReadingProgress = async function(userId, bookId, data) {
    await db.collection(COLLECTIONS.READING_PROGRESS).doc(`${userId}_${bookId}`).set({
      userId, bookId, chapterId: data.chapterId || '',
      paragraphIndex: data.paragraphIndex || 0,
      completionPct: data.completionPct || 0,
      lastReadAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  };

  ns.getReadingProgress = async function(userId, bookId) {
    const doc = await db.collection(COLLECTIONS.READING_PROGRESS).doc(`${userId}_${bookId}`).get();
    return doc.exists ? doc.data() : null;
  };

  ns.getAllReadingProgress = async function(userId) {
    const snap = await db.collection(COLLECTIONS.READING_PROGRESS)
      .where('userId', '==', userId).orderBy('lastReadAt', 'desc').get();
    return snap.docs.map(d => d.data());
  };

  // ── Notifications ──────────────────────────────────
  ns.getNotifications = async function(userId) {
    const snap = await db.collection(COLLECTIONS.NOTIFICATIONS)
      .where('userId', '==', userId).orderBy('createdAt', 'desc').limit(50).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };

  ns.markNotificationRead = async function(notifId) {
    await db.collection(COLLECTIONS.NOTIFICATIONS).doc(notifId).update({ read: true });
  };

  ns.markAllNotificationsRead = async function(userId) {
    const unread = await db.collection(COLLECTIONS.NOTIFICATIONS)
      .where('userId', '==', userId).where('read', '==', false).get();
    unread.forEach(d => d.ref.update({ read: true }));
  };

  ns.createNotification = async function(userId, type, message) {
    await db.collection(COLLECTIONS.NOTIFICATIONS).doc(_uid()).set({
      userId, type, message, read: false,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  };

  // ── Follows ────────────────────────────────────────
  ns.toggleFollow = async function(followerId, followingId) {
    if (followerId === followingId) return { error: 'Cannot follow yourself' };
    const ref = db.collection(COLLECTIONS.FOLLOWERS).doc(`${followerId}_${followingId}`);
    const userRef = db.collection(COLLECTIONS.USERS).doc(followingId);
    return await db.runTransaction(async t => {
      const doc = await t.get(ref);
      if (doc.exists) {
        t.delete(ref);
        t.update(userRef, { followers: firebase.firestore.FieldValue.increment(-1) });
        return { following: false };
      } else {
        t.set(ref, { followerId, followingId, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        t.update(userRef, { followers: firebase.firestore.FieldValue.increment(1) });
        ns.createNotification(followingId, 'follow', 'Someone started following you').catch(() => {});
        return { following: true };
      }
    });
  };

  ns.checkFollow = async function(followerId, followingId) {
    const doc = await db.collection(COLLECTIONS.FOLLOWERS).doc(`${followerId}_${followingId}`).get();
    return doc.exists;
  };

  // ── Favorites / Bookmarks ──────────────────────────
  ns.toggleFavorite = async function(userId, bookId) {
    const ref = db.collection(COLLECTIONS.FAVORITES).doc(`${userId}_${bookId}`);
    const bookRef = db.collection(COLLECTIONS.BOOKS).doc(bookId);
    return await db.runTransaction(async t => {
      const doc = await t.get(ref);
      if (doc.exists) {
        t.delete(ref);
        t.update(bookRef, { favorites: firebase.firestore.FieldValue.increment(-1) });
        return { favorited: false };
      } else {
        t.set(ref, { userId, bookId, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        t.update(bookRef, { favorites: firebase.firestore.FieldValue.increment(1) });
        return { favorited: true };
      }
    });
  };

  ns.getUserFavorites = async function(userId) {
    const favs = await db.collection(COLLECTIONS.FAVORITES).where('userId', '==', userId).get();
    const bookIds = favs.docs.map(d => d.data().bookId);
    if (!bookIds.length) return [];
    const books = [];
    for (const bid of bookIds) {
      const b = await ns.getBook(bid);
      if (b) books.push(b);
    }
    return books;
  };

  // ── Wall Posts ─────────────────────────────────────
  ns.createWallPost = async function(authorId, userId, content) {
    const user = await ns.getUser(authorId);
    const id = _uid();
    await db.collection(COLLECTIONS.WALL_POSTS).doc(id).set({
      authorId, userId, content, username: user.username,
      likes: 0, createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    return { id, authorId, userId, content, username: user.username, likes: 0 };
  };

  ns.getWallPosts = async function(userId) {
    const snap = await db.collection(COLLECTIONS.WALL_POSTS)
      .where('userId', '==', userId).orderBy('createdAt', 'desc').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };

  ns.deleteWallPost = async function(postId) {
    await db.collection(COLLECTIONS.WALL_POSTS).doc(postId).delete();
  };

  // ── User Profile ───────────────────────────────────
  ns.updateProfile = async function(userId, data) {
    const update = {};
    if (data.username !== undefined) update.username = data.username;
    if (data.bio !== undefined) update.bio = data.bio;
    if (data.avatar !== undefined) update.avatar = data.avatar;
    if (data.banner !== undefined) update.banner = data.banner;
    await db.collection(COLLECTIONS.USERS).doc(userId).update(update);
  };

  ns.updateSettings = async function(userId, data) {
    if (data.theme !== undefined) {
      await db.collection(COLLECTIONS.USERS).doc(userId).update({ theme: data.theme });
    }
  };

  // ── Storage ────────────────────────────────────────
  ns.uploadImage = async function(file, path) {
    const ref = storage.ref().child(path);
    const snapshot = await ref.put(file);
    return await snapshot.ref.getDownloadURL();
  };

  ns.deleteImage = async function(url) {
    try { await storage.refFromURL(url).delete(); } catch (e) { /* ignore */ }
  };

  // ── Analytics ──────────────────────────────────────
  ns.getBookAnalytics = async function(bookId) {
    const book = await ns.getBook(bookId);
    if (!book) return null;
    const date = _today();
    const weekAgo = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
    const monthAgo = new Date(Date.now() - 30*86400000).toISOString().split('T')[0];

    const todayViews = await db.collection(COLLECTIONS.DAILY_VIEWS)
      .where('bookId', '==', bookId).where('date', '==', date).get();
    const weekViews = await db.collection(COLLECTIONS.DAILY_VIEWS)
      .where('bookId', '==', bookId).where('date', '>=', weekAgo).get();
    const monthViews = await db.collection(COLLECTIONS.DAILY_VIEWS)
      .where('bookId', '==', bookId).where('date', '>=', monthAgo).get();
    const allViews = await db.collection(COLLECTIONS.DAILY_VIEWS)
      .where('bookId', '==', bookId).get();

    return {
      views: {
        today: todayViews.docs.reduce((s, d) => s + d.data().count, 0),
        week: weekViews.docs.reduce((s, d) => s + d.data().count, 0),
        month: monthViews.docs.reduce((s, d) => s + d.data().count, 0),
        all: allViews.docs.reduce((s, d) => s + d.data().count, 0),
      },
      flames: await ns.getBookFlames(bookId),
      chapters: { total: book.chapterCount || 0, published: 0 }
    };
  };

  // ── Achievements ──────────────────────────────────
  const ACHIEVEMENT_DEFS = {
    // Author achievements
    first_book:          { id: 'first_book',        icon: 'Icons/book.png',                      label: 'First Book',          type: 'author',  desc: 'Publish your first book' },
    three_books:         { id: 'three_books',       icon: 'Icons/books-stack-of-three.png',       label: '3 Books',             type: 'author',  desc: 'Create 3 books' },
    five_books:          { id: 'five_books',        icon: 'Icons/books-stack-of-three.png',       label: '5 Books',             type: 'author',  desc: 'Create 5 books' },
    hundred_views:       { id: 'hundred_views',     icon: 'Icons/view.png',                      label: '100 Views',           type: 'author',  desc: 'Get 100 total views' },
    onek_views:          { id: 'onek_views',        icon: 'Icons/view.png',                      label: '1K Views',            type: 'author',  desc: 'Get 1,000 total views' },
    hundredk_views:      { id: 'hundredk_views',    icon: 'Icons/view.png',                      label: '100K Views',          type: 'author',  desc: 'Get 100,000 total views' },
    first_flame:         { id: 'first_flame',       icon: 'Icons/fire.png',                      label: 'First Flame',         type: 'author',  desc: 'Receive your first flame' },
    hundred_flames:      { id: 'hundred_flames',    icon: 'Icons/fire-flame.png',                label: '100 Flames',          type: 'author',  desc: 'Receive 100 flames' },
    completed_work:      { id: 'completed_work',    icon: 'Icons/icons8-check-mark-50.png',      label: 'Completed Work',      type: 'author',  desc: 'Complete a book' },
    // Reader achievements
    first_comment:       { id: 'first_comment',     icon: 'Icons/editpen.png',                   label: 'First Comment',       type: 'reader',  desc: 'Write your first comment' },
    hundred_chapters:    { id: 'hundred_chapters',  icon: 'Icons/open-book.png',                 label: '100 Chapters Read',   type: 'reader',  desc: 'Read 100 chapters' },
    gave_first_flame:    { id: 'gave_first_flame',  icon: 'Icons/fire.png',                      label: 'First Flame Given',   type: 'reader',  desc: 'Give your first flame' },
    support_ten_authors: { id: 'support_ten_authors', icon: 'Icons/person-plus.png',             label: 'Support 10 Authors',  type: 'reader',  desc: 'Give flames to 10 different authors' },
    ten_reviews:         { id: 'ten_reviews',       icon: 'Icons/editpen.png',                   label: '10 Reviews Written',  type: 'reader',  desc: 'Write 10 reviews' },
    first_review:        { id: 'first_review',      icon: 'Icons/editpen.png',                   label: 'First Review',        type: 'reader',  desc: 'Write your first review' },
    // Milestone
    level_five:          { id: 'level_five',        icon: 'Icons/icons8-check-mark-50.png',      label: 'Level 5',             type: 'all',     desc: 'Reach level 5' },
    level_ten:           { id: 'level_ten',         icon: 'Icons/icons8-check-mark-50.png',      label: 'Level 10',            type: 'all',     desc: 'Reach level 10' },
  };

  ns.getAchievementDefs = function() { return ACHIEVEMENT_DEFS; };

  ns.getAchievements = async function(userId) {
    const snap = await db.collection(COLLECTIONS.ACHIEVEMENTS)
      .where('userId', '==', userId).get();
    const map = {};
    snap.docs.forEach(d => { map[d.data().achievementId] = d.data(); });
    return map;
  };

  ns.earnAchievement = async function(userId, achievementId) {
    const def = ACHIEVEMENT_DEFS[achievementId];
    if (!def) return null;
    const ref = db.collection(COLLECTIONS.ACHIEVEMENTS).doc(`${userId}_${achievementId}`);
    return await db.runTransaction(async t => {
      const doc = await t.get(ref);
      if (doc.exists) return { alreadyEarned: true };
      t.set(ref, {
        userId, achievementId, label: def.label, icon: def.icon,
        type: def.type, description: def.desc,
        earnedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      return { earned: true };
    }).then(async result => {
      if (result && result.alreadyEarned) return result;
      const notifType = def.type === 'author' ? 'achievement' : def.type === 'reader' ? 'achievement' : 'achievement';
      ns.createNotification(userId, notifType, `Achievement unlocked: ${def.label}`).catch(() => {});
      return { earned: true, label: def.label, icon: def.icon };
    });
  };

  ns.checkAndEarnAchievements = async function(userId, stats) {
    const earned = await ns.getAchievements(userId);
    const newOnes = [];
    for (const [id, def] of Object.entries(ACHIEVEMENT_DEFS)) {
      if (earned[id]) continue;
      let shouldEarn = false;
      switch (id) {
        case 'first_book':          shouldEarn = (stats.books || 0) >= 1; break;
        case 'three_books':         shouldEarn = (stats.books || 0) >= 3; break;
        case 'five_books':          shouldEarn = (stats.books || 0) >= 5; break;
        case 'hundred_views':       shouldEarn = (stats.views || 0) >= 100; break;
        case 'onek_views':          shouldEarn = (stats.views || 0) >= 1000; break;
        case 'hundredk_views':      shouldEarn = (stats.views || 0) >= 100000; break;
        case 'first_flame':         shouldEarn = (stats.flames || 0) >= 1; break;
        case 'hundred_flames':      shouldEarn = (stats.flames || 0) >= 100; break;
        case 'completed_work':      shouldEarn = (stats.completedBooks || 0) >= 1; break;
        case 'first_comment':       shouldEarn = (stats.comments || 0) >= 1; break;
        case 'hundred_chapters':    shouldEarn = (stats.chaptersRead || 0) >= 100; break;
        case 'gave_first_flame':    shouldEarn = (stats.flamesGiven || 0) >= 1; break;
        case 'support_ten_authors': shouldEarn = (stats.authorsSupported || 0) >= 10; break;
        case 'ten_reviews':         shouldEarn = (stats.reviews || 0) >= 10; break;
        case 'first_review':        shouldEarn = (stats.reviews || 0) >= 1; break;
        case 'level_five':          shouldEarn = (stats.level || 0) >= 5; break;
        case 'level_ten':           shouldEarn = (stats.level || 0) >= 10; break;
      }
      if (shouldEarn) {
        const r = await ns.earnAchievement(userId, id);
        if (r && r.earned) newOnes.push(def);
      }
    }
    return newOnes;
  };

  // ── Daily Reward ──────────────────────────────────
  ns.claimDailyReward = async function(userId) {
    const date = _today();
    const ref = db.collection(COLLECTIONS.DAILY_QUESTS).doc(`daily_reward_${userId}_${date}`);
    return await db.runTransaction(async t => {
      const doc = await t.get(ref);
      if (doc.exists) return { alreadyClaimed: true };
      t.set(ref, { userId, type: 'daily_reward', date, expAwarded: 20, completedAt: firebase.firestore.FieldValue.serverTimestamp() });
      return null;
    }).then(async result => {
      if (result && result.alreadyClaimed) return result;
      const expResult = await ns.awardExp(userId, 20);
      return { claimed: true, expGained: 20, expResult };
    });
  };
  ns.subscribeToCollection = function(collectionName, queryFn, callback) {
    let query = db.collection(collectionName);
    query = queryFn(query);
    return query.onSnapshot(snapshot => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      callback(data);
    });
  };

  ns.subscribeToDocument = function(collectionName, docId, callback) {
    return db.collection(collectionName).doc(docId).onSnapshot(doc => {
      if (doc.exists) callback({ id: doc.id, ...doc.data() });
      else callback(null);
    });
  };
})(window.FB);
