---
description: Screenshot the app views in Helium and report visual/console issues
---

Verify the app UI visually without me having to paste screenshots:

1. Check the dev server is up on http://localhost:3000 (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`). If not, start `bun run dev` in the background and wait for it.
2. Using the chrome-devtools MCP (it launches Helium), open http://localhost:3000 with a mobile-ish viewport (~390×844 — this is a mobile-first PWA).
3. Screenshot the requested view(s). If no argument is given, cover the key surfaces: live camera view (UI chrome only — no real camera in headless), gallery panel, catch viewer, config panel.
4. Also pull the console messages and flag any errors or warnings.
5. Report: screenshots, what looks off (alignment, overflow, broken icons, unreadable labels), and console errors. Do not fix anything unless I ask.

View(s) to check: $ARGUMENTS
