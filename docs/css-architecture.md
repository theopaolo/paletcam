# CSS Architecture

This repo now has a token audit workflow built around [scripts/css-token-audit.js](/Users/theogoedert/Documents/Webworks/5-ludique-dev/1-creative-coding/paletcam/scripts/css-token-audit.js) and a dedicated settings layer in [public/styles/settings/tokens.css](/Users/theogoedert/Documents/Webworks/5-ludique-dev/1-creative-coding/paletcam/public/styles/settings/tokens.css). The goal is to stop hand-hunting raw literals and use the audit to drive a deliberate migration.

## Workflow

1. Run `bun run css:audit`.
2. Review `output/css-audit/report.md` for repeated raw values.
3. Promote stable values into `settings/tokens.css`.
4. Replace raw literals with semantic aliases, not raw scale names, where the intent is clear.
5. Re-run the audit until the repeated raw values shrink to intentional exceptions.

## Folder Layout

The stylesheet entrypoint stays at [public/styles/index.css](/Users/theogoedert/Documents/Webworks/5-ludique-dev/1-creative-coding/paletcam/public/styles/index.css), but the folder now follows a CUBE-friendly split:

- `settings`: tokens and semantic aliases.
- `generic`: reset and font-face declarations.
- `composition`: app-level layout primitives and shell structure.
- `utilities`: one-purpose helper classes.
- `blocks`: component and UI block styles.
- `exceptions`: mode and state overrides that cut across blocks.

`blocks` is the component folder. Camera UI, buttons, sliders, panels, toast styles, and similar pieces belong there.

## CUBE Direction

Recommended layering for this codebase:

- `settings`: design tokens and theme aliases.
- `generic`: reset and global defaults.
- `composition`: reusable layout patterns such as shells, stacks, clusters, docks.
- `blocks`: camera controls, panels, sliders, toasts.
- `utilities`: one-purpose override classes.
- `exceptions`: mode and state overrides that intentionally break the default block/composition rules.

The current CSS is still flat, but the audit gives you the data needed to split files with confidence instead of guessing.

## Priority Order

Start with the values that currently produce the most duplication:

- Dark surface colors and chrome borders.
- Metallic gradients repeated across buttons, sliders, and panel chrome.
- Accent gold states and yellow overlays.
- Repeated bevel shadows for circular controls.
- Spacing steps below `1rem`.
- Transition durations and shared easing curves.

Those are the easiest wins because they recur across multiple components and already behave like a design system even though they are still hard-coded.

## Token Rules

- Raw tokens belong in `settings/tokens.css`.
- Semantic aliases should describe intent, for example `--color-surface-panel` or `--gradient-control-shell`.
- Components should consume semantic aliases where possible.
- Utilities should not introduce new raw colors or gradients.
- New CSS should prefer existing tokens before adding literals.

## Current Scope

The audit currently scans `.css` files under `public`. It does not yet inspect Lit `css` template literals in `src`, so styles in custom elements still need a second pass if you want full repo coverage.
