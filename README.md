# ECM Register Local Next.js App

Next.js/React version of the ECM Register for local laptop use.

The Streamlit app remains untouched and can still be used as the fallback application.

## How This Version Works

- Frontend: Next.js/React
- Backend: Next.js API routes
- Database: local SQLite file
- Default local database path: `data/ecm_register.db`
- Browser URL: `http://localhost:3000`

This is not intended to use Vercel for live data. Vercel can host a demo, but it cannot reliably use a laptop-local SQLite file.

You can keep this folder anywhere on your laptop. If it is moved, keep the `data/` folder with it because that is where the local database lives.

## First-Time Setup

From this folder:

```bash
npm install
npm run import:streamlit
npm run dev
```

Then open:

```text
http://localhost:3000
```

`npm run import:streamlit` copies the current Streamlit database from:

```text
../ecm_register_app/ecm_register.db
```

to:

```text
data/ecm_register.db
```

The copied database is intentionally ignored by Git.

To import from a different source database:

```bash
npm run import:streamlit -- C:\path\to\ecm_register.db
```

## Daily Use

```bash
npm run dev
```

Then use the app at:

```text
http://localhost:3000
```

## Backup

For a complete local backup of this Next.js version, copy:

```text
data/ecm_register.db
```

When attachment support is added to this app, also copy the future attachments folder.

Do not rely on GitHub for the database backup. GitHub stores the application code, while the SQLite database remains local on your laptop.

## Current Scope

Implemented:

- property selector
- portfolio KPI summary
- ECM register table
- add ECM
- edit ECM status
- delete ECM
- local SQLite persistence

Still to migrate from Streamlit:

- tenants and equipment editor
- monthly utility usage UI
- implemented savings UI
- report exports
- attachment uploads
- database explorer/admin pages
