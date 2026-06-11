| File:line | Hook | Why deferred | E2E coverage |
| --- | --- | --- | --- |
| `src/App.jsx:237` | `useEffect` boot call | Boot is an initialization flow with several local callbacks and state setters; changing dependencies risks re-running workspace initialization. | `e2e/spine.spec.js` |
| `src/App.jsx:2927` | `useEffect` status quo loader | Loader identity is currently unstable; changing dependencies could alter folder-backed reload behavior. | `e2e/spine.spec.js` |
| `src/App.jsx:3059` | `useEffect` open actions loader | Loader identity is currently unstable; changing dependencies could alter folder-backed reload behavior. | `e2e/spine.spec.js` |
