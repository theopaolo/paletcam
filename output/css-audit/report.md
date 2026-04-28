# CSS Token Audit

Scanned 27 style sources: 25 CSS files under `public` and 2 Lit `css`` blocks under `src`.

- Declarations parsed: 2019
- Design tokens in token files: 110
- Local custom properties outside token files: 59
- Repeated raw token candidates (threshold: 2+): 56

## Design Tokens

- `--accent-color` = `var(--color-accent-primary)` in `public/styles/settings/tokens.css:178`
- `--app-height` = `100vh` in `public/styles/settings/tokens.css:116`
- `--app-shell-max-width` = `500px` in `public/styles/settings/tokens.css:117`
- `--color-accent-500` = `#ffc800` in `public/styles/settings/tokens.css:11`
- `--color-accent-active` = `rgba(255, 200, 0, 0.9)` in `public/styles/settings/tokens.css:57`
- `--color-accent-border` = `rgba(255, 200, 0, 0.6)` in `public/styles/settings/tokens.css:55`
- `--color-accent-depth` = `color-mix(in srgb, var(--color-accent-primary) 60%, black)` in `public/styles/settings/tokens.css:52`
- `--color-accent-outline` = `rgba(255, 200, 0, 0.75)` in `public/styles/settings/tokens.css:56`
- `--color-accent-primary` = `var(--color-accent-500)` in `public/styles/settings/tokens.css:50`
- `--color-accent-soft` = `#ffe06d` in `public/styles/settings/tokens.css:51`
- `--color-accent-surface` = `rgba(255, 200, 0, 0.12)` in `public/styles/settings/tokens.css:53`
- `--color-accent-surface-strong` = `rgba(255, 200, 0, 0.24)` in `public/styles/settings/tokens.css:54`
- `--color-border-default` = `rgba(255, 255, 255, 0.2)` in `public/styles/settings/tokens.css:60`
- `--color-border-muted` = `rgba(255, 255, 255, 0.12)` in `public/styles/settings/tokens.css:59`
- `--color-border-strong` = `rgba(255, 255, 255, 0.25)` in `public/styles/settings/tokens.css:61`
- `--color-border-subtle` = `rgba(255, 255, 255, 0.08)` in `public/styles/settings/tokens.css:58`
- `--color-camera-accent` = `var(--color-accent-soft)` in `public/styles/settings/tokens.css:170`
- `--color-camera-readout-bg` = `rgba(247, 247, 247, 0.94)` in `public/styles/settings/tokens.css:171`
- `--color-camera-readout-fg` = `#161616` in `public/styles/settings/tokens.css:172`
- `--color-feedback-danger` = `#ff4a4a` in `public/styles/settings/tokens.css:62`
- `--color-feedback-danger-soft` = `#ffd6d6` in `public/styles/settings/tokens.css:63`
- `--color-feedback-success` = `#4caf50` in `public/styles/settings/tokens.css:64`
- `--color-feedback-success-soft` = `#a8e6a0` in `public/styles/settings/tokens.css:65`
- `--color-neutral-050` = `#f0f0f0` in `public/styles/settings/tokens.css:10`
- `--color-neutral-900` = `#2f2c1f` in `public/styles/settings/tokens.css:9`
- `--color-neutral-950` = `#222222` in `public/styles/settings/tokens.css:8`
- `--color-neutral-970` = `#1b1b1b` in `public/styles/settings/tokens.css:7`
- `--color-raw-chrome-highlight` = `#5757578a` in `public/styles/settings/tokens.css:4`
- `--color-raw-chrome-shadow` = `#303030` in `public/styles/settings/tokens.css:3`
- `--color-raw-control-900` = `#111111` in `public/styles/settings/tokens.css:5`
- `--color-raw-control-950` = `#0c0c0c` in `public/styles/settings/tokens.css:6`
- `--color-surface-app` = `var(--color-neutral-950)` in `public/styles/settings/tokens.css:36`
- `--color-surface-chrome` = `var(--color-raw-control-950)` in `public/styles/settings/tokens.css:32`
- `--color-surface-chrome-strong` = `var(--color-raw-control-900)` in `public/styles/settings/tokens.css:33`
- `--color-surface-control` = `var(--color-neutral-900)` in `public/styles/settings/tokens.css:37`
- `--color-surface-ink` = `var(--color-raw-control-900)` in `public/styles/settings/tokens.css:34`
- `--color-surface-overlay` = `rgba(18, 18, 18, 0.98)` in `public/styles/settings/tokens.css:38`
- `--color-surface-overlay-accent` = `rgba(10, 8, 3, 0.97)` in `public/styles/settings/tokens.css:40`
- `--color-surface-overlay-strong` = `rgba(10, 10, 10, 0.92)` in `public/styles/settings/tokens.css:39`
- `--color-surface-raised` = `var(--color-neutral-970)` in `public/styles/settings/tokens.css:35`
- `--color-surface-tint` = `rgba(255, 255, 255, 0.02)` in `public/styles/settings/tokens.css:41`
- `--color-surface-tint-soft` = `rgba(255, 255, 255, 0.04)` in `public/styles/settings/tokens.css:42`
- `--color-surface-tint-strong` = `rgba(255, 255, 255, 0.12)` in `public/styles/settings/tokens.css:43`
- `--color-text-accent-soft` = `#fff1b8` in `public/styles/settings/tokens.css:48`
- `--color-text-muted` = `rgba(240, 240, 240, 0.72)` in `public/styles/settings/tokens.css:46`
- `--color-text-primary` = `var(--color-neutral-050)` in `public/styles/settings/tokens.css:44`
- `--color-text-secondary` = `rgba(240, 240, 240, 0.9)` in `public/styles/settings/tokens.css:45`
- `--color-text-soft` = `rgba(255, 255, 255, 0.68)` in `public/styles/settings/tokens.css:47`
- `--color-text-warning` = `#ffd08f` in `public/styles/settings/tokens.css:49`
- `--dark-color` = `var(--color-surface-control)` in `public/styles/settings/tokens.css:176`
- `--duration-200` = `0.2s` in `public/styles/settings/tokens.css:164`
- `--duration-fast` = `var(--duration-200)` in `public/styles/settings/tokens.css:165`
- `--easing-ease` = `ease` in `public/styles/settings/tokens.css:166`
- `--easing-standard` = `var(--easing-ease)` in `public/styles/settings/tokens.css:167`
- `--focus-ring` = `2px solid var(--color-accent-outline)` in `public/styles/settings/tokens.css:160`
- `--focus-ring-offset` = `2px` in `public/styles/settings/tokens.css:161`
- `--font-family-body` = `"SNPro", sans-serif` in `public/styles/settings/tokens.css:133`
- `--font-family-mono` = `monospace` in `public/styles/settings/tokens.css:134`
- `--font-size-2xs` = `0.5rem` in `public/styles/settings/tokens.css:135`
- `--font-size-base` = `1rem` in `public/styles/settings/tokens.css:139`
- `--font-size-lg` = `1.25rem` in `public/styles/settings/tokens.css:140`
- `--font-size-md` = `0.875rem` in `public/styles/settings/tokens.css:138`
- `--font-size-sm` = `0.75rem` in `public/styles/settings/tokens.css:137`
- `--font-size-xs` = `0.625rem` in `public/styles/settings/tokens.css:136`
- `--gradient-accent-metal` = `linear-gradient(182deg, var(--color-accent-soft) 5%, color-mix(in srgb, var(--color-accent-primary) 72%, black) 50%, color-mix(in srgb, var(--color-accent-primary) 72%, black) 100%)` in `public/styles/settings/tokens.css:82`
- `--gradient-control-shell` = `var(--gradient-raw-control-shell)` in `public/styles/settings/tokens.css:109`
- `--gradient-control-shell-pressed` = `var(--gradient-raw-control-shell-pressed)` in `public/styles/settings/tokens.css:110`
- `--gradient-control-surface` = `var(--gradient-raw-control-surface)` in `public/styles/settings/tokens.css:111`
- `--gradient-raw-control-shell` = `linear-gradient(#181818, #141414 8%, #131313 20%, #0c0c0c 50%, #131313bd 80%, #161616)` in `public/styles/settings/tokens.css:12`
- `--gradient-raw-control-shell-pressed` = `linear-gradient(#111111 10%, #101010 20%, #0c0c0c 40%, #080808 50%, #0b0b0b)` in `public/styles/settings/tokens.css:20`
- `--gradient-raw-control-surface` = `linear-gradient(180deg, #1f1f1f 0%, #111111 100%)` in `public/styles/settings/tokens.css:27`
- `--gradient-raw-slider-shell` = `linear-gradient(to bottom, #171717 0%, #111111 55%, #151515 100%)` in `public/styles/settings/tokens.css:28`
- `--gradient-raw-slider-track` = `linear-gradient(#111111 30%, #141414 50%, #141414 80%, #141414)` in `public/styles/settings/tokens.css:29`
- `--gradient-slider-shell` = `var(--gradient-raw-slider-shell)` in `public/styles/settings/tokens.css:112`
- `--gradient-slider-track` = `var(--gradient-raw-slider-track)` in `public/styles/settings/tokens.css:113`
- `--gradient-surface-panel` = `linear-gradient(180deg, var(--color-surface-tint-soft), var(--color-surface-tint))` in `public/styles/settings/tokens.css:66`
- `--gradient-surface-panel-strong` = `linear-gradient(180deg, var(--color-surface-tint-soft), rgba(255, 255, 255, 0.01))` in `public/styles/settings/tokens.css:71`
- `--gradient-surface-sheen` = `linear-gradient(180deg, var(--color-surface-tint-strong) 0%, rgba(255, 255, 255, 0) 45%, rgba(0, 0, 0, 0.25) 100%)` in `public/styles/settings/tokens.css:76`
- `--overlay-control-border` = `var(--color-border-default)` in `public/styles/settings/tokens.css:153`
- `--overlay-control-border-active` = `var(--color-accent-active)` in `public/styles/settings/tokens.css:156`
- `--overlay-control-color` = `var(--color-text-muted)` in `public/styles/settings/tokens.css:154`
- `--overlay-control-color-active` = `var(--color-accent-primary)` in `public/styles/settings/tokens.css:155`
- `--overlay-control-gap` = `var(--space-8)` in `public/styles/settings/tokens.css:152`
- `--overlay-control-height` = `1.5rem` in `public/styles/settings/tokens.css:149`
- `--overlay-control-padding-x` = `var(--space-8)` in `public/styles/settings/tokens.css:151`
- `--overlay-control-press-offset` = `var(--space-2)` in `public/styles/settings/tokens.css:157`
- `--overlay-control-radius` = `var(--radius-md)` in `public/styles/settings/tokens.css:150`
- `--primary-color` = `var(--color-surface-app)` in `public/styles/settings/tokens.css:175`
- `--radius-lg` = `0.5rem` in `public/styles/settings/tokens.css:145`
- `--radius-md` = `0.25rem` in `public/styles/settings/tokens.css:144`
- `--radius-pill` = `999px` in `public/styles/settings/tokens.css:146`
- `--radius-sm` = `0.125rem` in `public/styles/settings/tokens.css:143`
- `--secondary-color` = `var(--color-text-primary)` in `public/styles/settings/tokens.css:177`
- `--shadow-accent-outline` = `inset 0 0 0 1px var(--color-accent-surface), 0 0 0 1px rgba(255, 200, 0, 0.06)` in `public/styles/settings/tokens.css:97`
- `--shadow-control-bevel` = `inset 0 2px 5px var(--color-raw-chrome-highlight), 0 2px 4px var(--color-raw-chrome-shadow)` in `public/styles/settings/tokens.css:88`
- `--shadow-control-bevel-tight` = `inset 1px 2px 4px var(--color-raw-chrome-highlight), 1px 1px 4px var(--color-raw-chrome-shadow)` in `public/styles/settings/tokens.css:91`
- `--shadow-control-inset` = `inset 0 1px 0 rgba(255, 255, 255, 0.06), inset 0 -2px 4px rgba(0, 0, 0, 0.62)` in `public/styles/settings/tokens.css:94`
- `--shadow-slider-thumb` = `inset 0 1px 1px rgba(255, 255, 255, 0.14), inset 0 -1px 2px rgba(0, 0, 0, 0.72), 0 1px 1px rgba(0, 0, 0, 0.64)` in `public/styles/settings/tokens.css:100`
- `--shadow-slider-thumb-active` = `inset 0 1px 1px rgba(255, 255, 255, 0.1), inset 0 -1px 2px rgba(0, 0, 0, 0.78), 0 1px 1px rgba(0, 0, 0, 0.68), 0 0 7px rgba(255, 224, 109, 0.45)` in `public/styles/settings/tokens.css:104`
- `--space-10` = `0.625rem` in `public/styles/settings/tokens.css:124`
- `--space-12` = `0.75rem` in `public/styles/settings/tokens.css:125`
- `--space-16` = `1rem` in `public/styles/settings/tokens.css:126`
- `--space-2` = `0.125rem` in `public/styles/settings/tokens.css:120`
- `--space-20` = `1.25rem` in `public/styles/settings/tokens.css:127`
- `--space-24` = `1.5rem` in `public/styles/settings/tokens.css:128`
- `--space-4` = `0.25rem` in `public/styles/settings/tokens.css:121`
- `--space-6` = `0.375rem` in `public/styles/settings/tokens.css:122`
- `--space-8` = `0.5rem` in `public/styles/settings/tokens.css:123`
- `--space-control-gap` = `var(--space-8)` in `public/styles/settings/tokens.css:130`
- `--space-control-padding` = `var(--space-4)` in `public/styles/settings/tokens.css:129`

## Local Custom Properties

- `--capture-glow-rgb` = `255, 200, 0` in `public/styles/blocks/buttons.css:142`
- `--config-icon-url` = `url("/icons/microscope.svg")` in `public/styles/blocks/panel/config-drawer.css:115`
- `--config-icon-url` = `url("/icons/swatches.svg")` in `public/styles/blocks/panel/config-drawer.css:119`
- `--config-icon-url` = `url("/icons/contrast.svg")` in `public/styles/blocks/panel/config-drawer.css:123`
- `--config-icon-url` = `url("/icons/arrow-bend-left.svg")` in `public/styles/blocks/panel/config-drawer.css:127`
- `--config-icon-url` = `url("/icons/arrow-bend-right.svg")` in `public/styles/blocks/panel/config-drawer.css:131`
- `--config-icon-url` = `url("/icons/arrow-counterclock.svg")` in `public/styles/blocks/panel/config-drawer.css:135`
- `--dock-gap` = `var(--space-control-gap)` in `public/styles/blocks/panel/collection-panel.css:18`
- `--dock-gap` = `var(--space-12)` in `public/styles/blocks/panel/config-drawer.css:156`
- `--name-rgba` = `255, 255, 255, 0.65` in `public/styles/blocks/branding.css:2`
- `--panel-icon-button-background` = `var(--gradient-control-shell)` in `public/styles/blocks/panel/panel-controls.css:91`
- `--panel-icon-button-background` = `var(--color-surface-overlay-strong)` in `public/styles/blocks/panel/panel-controls.css:101`
- `--panel-icon-button-overflow` = `hidden` in `public/styles/blocks/panel/panel-controls.css:88`
- `--panel-icon-button-shadow` = `var(--shadow-control-bevel)` in `public/styles/blocks/panel/panel-controls.css:90`
- `--panel-icon-button-size` = `2.5rem` in `public/styles/blocks/panel/palette-viewer.css:36`
- `--panel-icon-button-size` = `3rem` in `public/styles/blocks/panel/panel-controls.css:89`
- `--panel-icon-button-size` = `3rem` in `public/styles/blocks/panel/panel-controls.css:100`
- `--panel-icon-button-size` = `3rem` in `public/styles/blocks/panel/panel-controls.css:112`
- `--shared-panel-body-display` = `grid` in `public/styles/blocks/panel/index.css:19`
- `--shared-panel-body-display` = `grid` in `public/styles/blocks/panel/index.css:35`
- `--shared-panel-body-overflow` = `hidden` in `public/styles/blocks/panel/index.css:20`
- `--shared-panel-body-overflow` = `hidden` in `public/styles/blocks/panel/index.css:36`
- `--shared-panel-close-icon-filter` = `invert(1)` in `public/styles/blocks/panel/index.css:38`
- `--shared-panel-header-padding` = `var(--space-control-gap)` in `public/styles/blocks/panel/index.css:37`
- `--shared-panel-padding` = `0` in `public/styles/blocks/panel/index.css:33`
- `--shared-panel-shell-overflow-y` = `hidden` in `public/styles/blocks/panel/index.css:18`
- `--shared-panel-shell-overflow-y` = `hidden` in `public/styles/blocks/panel/index.css:34`
- `--shared-panel-z-index` = `1000` in `public/styles/blocks/panel/index.css:14`
- `--shared-panel-z-index` = `1001` in `public/styles/blocks/panel/index.css:24`
- `--shared-panel-z-index` = `1002` in `public/styles/blocks/panel/index.css:28`
- `--shared-panel-z-index` = `1102` in `public/styles/blocks/panel/index.css:32`
- `--stack-gap` = `var(--space-4)` in `public/styles/blocks/panel/panel-forms.css:19`
- `--stack-index` = `0` in `public/styles/blocks/toast.css:14`
- `--swatch-inline-pad` = `var(--space-16)` in `public/styles/blocks/sliders.css:19`
- `--swatch-thumb-width` = `18px` in `public/styles/blocks/sliders.css:20`
- `--tick-count` = `6` in `public/styles/blocks/sliders.css:21`
- `--tick-glow-height` = `9px` in `public/styles/blocks/sliders.css:27`
- `--tick-glow-height` = `13px` in `public/styles/blocks/sliders.css:38`
- `--tick-glow-width` = `12px` in `public/styles/blocks/sliders.css:26`
- `--tick-glow-width` = `19px` in `public/styles/blocks/sliders.css:37`
- `--tick-highlight-local` = `calc(var(--tick-step) * var(--tick-index))` in `public/styles/blocks/sliders.css:25`
- `--tick-highlight-width` = `0.65px` in `public/styles/blocks/sliders.css:28`
- `--tick-highlight-width` = `1.15px` in `public/styles/blocks/sliders.css:39`
- `--tick-index` = `3` in `public/styles/blocks/sliders.css:22`
- `--tick-intervals` = `5` in `public/styles/blocks/sliders.css:23`
- `--tick-step` = `calc(100% / var(--tick-intervals))` in `public/styles/blocks/sliders.css:24`
- `--toolbar-align` = `flex-start` in `public/styles/blocks/panel/collection-panel.css:118`
- `--toolbar-align` = `flex-start` in `src/modules/panels/shared-panel.js:76`
- `--toolbar-gap` = `var(--space-16)` in `public/styles/blocks/buttons.css:216`
- `--toolbar-gap` = `var(--space-12) var(--space-16)` in `public/styles/blocks/panel/collection-panel.css:111`
- `--toolbar-gap` = `var(--space-12)` in `public/styles/blocks/panel/collection-panel.css:119`
- `--toolbar-gap` = `var(--space-8)` in `public/styles/blocks/panel/config-drawer.css:160`
- `--toolbar-gap` = `var(--space-control-padding)` in `public/styles/composition/shell.css:39`
- `--toolbar-gap` = `var(--space-control-gap)` in `src/modules/panels/shared-panel.js:78`
- `--toolbar-justify` = `center` in `public/styles/blocks/buttons.css:217`
- `--toolbar-justify` = `flex-end` in `public/styles/blocks/panel/collection-panel.css:112`
- `--toolbar-justify` = `flex-end` in `src/modules/panels/shared-panel.js:77`
- `--toolbar-wrap` = `wrap` in `public/styles/blocks/panel/collection-panel.css:113`
- `--zoom-progress` = `0.495` in `public/styles/blocks/camera/camera-zoom.css:138`

## Repeated Raw Values

### Colors

- `#050505`
  Uses: 2. Properties: background. Suggestion: promote as `--color-raw-01`.
  Sample refs: `public/styles/blocks/panel/palette-card.css:92`, `public/styles/blocks/panel/palette-card.css:99`.
- `#1a1a1a`
  Uses: 2. Properties: background. Suggestion: promote as `--color-raw-02`.
  Sample refs: `public/styles/blocks/sliders.css:154`, `public/styles/blocks/sliders.css:193`.
- `#3a3a3a`
  Uses: 2. Properties: background. Suggestion: promote as `--color-raw-03`.
  Sample refs: `public/styles/blocks/sliders.css:154`, `public/styles/blocks/sliders.css:193`.
- `#5e5e5e`
  Uses: 2. Properties: background. Suggestion: promote as `--color-raw-04`.
  Sample refs: `public/styles/blocks/sliders.css:154`, `public/styles/blocks/sliders.css:193`.
- `rgb(0 0 0 / 70%)`
  Uses: 2. Properties: box-shadow. Suggestion: promote as `--color-raw-05`.
  Sample refs: `public/styles/blocks/sliders.css:139`, `public/styles/blocks/sliders.css:181`.
- `rgb(86 86 86)`
  Uses: 2. Properties: box-shadow. Suggestion: promote as `--color-raw-06`.
  Sample refs: `public/styles/blocks/sliders.css:139`, `public/styles/blocks/sliders.css:181`.
- `rgba(0, 0, 0, 0.3)`
  Uses: 2. Properties: box-shadow. Suggestion: promote as `--color-raw-07`.
  Sample refs: `public/styles/blocks/panel/palette-viewer.css:231`, `src/modules/performance-hud.js:181`.
- `rgba(0, 0, 0, 0.35)`
  Uses: 2. Properties: background, box-shadow. Suggestion: promote as `--color-raw-08`.
  Sample refs: `public/styles/blocks/panel/palette-card.css:149`, `public/styles/blocks/toast.css:30`.
- `rgba(0, 0, 0, 0.4)`
  Uses: 2. Properties: background, box-shadow. Suggestion: promote as `--color-raw-09`.
  Sample refs: `public/styles/blocks/panel/palette-viewer.css:231`, `public/styles/blocks/panel/panel-forms.css:8`.
- `rgba(0, 0, 0, 0.5)`
  Uses: 2. Properties: box-shadow. Suggestion: promote as `--color-raw-10`.
  Sample refs: `public/styles/blocks/camera/index.css:66`, `public/styles/blocks/panel/collection-panel.css:43`.
- `rgba(18, 18, 18, 0.65)`
  Uses: 2. Properties: background. Suggestion: promote as `--color-raw-11`.
  Sample refs: `public/styles/blocks/sliders.css:154`, `public/styles/blocks/sliders.css:193`.
- `rgba(255, 152, 88, 0.92)`
  Uses: 2. Properties: background, border-color. Suggestion: promote as `--color-raw-12`.
  Sample refs: `public/styles/blocks/toast.css:147`, `public/styles/blocks/toast.css:60`.
- `rgba(255, 200, 0, 0.35)`
  Uses: 2. Properties: background, box-shadow. Suggestion: promote as `--color-raw-13`.
  Sample refs: `public/styles/blocks/panel/palette-card.css:121`, `public/styles/generic/reset.css:51`.
- `rgba(255, 255, 255, 0.02)`
  Uses: 2. Properties: background. Suggestion: reuse `--color-surface-tint`.
  Sample refs: `public/styles/blocks/sliders.css:154`, `public/styles/blocks/sliders.css:193`.
- `rgba(255, 255, 255, 0.5)`
  Uses: 2. Properties: background. Suggestion: promote as `--color-raw-14`.
  Sample refs: `public/styles/blocks/sliders.css:154`, `public/styles/blocks/sliders.css:193`.
- `rgba(255, 255, 255, 0.9)`
  Uses: 2. Properties: background, border. Suggestion: promote as `--color-raw-15`.
  Sample refs: `public/styles/blocks/panel/palette-viewer.css:229`, `public/styles/blocks/panel/palette-viewer.css:243`.
- `rgba(255, 255, 255, 0)`
  Uses: 2. Properties: background. Suggestion: promote as `--color-raw-16`.
  Sample refs: `public/styles/blocks/camera/index.css:10`, `public/styles/blocks/panel/panel-forms.css:259`.
- `rgba(86, 86, 86, 0.55)`
  Uses: 2. Properties: background. Suggestion: promote as `--color-raw-17`.
  Sample refs: `public/styles/blocks/sliders.css:154`, `public/styles/blocks/sliders.css:193`.

### Gradients

- `linear-gradient(to bottom, #5e5e5e 0%, #3a3a3a 50%, #1a1a1a 100%)`
  Uses: 2. Properties: background. Suggestion: promote as `--gradient-raw-01`.
  Sample refs: `public/styles/blocks/sliders.css:154`, `public/styles/blocks/sliders.css:193`.
- `linear-gradient(to bottom, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0.02))`
  Uses: 2. Properties: background. Suggestion: promote as `--gradient-raw-02`.
  Sample refs: `public/styles/blocks/sliders.css:154`, `public/styles/blocks/sliders.css:193`.
- `linear-gradient(to right, rgba(18, 18, 18, 0.65) 0 1.5px, rgba(86, 86, 86, 0.55) 1.5px 3px)`
  Uses: 2. Properties: background. Suggestion: promote as `--gradient-raw-03`.
  Sample refs: `public/styles/blocks/sliders.css:154`, `public/styles/blocks/sliders.css:193`.
- `repeating-linear-gradient(to right, rgba(18, 18, 18, 0.65) 0 1.5px, rgba(86, 86, 86, 0.55) 1.5px 3px)`
  Uses: 2. Properties: background. Suggestion: promote as `--gradient-raw-04`.
  Sample refs: `public/styles/blocks/sliders.css:154`, `public/styles/blocks/sliders.css:193`.

### Font Families

- `"Museum"`
  Uses: 3. Properties: font-family. Suggestion: promote as `--font-family-01`.
  Sample refs: `public/styles/generic/fonts.css:12`, `public/styles/generic/fonts.css:2`, `public/styles/generic/fonts.css:22`.
- `"SNPro"`
  Uses: 3. Properties: font-family. Suggestion: promote as `--font-family-02`.
  Sample refs: `public/styles/generic/fonts.css:32`, `public/styles/generic/fonts.css:42`, `public/styles/generic/fonts.css:52`.

### Font Sizes

- `1rem`
  Uses: 2. Properties: font-size. Suggestion: reuse `--font-size-base`, `--space-16`.
  Sample refs: `public/styles/blocks/panel/panel-forms.css:101`, `public/styles/blocks/panel/panel-forms.css:28`.

### Font Weights

- `600`
  Uses: 13. Properties: font-weight. Suggestion: promote as `--font-weight-01`.
  Sample refs: `public/pwa-install.css:52`, `public/styles/blocks/branding.css:5`, `public/styles/blocks/panel/collection-panel.css:133`, `public/styles/blocks/panel/collection-panel.css:287`.
- `700`
  Uses: 9. Properties: font-weight. Suggestion: promote as `--font-weight-02`.
  Sample refs: `public/styles/blocks/buttons.css:332`, `public/styles/blocks/camera/camera-exposure.css:108`, `public/styles/blocks/panel/collection-panel.css:241`, `public/styles/blocks/panel/collection-panel.css:34`.
- `400`
  Uses: 6. Properties: font-weight. Suggestion: promote as `--font-weight-03`.
  Sample refs: `public/styles/blocks/camera/camera-zoom.css:121`, `public/styles/blocks/panel/panel-forms.css:295`, `public/styles/blocks/panel/panel-forms.css:36`, `public/styles/generic/fonts.css:16`.
- `500`
  Uses: 4. Properties: font-weight. Suggestion: promote as `--font-weight-04`.
  Sample refs: `public/styles/blocks/camera/camera-exposure.css:50`, `public/styles/blocks/camera/camera-zoom.css:48`, `public/styles/blocks/panel/collection-panel.css:233`, `public/styles/blocks/panel/panel-forms.css:25`.
- `300`
  Uses: 3. Properties: font-weight. Suggestion: promote as `--font-weight-05`.
  Sample refs: `public/styles/blocks/panel/panel-forms.css:102`, `public/styles/generic/fonts.css:36`, `public/styles/generic/fonts.css:6`.
- `800`
  Uses: 2. Properties: font-weight. Suggestion: promote as `--font-weight-06`.
  Sample refs: `public/styles/generic/fonts.css:26`, `public/styles/generic/fonts.css:56`.

### Letter Spacing

- `-0.02em`
  Uses: 2. Properties: letter-spacing. Suggestion: promote as `--tracking-01`.
  Sample refs: `public/styles/blocks/camera/camera-exposure.css:54`, `public/styles/blocks/camera/camera-zoom.css:125`.
- `-0.04em`
  Uses: 2. Properties: letter-spacing. Suggestion: promote as `--tracking-02`.
  Sample refs: `public/styles/blocks/buttons.css:331`, `public/styles/blocks/panel/panel-controls.css:43`.

### Spacing

- `-1px`
  Uses: 5. Properties: bottom, left, margin, right, top. Suggestion: promote as `--space-01`.
  Sample refs: `public/styles/blocks/panel/palette-viewer.css:249`, `public/styles/blocks/panel/palette-viewer.css:250`, `public/styles/blocks/panel/palette-viewer.css:257`, `public/styles/blocks/panel/palette-viewer.css:258`.
- `-9999px`
  Uses: 2. Properties: left, top. Suggestion: promote as `--space-02`.
  Sample refs: `public/styles/blocks/camera/index.css:134`, `public/styles/blocks/camera/index.css:135`.
- `1rem`
  Uses: 2. Properties: gap, padding-bottom. Suggestion: reuse `--font-size-base`, `--space-16`.
  Sample refs: `public/styles/blocks/panel/collection-panel.css:208`, `public/styles/blocks/panel/panel-forms.css:4`.
- `2.5rem`
  Uses: 2. Properties: bottom, padding. Suggestion: promote as `--space-03`.
  Sample refs: `public/styles/blocks/panel/collection-panel.css:349`, `public/styles/blocks/panel/config-drawer.css:13`.

### Radii

- `100vh`
  Uses: 2. Properties: border-radius. Suggestion: reuse `--app-height`.
  Sample refs: `public/styles/blocks/camera/camera-zoom.css:34`, `public/styles/blocks/panel/collection-panel.css:162`.
- `3px`
  Uses: 2. Properties: border-radius. Suggestion: promote as `--radius-01`.
  Sample refs: `public/styles/blocks/sliders.css:151`, `public/styles/blocks/sliders.css:190`.
- `4px`
  Uses: 2. Properties: border-radius. Suggestion: promote as `--radius-02`.
  Sample refs: `public/pwa-install.css:8`, `public/styles/blocks/sliders.css:135`.

### Durations

- `0.14s`
  Uses: 7. Properties: transition. Suggestion: promote as `--duration-01`.
  Sample refs: `public/styles/blocks/buttons.css:385`, `public/styles/blocks/buttons.css:395`, `public/styles/blocks/panel/config-drawer.css:75`, `public/styles/blocks/panel/panel-controls.css:141`.
- `0.2s`
  Uses: 6. Properties: transition. Suggestion: reuse `--duration-200`.
  Sample refs: `public/pwa-install.css:54`, `public/pwa-install.css:75`, `public/styles/blocks/camera/camera-exposure.css:31`, `public/styles/blocks/camera/index.css:107`.
- `0.15s`
  Uses: 4. Properties: transition. Suggestion: promote as `--duration-02`.
  Sample refs: `public/styles/blocks/camera/index.css:77`, `public/styles/blocks/panel/palette-viewer.css:133`, `public/styles/blocks/sliders.css:164`, `public/styles/blocks/sliders.css:203`.
- `0.18s`
  Uses: 3. Properties: transition. Suggestion: promote as `--duration-03`.
  Sample refs: `public/styles/blocks/buttons.css:338`, `public/styles/blocks/camera/camera-exposure.css:116`, `public/styles/blocks/camera/camera-exposure.css:155`.
- `0.16s`
  Uses: 2. Properties: transition. Suggestion: promote as `--duration-04`.
  Sample refs: `public/styles/blocks/buttons.css:158`, `public/styles/blocks/sliders.css:115`.
- `1.1s`
  Uses: 2. Properties: animation. Suggestion: promote as `--duration-05`.
  Sample refs: `public/styles/blocks/buttons.css:204`, `public/styles/blocks/buttons.css:208`.

### Easings

- `ease`
  Uses: 11. Properties: animation, transition. Suggestion: reuse `--easing-ease`.
  Sample refs: `public/pwa-install.css:10`, `public/styles/blocks/buttons.css:204`, `public/styles/blocks/buttons.css:208`, `public/styles/blocks/buttons.css:225`.
- `cubic-bezier(0.22, 1, 0.36, 1)`
  Uses: 4. Properties: animation, transition. Suggestion: promote as `--easing-01`.
  Sample refs: `public/styles/blocks/buttons.css:158`, `public/styles/blocks/panel/config-drawer.css:34`, `public/styles/blocks/panel/palette-card.css:58`, `public/styles/composition/shell.css:52`.
- `ease-out`
  Uses: 3. Properties: animation, transition. Suggestion: promote as `--easing-02`.
  Sample refs: `public/pwa-install.css:10`, `public/styles/blocks/buttons.css:225`, `public/styles/blocks/camera/index.css:22`.
- `cubic-bezier(0.65, 0.05, 0.36, 1)`
  Uses: 2. Properties: transition. Suggestion: promote as `--easing-03`.
  Sample refs: `public/styles/blocks/toast.css:34`, `src/modules/panels/shared-panel.js:45`.
- `ease-in`
  Uses: 2. Properties: animation. Suggestion: promote as `--easing-04`.
  Sample refs: `public/styles/blocks/buttons.css:204`, `public/styles/blocks/buttons.css:208`.
- `ease-in-out`
  Uses: 2. Properties: animation. Suggestion: promote as `--easing-05`.
  Sample refs: `public/styles/blocks/buttons.css:204`, `public/styles/blocks/buttons.css:208`.
- `linear`
  Uses: 2. Properties: animation. Suggestion: promote as `--easing-06`.
  Sample refs: `public/styles/blocks/panel/palette-card.css:122`, `public/styles/blocks/toast.css:135`.

### Z-Indexes

- `1`
  Uses: 4. Properties: z-index. Suggestion: promote as `--layer-01`.
  Sample refs: `public/styles/blocks/buttons.css:227`, `public/styles/blocks/camera/camera-zoom.css:109`, `public/styles/blocks/camera/camera-zoom.css:140`, `public/styles/blocks/sliders.css:119`.
- `10`
  Uses: 2. Properties: z-index. Suggestion: promote as `--layer-02`.
  Sample refs: `public/styles/blocks/panel/config-drawer.css:5`, `public/styles/blocks/panel/palette-viewer.css:236`.
- `4`
  Uses: 2. Properties: z-index. Suggestion: promote as `--layer-03`.
  Sample refs: `public/styles/blocks/buttons.css:306`, `public/styles/blocks/buttons.css:313`.

## Notes

- This audit scans both `.css` files under `public` and Lit `css`` template literals under `src`.
- Values already defined as custom properties are listed separately so you can distinguish existing token coverage from raw duplication.

