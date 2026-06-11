# ECM Register Vercel

Browser-local ECM Register for a single-user Obsidian workflow.

Vercel serves the React app. The browser asks the user to select local folders, then reads and writes Obsidian Markdown notes, meeting notes, report exports, and calculation reference files directly on the device.

## Storage Model

- Obsidian Markdown is the source of truth for project records.
- The browser rebuilds an in-memory structured cache from Obsidian notes for fast filtering, reports, and analysis.
- Properties are read from Obsidian property notes.
- Tenants are read from one Obsidian Markdown file per building.
- Equipment is read from one Obsidian Markdown file per building.
- ECMs, implemented savings, monthly consumption, and admin tracker rows are written to and read from Obsidian.
- Monthly meeting notes are written to Obsidian Markdown.
- Calculation/reference files are copied locally with controlled filenames.
- Reports are generated as browser downloads and can be saved wherever the user chooses.

## Onboarding Folders

The app asks for these folders:

- Property Notes Folder
- Tenant Notes Folder
- Equipment Notes Folder
- ECM Notes Folder
- Implemented Savings Notes Folder
- Monthly Meeting Notes Folder
- Monthly Usage Folder
- Admin Tracker Folder
- Status Quo Folder
- Open Actions Folder
- Calculation Files Folder

## Development

Chrome or Microsoft Edge is required because the app uses the File System Access API.

```bash
npm install
npm run dev
```

## Backend / Sync

The app includes two Vercel API routes for optional Supabase sync and backup workflows:

- `api/monthly-usage-sync.js` accepts `POST` requests to upsert or delete monthly utility usage rows in the `monthly_utility_usage` Supabase table.
- `api/supabase-backup.js` accepts `POST` requests with a SQLite backup payload and uploads it to Supabase Storage, including a latest-copy object.

Both routes require bearer-token auth using the `Authorization: Bearer <token>` header. The token must match the server-only `BACKUP_UPLOAD_TOKEN` environment variable.

Required server-only Vercel environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BACKUP_UPLOAD_TOKEN`

Optional server-only backup variables:

- `SUPABASE_BACKUP_BUCKET`
- `SUPABASE_BACKUP_PREFIX`

Client-side Supabase variables, when used, must be prefixed with `VITE_` and are baked into the browser bundle:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

## Deployment

Deploy as a Vite app on Vercel with the included serverless API routes.

Local Obsidian files are not uploaded to Vercel during normal browser-local use. Vercel hosts the frontend app bundle and the optional Supabase sync/backup endpoints described above.
