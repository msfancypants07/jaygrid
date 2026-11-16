# JayGrid account setup

JayGrid now supports Google sign-in and saves Spring 2027 plans in Supabase. Until you connect a project, the existing local planner continues to work.

The Vercel site is live at `https://jaygrid.vercel.app/`. Its course search is public, while account sync remains off until you connect Supabase. The current plan stays in each browser.

## Connect Supabase

1. Create a Supabase project.
2. Open its SQL Editor and run the contents of `supabase/jaygrid.sql`.
3. In **Authentication → Providers → Google**, enable Google. Supabase shows a callback URL for Google; add that exact URL as an authorized redirect URI in the Google Cloud OAuth client, then put the Google client ID and secret in Supabase. Keep the Google secret in Supabase, not in JayGrid files.
4. In **Authentication → URL Configuration**, add `http://127.0.0.1:4177/auth/callback` to Redirect URLs for local testing.
   Also add `https://jaygrid.vercel.app/auth/callback` for the live site.
5. Copy `local/.env.example` to `local/.env`. Fill in your Supabase Project URL and **publishable** key from Supabase's API settings. Do not put a service-role key or Google client secret in `.env`.
6. Open `local/start.command`, then visit `http://127.0.0.1:4177/` and click **Sign in with Google**.

On first sign-in, JayGrid loads the cloud plan. If this browser already has a local plan, click **Add plan from this device** to copy its sections into your account. The local copy stays in the browser as a backup.

## Turn on sign-in on Vercel

The Vercel project `jaygrid` already has `PUBLIC_ORIGIN=https://jaygrid.vercel.app` and a private `SESSION_SECRET`. After creating your Supabase project and running `jaygrid.sql`, add its Project URL as `SUPABASE_URL` and its **publishable** key as `SUPABASE_PUBLISHABLE_KEY` in Vercel's **Project Settings → Environment Variables**, for **Production**. Redeploy the project to apply them. Do not add the service-role key or Google client secret to Vercel; the Google secret belongs only in Supabase's Google provider settings.

The live site uses an encrypted, HTTP-only cookie for its sign-in session. No schedule data is stored in that cookie. The local launcher uses a local session database instead.

## Access from another device

Open `https://jaygrid.vercel.app/` on the other device. Once Supabase and Google sign-in are connected, signing into the same account will load the cloud plan there. Before that setup, each browser has a separate local plan.

If you made a plan at `http://127.0.0.1:4177/`, it will not automatically appear at the Vercel address because they have different browser storage. Export a JSON backup from the local site and restore it at the Vercel address, then use **Add plan from this device** after signing in.

For a production launch, configure backup of the Supabase database. The free Supabase plan does not include automatic database backups.
