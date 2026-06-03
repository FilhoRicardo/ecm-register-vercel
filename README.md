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

Chrome or Microsoft Edge is required because the app uses the File System Access API.

## Development

```bash
npm install
npm run dev
```

## Deployment

Deploy as a static Vite app on Vercel.

The files are not uploaded to Vercel. Vercel hosts only the frontend app bundle.
