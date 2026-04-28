# Suggested Commands

## Development
```bash
bun run dev          # Start dev server
bun run build        # Production build → dist/
```

## Testing
```bash
bun test             # Run all tests (*.test.js)
bun test src/modules/palette-extraction.test.js  # Single file
```

## Linting & Formatting
```bash
bun run lint         # biome lint .
bun run format       # biome format --write .
bun run check        # biome check --write . (lint + format combined)
```

## Type checking
```bash
bunx tsc --noEmit    # Type-check JS via checkJs (no emitted output)
```

## CSS audit
```bash
bun run css:audit    # Scan public/ CSS for repeated raw values
# Review output: output/css-audit/report.md
```

## Utilities
```bash
bun run analyze-sm   # source-map-explorer on dist/app.js
git log --oneline -10  # recent commits
```
