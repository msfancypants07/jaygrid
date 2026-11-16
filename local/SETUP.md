# JayGrid account setup

JayGrid has Google sign-in and Supabase plan syncing in its code. The live account feature is waiting for database and Google provider setup. The existing local planner continues to work.

The Vercel site is live at `https://jaygrid.vercel.app/`. Its course search is public, while account sync remains off until setup is complete. The current plan stays in each browser.

## Connect Supabase

1. Open the [JayGrid Supabase project](https://supabase.com/dashboard/project/kmczemtqccilgwjhocks). The project already exists.
2. Open **SQL Editor** and run the contents of `supabase/jaygrid.sql`. This creates `public.jaygrid_plans` with row level security so each account can access its own plans.
3. In **Authentication → Sign In / Providers → Google**, enable Google. Create a **Web application** OAuth client in Google Auth Platform. Add `https://jaygrid.vercel.app` as an authorized JavaScript origin, and add the exact Supabase callback URL shown on the Google provider page as an authorized redirect URI. Put the Google client ID and secret in Supabase. Keep the Google secret in Supabase, not in JayGrid files.
4. In **Authentication → URL Configuration**, set the Site URL to `https://jaygrid.vercel.app` and add `https://jaygrid.vercel.app/auth/callback` to Redirect URLs. Add `http://127.0.0.1:4177/auth/callback` too if you want to test locally.
5. Copy `local/.env.example` to `local/.env`. Fill in your Supabase Project URL and **publishable** key from Supabase's API settings. Do not put a service-role key or Google client secret in `.env`.
6. Open `local/start.command`, then visit `http://127.0.0.1:4177/` and click **Sign in with Google**.

On first sign-in, JayGrid loads the cloud plan. If this browser already has a local plan, click **Add plan from this device** to copy its sections into your account. The local copy stays in the browser as a backup.

## Turn on sign-in on Vercel

The Vercel project `jaygrid` already has `PUBLIC_ORIGIN`, `SESSION_SECRET`, `SUPABASE_URL`, and `SUPABASE_PUBLISHABLE_KEY` in Production settings. After the table, Google provider, and redirect URLs are configured in Supabase, redeploy the project to apply the Supabase settings. Do not add the service-role key or Google client secret to Vercel; the Google secret belongs only in Supabase's Google provider settings.

The live site uses an encrypted, HTTP-only cookie for its sign-in session. No schedule data is stored in that cookie. The local launcher uses a local session database instead.

## Access from another device

Open `https://jaygrid.vercel.app/` on the other device. Once Supabase and Google sign-in are connected, signing into the same account will load the cloud plan there. Before that setup, each browser has a separate local plan.

If you made a plan at `http://127.0.0.1:4177/`, it will not automatically appear at the Vercel address because they have different browser storage. Export a JSON backup from the local site and restore it at the Vercel address, then use **Add plan from this device** after signing in.

For a production launch, configure backup of the Supabase database. The free Supabase plan does not include automatic database backups.
