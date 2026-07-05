# Claude Code Instructions

## Dev & test

- Dev server: `bun run dev` → http://localhost:3000 (NOT 5173 — another project squats that port).
- Tests: `bun run test` · CSS lint: `bun run lint:css` · JS lint/format: `bunx biome check`.
- To verify UI changes visually, use the chrome-devtools MCP (Helium) against :3000 — see `/ui-check`.

## Workflow

- Working branch: `pwa/preprod`. End of a work cycle = commit + push to `origin pwa/preprod` so I can test on the phone (`/preprod` does this).
- Commit style: lowercase conventional-ish prefixes (`feat:`, `fix:`, `chore:`, `docs:`), short imperative subject.

## UI & CSS

Before writing any UI or CSS, read `public/styles/settings/tokens.css` for all available design tokens.

- Use tokens instead of hardcoded values (colors, spacing, radii, durations, fonts, shadows).
- Never invent token names — only use what exists in that file.
- When no token covers a value, flag it rather than hardcoding silently.
- Fonts: only the fonts already bundled in the app — never serif, never introduce a new font.
