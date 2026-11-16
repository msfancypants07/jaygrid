# JayGrid

An unofficial Johns Hopkins course planner. Choose a semester, keep multiple named schedules for it, search JHU's public course listings, spot time conflicts, and export a calendar or JSON backup. The global watchlist saves courses from past terms with per-course notes and lets you check whether they are listed again.

Live site: [jaygrid.vercel.app](https://jaygrid.vercel.app/)

## Current data behavior

The live site is public. Guests' schedules and watchlist stay in their browser. Google sign-in saves both to the user's Supabase account. Existing Spring 2027 plans are loaded as **Schedule 1**. A watchlist status of “No listing found” only describes the selected term at the recorded check time; it does not predict whether a course will be offered later. Registration still happens in SIS.

## Run locally

Requires Node.js 24 or newer.

```sh
npm ci
npm run build
npm start
```

Open `http://127.0.0.1:4177/`. The local server uses `local/data/sessions.sqlite` for sign-in sessions once Supabase is configured; this file is ignored by Git.

## Connect Supabase

The live Supabase and Vercel projects are configured. For a new installation, follow [local/SETUP.md](local/SETUP.md) and run [supabase/jaygrid.sql](supabase/jaygrid.sql) in the Supabase SQL Editor. The existing table supports named schedules and the watchlist without a schema change. Never commit a service-role key or Google client secret.

## Deployments

The current Vercel deployment was made from the CLI. Pushing this repository does not automatically deploy until it is connected to the Vercel project. To deploy manually from a linked checkout, run `vercel deploy --prod`.

The app has no JHU affiliation or registration capability. Verify meeting dates, availability, and enrollment in the official [JHU course search](https://courses.jhu.edu/).
