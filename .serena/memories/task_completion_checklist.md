# Task Completion Checklist

After completing any coding task, run these in order:

1. **Lint + format**: `bun run check` (biome check --write .)
2. **Type check**: `bunx tsc --noEmit`
3. **Tests**: `bun test`
4. **CSS audit** (if CSS was modified): `bun run css:audit` → review `output/css-audit/report.md`

All four should pass with no errors before considering a task done.
Tests live co-located with source (`foo.test.js` next to `foo.js`).
