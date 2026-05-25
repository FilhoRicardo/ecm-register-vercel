# ECM Register Vercel

Browser-local ECM Register for a single-user Obsidian workflow.

Vercel serves the React app. The browser asks the user to select local folders, then reads and writes the local SQLite database, ECM Markdown notes, implemented-savings Markdown notes, meeting notes, report exports, and calculation reference files directly on the device.

## Storage Model

- Obsidian Markdown is the main source of truth for project records.
- `ecm_register.db` is the local structured cache the app uses for fast filtering, reports, and analysis.
- Properties are read from Obsidian property notes and cached in SQLite.
- Tenants are read from one Obsidian Markdown file per building and cached in SQLite.
- Equipment is read from one Obsidian Markdown file per building and cached in SQLite.
- ECMs, implemented savings, monthly consumption, and admin tracker rows are written to Obsidian and cached in SQLite.
- Monthly meeting notes are written to Obsidian Markdown.
- Calculation/reference files are copied locally with controlled filenames.
- Reports remain downloads, with optional save-to-folder support.

## Onboarding Folders

The app asks for these folders:

- Database Folder
- Property Notes Folder
- Tenant Notes Folder
- Equipment Notes Folder
- ECM Notes Folder
- Implemented Savings Notes Folder
- Monthly Meeting Notes Folder
- Monthly Usage Folder
- Admin Tracker Folder
- Calculation Files Folder
- Reports Folder
- Imports Folder

Chrome or Microsoft Edge is required because the app uses the File System Access API.

## Development

```bash
npm install
npm run dev
```

## Deployment

Deploy as a static Vite app on Vercel.

The database and files are not uploaded to Vercel. Vercel hosts only the frontend app bundle.
