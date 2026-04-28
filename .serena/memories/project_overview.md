# PaletCam — Project Overview

PaletCam is a Progressive Web App (PWA) that uses the device camera to capture and extract color palettes from the live camera feed. It matches colors against the RAL Classic color system and lets users save, group, and share palettes. It has a community feature for publishing palettes.

## Key Capabilities
- Live camera feed with exposure/zoom controls
- Real-time palette extraction (median-cut / color-cut quantizer algorithms)
- RAL Classic color matching (OKLCH color space)
- Palette storage via IndexedDB (Dexie)
- Community publish/delete workflow
- PWA with service worker and offline support

## Entry Points
- `public/index.html` — main app shell
- `src/app.js` — app bootstrap and orchestration
- `public/service-worker.js` — PWA offline caching
- `public/manifest.json` — PWA manifest
