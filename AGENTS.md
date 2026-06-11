# Agent Instructions

## Core Principles

- Work from the Linear issue or explicit user request.
- Use Linear project `ECM Register Vercel` as the project-management source of truth for this application.
- Linear project URL: https://linear.app/rf-ai-workspace/project/ecm-register-vercel-b846bf95da0f
- Prefer simple, surgical changes over broad refactors.
- Touch only the files required to satisfy the stated acceptance criteria.
- Preserve existing behavior unless the issue explicitly changes it.
- Match the existing code style, architecture, naming, and UI conventions.
- Surface uncertainty early. Do not guess silently when requirements are ambiguous.

## App Design System

- Use Aster as the default visual system for this app unless the Linear issue or user explicitly provides a different brand.
- Before branding or UI work, read `/Users/ricardofilho/Documents/Projects/resources/branding/aster/BRAND.md`.
- Use `/Users/ricardofilho/Documents/Projects/resources/branding/aster/aster-tokens.css` as the source for colors, typography, glass surfaces, buttons, badges, inputs, selected states, and motion.
- For the planned branding update, copy or import the Aster tokens into the app style layer, likely `src/index.css`, and then refit existing UI components in `src/App.jsx` to those tokens.
- Keep the ECM Register workflow intact. Do not redesign navigation, calculations, imports, exports, or CRREM behavior unless the issue explicitly asks for that.
- Do not invent a new palette, font pairing, shadow stack, glass recipe, or decorative gradient. If you need to deviate from Aster, state the reason before editing.

## Default Workflow

### Before Editing

- Read the Linear issue, linked spec, and relevant existing files.
- Identify the acceptance criteria, assumptions, and non-goals.
- If multiple interpretations exist, state them and ask for clarification.
- Check current implementation patterns before adding new ones.
- Inspect current git status so unrelated work is not disturbed.
- Define the narrowest useful verification command for the task.

### While Editing

- Implement only the stated acceptance criteria.
- Do not change unrelated files.
- Do not refactor opportunistically.
- Do not add speculative features, flexibility, configurability, or abstractions.
- Preserve existing behavior unless the issue explicitly changes it.
- Follow existing code style, architecture, naming, and UI conventions.
- Add or update tests when the change affects logic, data flow, permissions, integrations, or user-visible behavior.
- Remove only imports, variables, functions, or files made unused by your own changes.
- If you notice unrelated dead code or cleanup opportunities, mention them separately instead of changing them.

### Before Opening A PR

- Run the relevant checks for the files touched.
- Use the narrowest useful verification command for the task.
- If a broad check is already known to have unrelated failures, say so plainly in the PR and include the targeted checks that passed.
- Review the diff for unrelated changes.
- Confirm the PR description follows `.github/pull_request_template.md` when it exists.

## Simplicity Standard

- Write the minimum code that solves the problem.
- Do not create abstractions for single-use code.
- Do not add error handling for impossible scenarios.
- If the implementation becomes much larger than the problem suggests, simplify it.
- Every changed line should trace directly to the user's request or the Linear issue.

## Goal-Driven Execution

Transform tasks into verifiable goals.

- "Add validation" means add or update checks for invalid inputs, then make them pass.
- "Fix the bug" means reproduce the bug when practical, then verify the fix.
- "Refactor X" means verify behavior before and after the change.

For multi-step tasks, use a brief plan:

1. State the step.
2. Name the verification check.
3. Loop until the stated acceptance criteria are satisfied.

## PR Standard

Every PR should explain:

- What changed
- Why
- Linear issue
- Acceptance criteria checked
- Screenshots, Loom, or preview URL when relevant
- Risk
- How to test
- What was intentionally not done
- Agent involvement
- Follow-up issues created

## PR Review Standard

Review against the linked Linear issue only.

Look for:

- Acceptance criteria gaps
- Bugs
- Broken data flow
- Unnecessary scope expansion
- Security issues
- Bad abstractions
- Missing loading or error states
- Code that will be hard for future agents to modify

Do not suggest unrelated improvements unless they are severe.

Return review feedback in three groups:

1. Must fix before merge
2. Should fix soon
3. Safe to merge

## Agent Behavior

- Think before coding.
- State assumptions explicitly.
- Ask when something is unclear.
- Push back when a simpler approach exists.
- Keep diffs small and easy to review.
- Do not hide confusion or uncertainty.
- Do not continue past unclear requirements when the wrong choice could create rework.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
