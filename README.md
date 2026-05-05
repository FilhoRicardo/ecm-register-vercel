# ECM Register Vercel

Next.js migration of the local Streamlit ECM Register.

This repository is intentionally separate from the Streamlit app, which remains the fallback version.

## What This Version Does

- Clean operations-console frontend built with Next.js
- API-route backend under `app/api`
- Vercel Postgres-ready database access
- Local in-memory fallback data when `POSTGRES_URL` is not configured
- Property selector
- Portfolio KPI summary
- ECM register table
- Add ECM
- Edit status/approval
- Delete ECM
- Monthly usage and implemented-savings API foundations

## Why Not SQLite On Vercel?

The Streamlit version uses a local SQLite file. That is good for a single-user laptop app.

Vercel deployments do not provide a durable writable local filesystem for production app data. For production use, this version should use Vercel Postgres, Neon, Supabase Postgres, or another hosted database.

## Local Run

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

Without `POSTGRES_URL`, the app uses local in-memory demo data. Edits work during the running process but are not persisted.

## Production Setup

1. Create a new Vercel project from this repo.
2. Add Vercel Postgres or another Postgres provider.
3. Set `POSTGRES_URL` in Vercel environment variables.
4. Run `db/schema.sql` against the database.
5. Import data from the Streamlit SQLite database using a migration script.

The migration script is intentionally not included yet because it should be reviewed before moving live project data into a cloud database.

## Project Structure

```text
app/
  api/                 Backend API routes
  page.tsx             Main app page
  globals.css          Operations-console styling
components/
  EcmConsole.tsx       Main frontend experience
lib/
  store.ts             Database/in-memory data layer
  types.ts             Shared TypeScript types
  calculations.ts      Savings calculations
db/
  schema.sql           Postgres schema
```

## Fallback Strategy

Keep using the Streamlit app for live work until the Vercel version has:

- imported real data
- tested backups/exports
- matched the critical workflows
- confirmed database persistence on Vercel
