# CSS Architecture

All design values live in a dedicated settings layer, [public/styles/settings/tokens.css](../public/styles/settings/tokens.css). Stylelint (`bun run lint:css`) enforces tokens on color properties through `stylelint-declaration-strict-value`. The one-off audit script that drove the original token migration was retired in July 2026 once the migration landed.

## Workflow

1. Before writing CSS, read `settings/tokens.css` and use tokens instead of raw literals.
2. When a value has no token, promote it into `settings/tokens.css` as a semantic alias (not a raw scale name) or flag it.
3. Intentional hardcodes carry a `stylelint-disable-next-line scale-unlimited/declaration-strict-value` annotation.
4. `bun run lint:css` is the gate.

## Folder Layout

The stylesheet entrypoint stays at [public/styles/index.css](../public/styles/index.css), but the folder now follows a CUBE-friendly split:

- `settings`: tokens and semantic aliases.
- `generic`: reset and font-face declarations.
- `composition`: app-level layout primitives and shell structure.
- `utilities`: one-purpose helper classes.
- `blocks`: component and UI block styles.
- `exceptions`: mode and state overrides that cut across blocks.

`index.css` imports the folders in this order and uses no `@layer`. On equal specificity a later folder wins, so `exceptions` overrides everything above it.

`blocks` is the component folder. Camera UI, buttons, sliders, panels, toast styles, and similar pieces belong there. `blocks/camera/` and `blocks/panel/` each import their files through their own `index.css`.

## Token Rules

- All tokens belong in `settings/tokens.css`. There is one semantic tier, with no separate raw or primitive scale.
- Semantic aliases should describe intent, for example `--color-surface-overlay` or `--gradient-control-shell`.
- Components should consume semantic aliases where possible.
- Utilities should not introduce new raw colors or gradients.
- New CSS should prefer existing tokens before adding literals.

## Current Scope

`bun run lint:css` checks `public/styles/**/*.css`. The token rule covers any property whose name contains `color`, plus `fill` and `stroke`. On those it rejects hex and named colors. It does not check:

- `rgb()` and `color-mix()` values. The plugin's default `ignoreFunctions: true` lets any function value pass.
- Shorthands and shadows (`background`, `border`, `box-shadow`, `text-shadow`). `.stylelintrc.json` leaves `background` out on purpose because multi-layer gradients are hard to tokenize. Gradients and shadows in `blocks/` still carry raw colors.
- Lit `css` template literals in `src/modules/performance-hud.js` and `src/modules/panels/shared-panel.js`.
- `public/pwa-install.css`, which `public/index.html` loads on its own.

Motion tokens are only partly adopted. `--duration-fast`, `--duration-settle` and the three `--easing-*` tokens exist, but about 40 transitions and animations still use literal durations. `cubic-bezier(0.22, 1, 0.36, 1)` repeats in 5 files with no token.
