# Flow World

A novel reading & writing platform (write stories, publish chapters, read and comment, give "flames", follow authors, write reviews).

Flow World is:

- **Frontend** — a plain JavaScript SPA (no framework, no build step). Files: `app.js`, `styles.css`, `index.html`, `Icons/`.
- **Backend** — an Express API (`server.js`) exposing all routes under `/api/*`.
- **Database** — [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres) (Neon), accessed through the `pg` driver (`db.js`).
- **Authentication** — email/password plus Google, Facebook and Twitter sign-in via [Passport](http://www.passportjs.org/).
- **Image storage** — images (book covers, avatars, character portraits, and images you paste into chapter content) are stored as **data URLs directly in the database**. No external image service or file storage is required.

> **Important — this project is now Vercel-ready.** The previous version stored data in a local SQLite file (`better-sqlite3`) that cannot persist on Vercel's serverless runtime. It now uses a hosted Postgres database so all features work after deployment.

---

## How to Deploy Flowworld to Vercel

This is a step-by-step guide written for beginners. Follow the steps in order.

### Step 1 — Upload the project to GitHub

1. Create a free account at [github.com](https://github.com).
2. Click **New repository**, name it (e.g. `flow-world`), keep it **Private**, and click **Create repository**.
3. On your computer, open a terminal in the project folder and run:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/flow-world.git
   git push -u origin main
   ```

   > The project already includes a `.gitignore` that keeps `node_modules/`, `.env`, and the old SQLite `data/` folder out of GitHub — so no secrets or junk get uploaded.

### Step 2 — Create a Postgres database (required)

1. Open your [Vercel dashboard](https://vercel.com/dashboard).
2. Go to **Storage → Create Database → Postgres → Continue**.
3. Pick any region and click **Create**.
4. Vercel will ask: **“Connect to project?”** — create a new project (or choose Flow World once imported in Step 3).
5. When asked to add the environment variables to the project, **accept**. This sets `POSTGRES_URL` and friends automatically.

### Step 3 — Import the GitHub repository into Vercel

1. Go to your Vercel dashboard and click **Add New… → Project**.
2. Connect your GitHub account and select the `flow-world` repository you just pushed.
3. Vercel detects the project automatically. You do **not** need a framework preset.
4. Under **Environment Variables**, Vercel should already show the `POSTGRES_URL` from Step 2. Add the ones listed in Step 4 that you have gathered.
5. Click **Deploy**. The first deploy may take a minute.

### Step 4 — Add the required environment variables

In **Vercel → Project → Settings → Environment Variables**, add these (for both **Production**, **Preview**, and **Development** where possible):

| Variable | Required | What it is / where to get it |
|----------|----------|------------------------------|
| `POSTGRES_URL` | ✅ | Added automatically by Step 2. If you created the DB separately, this is your Postgres connection string. |
| `SESSION_SECRET` | ✅ | Any long random string. Generate one here: [randomkeygen.com](https://randomkeygen.com/) (use the 50-character option). |
| `APP_URL` | ✅ (after first deploy) | Your app's production URL, e.g. `https://your-app-name.vercel.app`. |
| `GOOGLE_CLIENT_ID` | ✅ (for Google login) | See **“Set up Google Sign-In”** below. |
| `GOOGLE_CLIENT_SECRET` | ✅ (for Google login) | See **“Set up Google Sign-In”** below. |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Optional | Facebook login. |
| `TWITTER_CONSUMER_KEY` / `TWITTER_CONSUMER_SECRET` | Optional | X/Twitter login. |

> A full reference copy with comments lives in the project as **`.env.example`**. You only need to put the *values* into Vercel — never commit real secrets to GitHub.

### Step 5 — Set up Google Sign-In (so the Google button works)

1. Go to the [Google Cloud Console](https://console.cloud.google.com/apis/credentials).
2. Create (or select) a project, then click **Create Credentials → OAuth client ID**.
3. Choose **Web application**.
4. Under **Authorized JavaScript origins** add:
   - `https://your-app-name.vercel.app`
   - `http://localhost:3000`
5. Under **Authorized redirect URIs** add:
   - `https://your-app-name.vercel.app/api/auth/google/callback`
   - `http://localhost:3000/api/auth/google/callback`
6. Click **Create**. Copy the **Client ID** and **Client Secret**.
7. In Vercel, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, then **redeploy** (Settings → Deployments → your latest build → ⋯ → Redeploy).

**After every redeploy**, confirm the `APP_URL` environment variable exactly matches the domain you added to Google. The app builds its Google callback URL from `APP_URL`, so a mismatch means “redirect_uri_mismatch” errors.

### Step 6 — Test Google Sign-In

1. Open your deployed site (`https://your-app-name.vercel.app`).
2. Click **Sign in → Google**.
3. You should be taken to Google, then returned logged in.
4. If it fails, see **Troubleshooting** below — the most common cause is the redirect URI or `APP_URL` not matching what you registered in Google.

### Step 7 — Verify the database and features work

- Visit `https://your-app-name.vercel.app/api/health` — it should return `{ "ok": true, "db": "ok" }`.
- Create an account, publish a book and a chapter, and confirm it appears on the public Library/Explore pages after signing out.
- Sign back in and confirm you can edit and publish — your data persists across page reloads and redeploys because it is stored in Postgres.

---

## Running Locally (development)

1. Install Node.js 18 or newer.
2. Create a local `.env` file — copy from `.env.example` (you can use your Vercel `POSTGRES_URL` string, or create a free local/remote Postgres) and fill in `POSTGRES_URL` and `SESSION_SECRET`.
3. Run:

   ```bash
   npm install
   npm run dev
   ```

4. Open `http://localhost:3000`.

For Google login locally, add `http://localhost:3000` to your Google app's Authorized origins and `http://localhost:3000/api/auth/google/callback` to its redirect URIs, and set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in your local `.env`.

---

## Troubleshooting Common Vercel Errors

### Build failures / “Error: Could not find module 'better-sqlite3'”
The old database used `better-sqlite3`, which cannot build or persist on Vercel. This project now uses `pg` (Postgres) instead. If you see this error, make sure you have merged the current code (the one with `pg` in `package.json`) and deleted the old `package-lock.json` + `node_modules` before redeploying. Run `npm install` locally and commit the updated `package-lock.json`.

### Missing environment variables (“Database is not configured”)
The server prints `Missing database connection string. Set POSTGRES_URL`. Fix: create the Postgres database (Step 2) and add `POSTGRES_URL` to your Vercel environment variables, then redeploy. Check **Settings → Environment Variables** that the value is present for the **Production** environment.

### Google Sign-In not working
Almost always one of these:
- **`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` not set** in Vercel → add them and redeploy. Until then the Google button returns a clear “not configured” JSON error instead of crashing the site.
- **`redirect_uri_mismatch`** → the redirect URI you typed in Google does not exactly match the app's callback URL. Confirm `APP_URL` in Vercel equals your site URL, and that `https://your-site.vercel.app/api/auth/google/callback` is in your Google app's **Authorized redirect URIs**.
- **`invalid_client` / `client is not authorized`** → the OAuth client secret is wrong, or the Google project's OAuth consent screen is not fully configured.

### Redirect URL errors (for Google/Facebook/Twitter)
Each provider must have your exact production URL registered. In Google it's **Authorized redirect URIs**; in Facebook it's **Valid OAuth Redirect URIs** (under your app's Facebook Login settings); in Twitter/X under app permissions. The app's callback paths are:
- Google: `/api/auth/google/callback`
- Facebook: `/api/auth/facebook/callback`
- Twitter: `/api/auth/twitter/callback`

### API errors / “Not found”
- If `/api/*` calls return `404`, the vercel function mapping may be off. Confirm `vercel.json` exists and routes `/(.*)` to `server.js`.
- If you get `503 { error: "Google sign-in is not configured..." }`, that is the safe failure mode — configure the provider.

### Database connection errors (“connection refused”, timeouts)
- Confirm `POSTGRES_URL` is set and points to a reachable database.
- Use the **pooled** `POSTGRES_URL` (Vercel Postgres automatically provides one). Connections use sensible timeouts tuned for serverless.
- Cold starts can take a moment; a slow first request is normal.

### Images not loading
Images are stored as base64 data inside the database, so:
- If the database is down/unreachable, images (and all other data) won't load — this is an app/database issue, not an image-hosting one.
- If images appear for one deploy but not another, the data wasn't persisted (old SQLite) or a deploy overwrote the DB. With Postgres, data is persistent.

### I see “Missing database connection string” warnings in logs but the site loads
The site loads and that's a warning only. It means `POSTGRES_URL` isn't set, so nothing is saved. Add the variable and redeploy.

### Sessions / users get logged out
Sessions are stored in Postgres and survive redeploys. Being logged out usually means:
- `SESSION_SECRET` changed between deploys → pick one value and keep it constant across all environments.
- Cookies are blocked (rare) → ensure cookies are allowed for your domain.

---

## Security notes

- Never commit `.env`, `.env.local`, or any real secrets. Keep them only in Vercel's Environment Variables.
- The `SESSION_SECRET`, OAuth secrets, and database password are all kept server-side. Nothing secret is embedded in the frontend code.
- For a production hardening step, consider hashing passwords with `bcrypt` instead of storing them as plaintext (the current local demo stores them as-is for simplicity). This is a recommended follow-up, not required to deploy.
