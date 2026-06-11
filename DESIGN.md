# Design System — ECM Register

## Product Context
- **What this is:** Single-user energy-management instrument: properties, tenants, ECMs, monthly consumption, CRREM carbon pathways, client report exports.
- **Who it's for:** An energy/sustainability consultant using it daily on commercial building portfolios.
- **Space/industry:** ESG / building energy management (peers: ESG dashboards, CRREM tooling).
- **Project type:** Data-dense internal web app (sidebar + content workspace).
- **The memorable thing:** *A precision instrument — data you trust at a glance.* Every decision below serves this.

## Aesthetic Direction
- **Direction:** Refined industrial / precision instrument — a lab notebook crossed with a financial model, not a sustainability brochure.
- **Decoration level:** Intentional — hairline rules, warm paper ground, subtle depth. Typography does the work.
- **Mood:** Calm, exact, low-glare. Green reads as instrumentation, not eco-branding.
- **Outside voice:** Codex (cross-model agreement on direction, density, and palette; its row/radius/padding numbers adopted).

## Typography
- **Display (page titles, section heads):** Fraunces (weights 500–600, `"opsz"` auto) — the serif signature that separates this from every all-sans dashboard. Use sparingly: page titles and section headings only.
- **Body/UI:** Schibsted Grotesk — retained; characterful, already the identity.
- **Data/Tables/KPIs:** JetBrains Mono with `font-variant-numeric: tabular-nums` — all numbers align; numbers are the product.
- **Loading:** Google Fonts (add Fraunces to the existing @import).
- **Scale:** 11 / 12 / 13 (table data) / 14 (body) / 16 / 20 (section heads) / 24 (page title). Floor stays at 11px (locked by the readability pass, PR #1).

## Color
- **Approach:** Restrained — one accent; color is rare and means something.
- **Ground:** `#F6F5F0` warm paper. **Surface:** `#FFFFFF` cards/panels.
- **Ink:** `#16201B` primary, `#5C6660` muted, `#8A928D` faint.
- **Accent:** `#1F563B` (strong) / `#2F6F4E` (default) / `#DBE9DF` (soft fill) — instrument green.
- **Semantic:** success `#2F6F4E`, warning `#B26A1F`, error `#A43D36`, info `#3F6FD0`.
- **Hairlines:** `rgba(22,32,27,0.12)` borders; avoid heavy shadows.
- **Dark mode:** out of scope (single light theme by design).

## Spacing & Density
- **Base unit:** 4px. **Density:** compact — optimized for daily scanning/comparing.
- **Table rows:** 36px target (30px compact); cell horizontal padding 10px; sticky headers where tables scroll.
- **Panel padding:** 16px. **Section gap:** 20–24px.

## Layout
- **Approach:** Grid-disciplined. Sidebar ~248px + full-width content workspace; no max-width cap on tables.
- **Surfaces:** thin dividers and section bands over card mosaics; cards only where the card is the interaction.
- **Border radius:** 6px panels/inputs, 4px table affordances, 999px pills only.

## Motion
- **Approach:** Minimal-functional. Hover/state transitions only.
- **Easing:** enter ease-out, exit ease-in. **Duration:** 120–200ms. Animate `transform`/`opacity`/`color` only.

## Anti-Slop Rules (hard)
No purple gradients. No icon-in-circle grids. No centered-everything. No decorative blobs. No oversized empty KPI cards. No card-mosaic dashboards. Every screen answers: what asset, what data, what risk, what measure, what output.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-11 | Initial system created | /design-consultation (autonomous run, user-delegated taste; Codex outside voice convergent) |
| 2026-06-11 | Fraunces display + paper ground are the two deliberate risks | Premium signature vs all-sans clinical category norms |
