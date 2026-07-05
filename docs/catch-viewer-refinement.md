# Catch viewer (preview) refinement — continuation plan

Status: implemented 2026-07-03 (same day as planned). Tasks 1-4 done, with
these choices: Task 3 went the destination-icon route (new `icons/camera.svg`
top-left, existing `icons/gallery.svg` as the close icon, no labels); the
optional flipped-export label variant (Task 1) and the delete outline restyle
(Task 4) were deliberately skipped. The RAL popover/swatch-strip dead code was
deleted (incl. `ral-popover-position.js` + test). New token: `--shadow-card-lift`.
Harness: `public/__viewer-chrome-preview.html`. The viewer is the
`catch-details` shared panel:
`src/modules/collection/palette-viewer-overlay.js` +
`public/styles/blocks/panel/palette-viewer.css` + markup in `public/index.html`
(search `catch-details`).

## Context (what the screen is today)

- Top-left: round button with the colorcatchers logo (`catchDetailsCameraButton`)
  → closes viewer AND gallery, back to camera.
- Top-right: shared-panel close button with a left chevron
  (`capture-panel-back.svg`) → back to gallery.
- Middle: swipeable horizontal track of polaroid slides (scroll-snap). Since the
  verso work, tapping a slide flips it to the palette verso, and the export
  action exports whichever face is visible.
- Bottom: 4 icon-only round buttons — delete (red, far left), publish/unpublish,
  export, share. Icons are hydrated by `hydrateViewerActionButton`, which already
  renders a `<span class="palette-quick-action-label">` with a visible label —
  but the CSS keeps it `display: none` (palette-viewer.css, `.palette-quick-action-label`).

## Task 1 — Visible labels under the action buttons

Problem: four icon-only circles; publish (arrow up) vs export (arrow down) is
genuinely ambiguous.

- The label spans already exist and are localized
  (`viewer.action.{share,export,delete,publish,unpublish}Label` in
  `src/i18n/locales/{en,fr}.js`) — this is CSS work, not JS work.
- Un-hide `.palette-quick-action-label`; style like the camera "Config" button
  label (`.btn-config-label`): tiny, uppercase, muted. Currently the label is
  absolutely positioned at `bottom: -1.25rem` — the actions bar
  (`.palette-viewer-actions`) needs bottom padding to give it room, or restack
  button+label as a grid column like the old collection view toggles.
- Publish button label already swaps publish/unpublish via
  `getPublishButtonCopy()` — check the longer French labels ("Retirer"?) fit.
- Optional: when the active slide is flipped, the export label could switch to
  a "palette" variant to advertise that export follows the visible face
  (`slideState.isFlipped` is available in the overlay).

## Task 2 — Capture identity: date + position indicator

Problem: nothing says WHICH capture you're viewing, and nothing hints the track
is swipeable. Note: the date was deliberately removed from the verso, so the
viewer chrome is now the only place to show it.

- Add a caption line near the track (below the slide or in the header):
  date + time from `palette.timestamp` (use `getIntlLocale()` like
  `grouping.js` does) and a published-state hint if cheap
  (`getPublishAction(palette) === "unpublish"` means it is published).
- Add a position indicator "2 / 7" (or dots for small counts). Update it in
  `updateActiveIndex()` / `syncViewerChrome()`; hide when only one slide
  (`openDirectPaletteViewer` opens single-palette sessions).
- New i18n keys for the aria-label; the visible "2 / 7" needs none.

## Task 3 — Disambiguate the two top buttons

Problem: two different "back" actions, neither reads clearly. The logo button
does not communicate "back to camera"; a left-pointing chevron sitting on the
RIGHT edge reads oddly.

- Replace the logo image in `catchDetailsCameraButton` with a camera glyph
  (no camera icon in `public/icons/` yet — add one in the Phosphor 256-viewBox
  style used by the folder; `camera-rotate.svg` exists but means "flip camera").
- Consider swapping the close icon to `close.svg` (×) instead of the chevron,
  or moving the chevron to point right. Check `shared-panel.js` for how
  `close-icon-src` is applied before changing.
- Alternative worth considering: labels under these two as well ("Caméra",
  "Galerie") — cheaper than icon debates and consistent with Task 1.

## Task 4 — Small polish (opportunistic)

- Drop shadow under the polaroid slide so it lifts off the flat background
  (match the verso's `box-shadow` so recto/verso feel like one object).
- Delete button: consider outline-only styling (destructive de-emphasis);
  it sits exactly where a left thumb rests. The undo-toast safety net already
  exists.
- The RAL popover (`showRalPopover`) belongs to the disabled swatch strip —
  the strip markup is commented out in index.html
  (`palette-viewer-swatch-strip`). Since the verso replaced that feature,
  consider deleting the dead popover code + CSS + strip markup entirely.

## Verification

- Harness pattern: static pages in `public/__*.html` (CSP blocks inline
  scripts — put JS in a sibling `.js` file). Render headlessly:
  `"/Applications/Helium.app/Contents/MacOS/Helium" --headless --disable-gpu
  --screenshot=out.png --window-size=420,900 --hide-scrollbars <url>`.
- Dev server: `http://localhost:3000` (port 5173 is a DIFFERENT project).
- Existing verso harness: `/__verso-preview.html`.

## Known loose ends in the same area (not this work, don't forget)

- `--verso-plate-rule: red` currently committed in `palette-verso.css` — an
  experiment value that reached pwa/preprod; needs a final color.
- The canvas verso export (`palette-verso.js` VERSO_* constants) no longer
  matches the restyled DOM verso (theme tokens); sync them or read computed
  token values at export time.
