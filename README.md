# JayGrid

An unofficial Johns Hopkins course planner for Spring 2027. Search JHU's public course listings, add sections to a weekly schedule, spot time conflicts, and export a calendar or JSON backup.

Live site: [jaygrid.vercel.app](https://jaygrid.vercel.app/)

## Current data behavior

The live site is public. Until a Supabase project is connected, plans are saved only in each browser. Google sign-in and account sync are implemented but disabled until the Supabase settings are supplied. Registration still happens in SIS.

## Run locally

Requires Node.js 24 or newer.

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4177/`. The local server uses `local/data/sessions.sqlite` for sign-in sessions once Supabase is configured; this file is ignored by Git.

## Connect Supabase

See [local/SETUP.md](local/SETUP.md) and run [supabase/jaygrid.sql](supabase/jaygrid.sql) in the Supabase SQL Editor. The live Vercel project already has `PUBLIC_ORIGIN` and a private `SESSION_SECRET`; it still needs `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`. Configure Google's OAuth client in Supabase, then redeploy JayGrid. Never commit a service-role key or Google client secret.

## Deployments

The current Vercel deployment was made from the CLI. Pushing this repository does not automatically deploy until it is connected to the Vercel project. To deploy manually from a linked checkout, run `vercel deploy --prod`.

The app has no JHU affiliation or registration capability. Verify meeting dates, availability, and enrollment in the official [JHU course search](https://courses.jhu.edu/).
