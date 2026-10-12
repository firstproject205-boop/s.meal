# s.meal – Setup Guide

## 1. Supabase Authentication Settings

Go to your Supabase dashboard → **Authentication → URL Configuration**:

| Setting | Value |
|---------|-------|
| **Site URL** | Your Vercel production URL (e.g. `https://s-meal.vercel.app`) |
| **Redirect URLs** | Add `http://localhost:5173` (for local dev) and your Vercel URL |

### Quick-testing shortcut

For quick local testing without email delivery:

1. Go to **Authentication → Providers → Email**.
2. Turn **off** "Confirm email".
3. Users can sign in immediately after sign up.

> **⚠️ Turn "Confirm email" back on before going to production.**

## 2. Local Development

```bash
# 1. Copy the env template and fill in your values
cp .env.example .env
# Edit .env with your Supabase URL and anon key:
#   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
#   VITE_SUPABASE_ANON_KEY=your-publishable-anon-key
#   SUPABASE_URL=https://YOUR-PROJECT.supabase.co
#   SUPABASE_ANON_KEY=your-publishable-anon-key

# 2. Admin site
cd admin
npm install
npm run dev          # → http://localhost:5173

# 3. Extension (separate terminal)
cd extension
npm install
npm run build        # builds dist/ — load as unpacked extension in Chrome
```

## 3. Vercel Deployment

Set these **Environment Variables** in Vercel (Settings → Environment Variables), for both **Preview** and **Production**:

| Variable | Value |
|----------|-------|
| `VITE_SUPABASE_URL` | `https://YOUR-PROJECT.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Your publishable anon key |

Vercel settings:

| Setting | Value |
|---------|-------|
| Root Directory | `admin` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Framework | Vite |

After setting the variables, trigger a redeploy.

## 4. Extension Build

The extension uses different env var names (plain `SUPABASE_URL` / `SUPABASE_ANON_KEY`) because esbuild injects them at build time. Set them in your shell:

```powershell
$env:SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
$env:SUPABASE_ANON_KEY="your-publishable-anon-key"
cd extension
npm run build
```

Then load `extension/dist/` as an unpacked extension in `chrome://extensions`.

## 5. Security Reminders

- **Never** use the `service_role` key in the extension or admin frontend.
- The extension build script will **refuse** to build if it detects a service-role key.
- Keep `.env` files out of Git (already in `.gitignore`).
- The database password is only needed for `supabase db push` (CI or local CLI).
