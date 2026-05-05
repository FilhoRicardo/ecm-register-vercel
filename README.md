# ECM Register Vercel

Browser-local ECM Register for a single-user Obsidian workflow.

Vercel serves the React app. The browser asks the user to select local folders, then reads and writes the local SQLite database, ECM Markdown notes, implemented-savings Markdown notes, meeting notes, report exports, and calculation reference files directly on the device.

## Storage Model

- `ecm_register.db` remains the structured source of truth.
- ECMs are stored in SQLite and mirrored to Obsidian Markdown.
- Implemented savings are stored in SQLite and mirrored to Obsidian Markdown.
- Monthly meeting notes are written to Obsidian Markdown.
- Calculation/reference files are copied locally with controlled filenames.
- Reports remain downloads, with optional save-to-folder support.

## Onboarding Folders

The app asks for these folders:

- Database Folder
- ECM Notes Folder
- Implemented Savings Notes Folder
- Monthly Meeting Notes Folder
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
