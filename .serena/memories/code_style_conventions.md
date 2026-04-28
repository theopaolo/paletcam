# Code Style & Conventions

## JavaScript
- ES modules (`import`/`export`), `.js` extensions on all imports
- No TypeScript source files — JS with JSDoc type annotations, checked via `tsc --noEmit`
- Biome enforces: 2-space indent, double quotes, trailing commas, semicolons, `const` over `let`, no `var`, strict equality (`===`)
- Line width: 100 chars
- Arrow function parentheses always required
- `noUnusedVariables` and `noUnusedImports` are warnings

## Naming
- Files: `kebab-case.js`
- Functions: `camelCase`, typically factory functions (`createXxx`) for stateful modules
- Constants: `SCREAMING_SNAKE_CASE` for module-level constants
- Lit custom elements: class names PascalCase, tag names `kebab-case`

## Module structure
- Feature modules live in `src/modules/` (flat or one sub-folder per domain)
- Test files co-located: `foo.js` → `foo.test.js`
- Lit UI components: `*-ui.js` or `*-panel.js` naming

## CSS
- CUBE CSS layering: settings / generic / composition / blocks / utilities / exceptions
- Design tokens defined in `public/styles/settings/tokens.css`
- Components consume semantic aliases (e.g. `--color-surface-panel`), not raw values
- No raw colors/gradients in utilities
- Run `bun run css:audit` and review `output/css-audit/report.md` to find duplicated literals
