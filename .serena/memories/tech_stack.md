# Tech Stack

- **Runtime / bundler**: Bun (scripts use `bun run`, tests use `bun test`)
- **Language**: JavaScript (ES2022 modules, `.js` files with JSDoc types checked by TypeScript `checkJs`)
- **UI library**: Lit 3 (web components, `LitElement`) — used for panels and card components
- **Database**: Dexie 4 (IndexedDB wrapper) — palette storage
- **Linter / formatter**: Biome 2 (`biome lint`, `biome format`, `biome check`)
- **Type checking**: `tsc --noEmit` via `tsconfig.json` (allowJs + checkJs, no emitted output)
- **Build**: custom `scripts/build.js` (Bun-based)
- **Dev server**: custom `scripts/dev-server.js`
- **CSS**: plain CSS, CUBE CSS architecture (settings → generic → composition → blocks → utilities → exceptions)
- **Source map analysis**: `source-map-explorer`
- **Testing**: Bun's built-in test runner (`.test.js` files co-located with source)
