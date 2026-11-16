# JayGrid account setup

JayGrid has Google sign-in and Supabase schedule syncing. The live project is configured; these steps are for local use or a new Supabase project.

The Vercel site is live at `https://jaygrid.vercel.app/`. Guests' schedules stay in each browser; signed-in schedules sync to the account.

## Connect Supabase

1. Open the [JayGrid Supabase project](https://supabase.com/dashboard/project/kmczemtqccilgwjhocks). The project already exists.
2. Open **SQL Editor** and run the contents of `supabase/jaygrid.sql`. This creates `public.jaygrid_plans` with row level security so each account can access its own plans.
3. In **Authentication → Sign In / Providers → Google**, enable Google. Create a **Web application** OAuth client in Google Auth Platform. Add `https://jaygrid.vercel.app` as an authorized JavaScript origin, and add the exact Supabase callback URL shown on the Google provider page as an authorized redirect URI. Put the Google client ID and secret in Supabase. Keep the Google secret in Supabase, not in JayGrid files.
4. In **Authentication → URL Configuration**, set the Site URL to `https://jaygrid.vercel.app` and add `https://jaygrid.vercel.app/auth/callback` to Redirect URLs. Add `http://127.0.0.1:4177/auth/callback` too if you want to test locally.
5. Copy `local/.env.example` to `local/.env`. Fill in your Supabase Project URL and **publishable** key from Supabase's API settings. Do not put a service-role key or Google client secret in `.env`.
6. Open `local/start.command`, then visit `http://127.0.0.1:4177/` and click **Sign in with Google**.

On first sign-in, JayGrid loads cloud schedules for the selected semester and the global watchlist. Existing Spring 2027 plans become **Schedule 1**. To copy a guest schedule into the account, choose its semester and click **Add schedule from this device**. In Watchlist, use **Import from this device** to copy guest courses and notes into the account. The local copies stay in the browser as backups.

## Turn on sign-in on Vercel

The Vercel project `jaygrid` already has `PUBLIC_ORIGIN`, `SESSION_SECRET`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` in Production settings. Deploy from the linked checkout to apply code changes. Do not add the service-role key or Google client secret to Vercel; the Google secret belongs only in Supabase's Google provider settings.

The live site uses an encrypted, HTTP-only cookie for its sign-in session. No schedule data is stored in that cookie. The local launcher uses a local session database instead.

## Access from another device

Open `https://jaygrid.vercel.app/` on the other device. Sign into the same Google account, select a semester, then choose the schedule version you want. Guest schedules remain local to each browser.

If you made a schedule at `http://127.0.0.1:4177/`, it will not automatically appear at the Vercel address because they have different browser storage. Export a JSON backup from the local site. At the Vercel site, sign in, select the same semester, create a new schedule, and restore that backup.

For a production launch, configure backup of the Supabase database. The free Supabase plan does not include automatic database backups.
