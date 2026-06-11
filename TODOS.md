# TODOS

## Open

### [P3] Bundle-size budget check
- **What:** Add a size budget (size-limit or a small bundlesize script) asserting the main chunk stays under ~150 KB gzip; wire into the Vercel gate or CI.
- **Why:** The 976→116 KB gzip code-splitting win (commit da4fc9b) has no guard; one careless top-level `import ExcelJS` silently undoes it and nothing fails.
- **Context:** Main chunk is 116 KB gzip after dynamic-importing exceljs/pptxgenjs/CRREM data. Budget should cover the entry chunk only; lazy chunks excluded. Vite prints sizes at build time — the check can parse `dist/assets/index-*.js` gzip size.
- **Depends on:** Nothing. Independent of the test-infrastructure phases.
- **Added:** 2026-06-11 via /plan-eng-review (D10).

## Completed
