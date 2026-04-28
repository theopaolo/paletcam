# Codebase Structure

```
paletcam/
├── src/
│   ├── app.js                     # App bootstrap and orchestration
│   ├── app-settings.js            # Persisted app settings
│   ├── palette-storage.js         # Dexie/IndexedDB palette persistence
│   ├── community-*.js             # Community publish/delete/session
│   ├── collection-ui.js           # Palette collection UI
│   ├── modules/
│   │   ├── camera/                # Camera acquisition helpers
│   │   ├── camera-controller.js   # Camera lifecycle controller
│   │   ├── camera-ui.js           # Camera rendering (canvas)
│   │   ├── collection/            # Palette card, grouping, viewer overlay
│   │   ├── panels/                # Config/settings panels (Lit elements)
│   │   ├── toast/                 # Toast notification host
│   │   ├── palette-extraction.js  # Palette extraction orchestration
│   │   ├── palette-extract-median-cut.js
│   │   ├── color-cut-quantizer.js
│   │   ├── color-matching-ral.js  # RAL Classic matching
│   │   ├── color-space-oklch.js   # OKLCH color math
│   │   ├── exposure-ui.js         # Exposure slider UI
│   │   ├── zoom-ui.js             # Zoom slider UI
│   │   └── ...
│   ├── workers/                   # Web workers (palette extraction)
│   └── vendor/                    # Third-party JS (not linted/built)
├── public/
│   ├── index.html                 # Main app shell
│   ├── styles/
│   │   ├── index.css              # Stylesheet entrypoint (imports all layers)
│   │   ├── settings/tokens.css    # Design tokens (CSS custom properties)
│   │   ├── generic/               # reset.css, fonts.css
│   │   ├── composition/           # shell.css (app-level layout)
│   │   ├── blocks/                # Component styles (camera, panel, buttons…)
│   │   ├── utilities/             # display.css, layout.css
│   │   └── exceptions/            # modes.css (dark/state overrides)
│   ├── service-worker.js
│   └── manifest.json
├── scripts/
│   ├── build.js                   # Production bundler script
│   ├── dev-server.js              # Dev server
│   └── css-token-audit.js         # CSS raw-value audit tool
├── types/app.d.ts                 # Global type declarations
├── biome.json                     # Biome lint/format config
└── tsconfig.json                  # TS config (checkJs, noEmit)
```
