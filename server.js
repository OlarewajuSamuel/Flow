require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const TwitterStrategy = require('passport-twitter').Strategy;
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

// --- User storage (simple JSON file) ---
const DATA_FILE = path.join(__dirname, 'data', 'users.json');
function loadUsers() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) { /* ignore */ }
  return {};
}
function saveUsers(users) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
}

// --- Passport serialization ---
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const users = loadUsers();
  const user = Object.values(users).find(u => u.id === id);
  done(null, user || null);
});

// --- Passport Google Strategy ---
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID || 'placeholder',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'placeholder',
  callbackURL: `${APP_URL}/api/auth/google/callback`
}, (accessToken, refreshToken, profile, done) => {
  const users = loadUsers();
  let user = Object.values(users).find(u => u.googleId === profile.id);
  if (!user) {
    const id = 'user_' + Date.now();
    user = {
      id, googleId: profile.id, facebookId: null, twitterId: null,
      username: profile.displayName || `User_${profile.id.slice(-6)}`,
      email: profile.emails?.[0]?.value || '',
      bio: 'Hello! I write stories.', level: 1, rank: 0, followers: 0
    };
    users[user.email || id] = user;
    saveUsers(users);
  }
  return done(null, user);
}));

// --- Passport Facebook Strategy ---
passport.use(new FacebookStrategy({
  clientID: process.env.FACEBOOK_APP_ID || 'placeholder',
  clientSecret: process.env.FACEBOOK_APP_SECRET || 'placeholder',
  callbackURL: `${APP_URL}/api/auth/facebook/callback`,
  profileFields: ['id', 'displayName', 'emails']
}, (accessToken, refreshToken, profile, done) => {
  const users = loadUsers();
  let user = Object.values(users).find(u => u.facebookId === profile.id);
  if (!user) {
    const id = 'user_' + Date.now();
    user = {
      id, googleId: null, facebookId: profile.id, twitterId: null,
      username: profile.displayName || `User_${profile.id.slice(-6)}`,
      email: profile.emails?.[0]?.value || '',
      bio: 'Hello! I write stories.', level: 1, rank: 0, followers: 0
    };
    users[user.email || id] = user;
    saveUsers(users);
  }
  return done(null, user);
}));

// --- Passport Twitter Strategy ---
passport.use(new TwitterStrategy({
  consumerKey: process.env.TWITTER_CONSUMER_KEY || 'placeholder',
  consumerSecret: process.env.TWITTER_CONSUMER_SECRET || 'placeholder',
  callbackURL: `${APP_URL}/api/auth/twitter/callback`,
  includeEmail: true
}, (accessToken, accessTokenSecret, profile, done) => {
  const users = loadUsers();
  let user = Object.values(users).find(u => u.twitterId === profile.id);
  if (!user) {
    const id = 'user_' + Date.now();
    user = {
      id, googleId: null, facebookId: null, twitterId: profile.id,
      username: profile.displayName || `User_${profile.id.slice(-6)}`,
      email: profile.emails?.[0]?.value || '',
      bio: 'Hello! I write stories.', level: 1, rank: 0, followers: 0
    };
    users[user.email || id] = user;
    saveUsers(users);
  }
  return done(null, user);
}));

// --- Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(passport.initialize());
app.use(passport.session());

// --- CORS for local dev ---
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', APP_URL);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// --- API Routes ---

// Check current session
app.get('/api/auth/me', (req, res) => {
  if (req.isAuthenticated()) {
    const { id, username, email, bio, level, rank, followers } = req.user;
    res.json({ loggedIn: true, user: { id, username, email, bio, level, rank, followers } });
  } else {
    res.json({ loggedIn: false });
  }
});

// Email/password signup
app.post('/api/auth/signup', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'All fields required' });
  const users = loadUsers();
  if (users[email]) return res.status(409).json({ error: 'Email already registered' });
  const id = 'user_' + Date.now();
  users[email] = { id, email, password, username, bio: 'Hello! I write stories.', level: 1, rank: 0, followers: 0, googleId: null, facebookId: null, twitterId: null };
  saveUsers(users);
  req.login(users[email], err => {
    if (err) return res.status(500).json({ error: 'Login failed' });
    res.json({ loggedIn: true, user: { id, username, email, bio: users[email].bio, level: 1, rank: 0, followers: 0 } });
  });
});

// Email/password signin
app.post('/api/auth/signin', (req, res) => {
  const { email, password } = req.body;
  const users = loadUsers();
  const user = users[email];
  if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid email or password' });
  req.login(user, err => {
    if (err) return res.status(500).json({ error: 'Login failed' });
    const { id, username, bio, level, rank, followers } = user;
    res.json({ loggedIn: true, user: { id, username, email, bio, level, rank, followers } });
  });
});

// Sign out
app.post('/api/auth/signout', (req, res) => {
  req.logout(err => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.json({ loggedIn: false });
  });
});

// --- OAuth Routes ---

// Google
app.get('/api/auth/google', passport.authenticate('google', { scope: ['profile', 'email'], session: true }));
app.get('/api/auth/google/callback', passport.authenticate('google', { failureRedirect: '/#/signin' }), (req, res) => {
  res.redirect('/#/');
});

// Facebook
app.get('/api/auth/facebook', passport.authenticate('facebook', { scope: ['email'], session: true }));
app.get('/api/auth/facebook/callback', passport.authenticate('facebook', { failureRedirect: '/#/signin' }), (req, res) => {
  res.redirect('/#/');
});

// Twitter / X
app.get('/api/auth/twitter', passport.authenticate('twitter', { session: true }));
app.get('/api/auth/twitter/callback', passport.authenticate('twitter', { failureRedirect: '/#/signin' }), (req, res) => {
  res.redirect('/#/');
});

// --- Serve static files ---
app.use(express.static(__dirname));

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`Flow World server running at ${APP_URL}`);
  console.log(`OAuth callback URL: ${APP_URL}/api/auth/google/callback`);
});
