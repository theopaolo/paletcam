# RAL Integration Redesign

## Problem

The current RAL integration displays a "Correspondances RAL" section prominently below every palette in the viewer. This is intrusive, not aligned with the app's design language, and doesn't match how a designer would actually use RAL matching (targeted, deliberate lookups rather than blanket display).

## Solution

Reposition RAL as a **dedicated capture mode** and an **on-demand lookup tool**, removing the always-visible RAL section entirely.

### Three RAL interaction points:

1. **Live RAL meter** (camera mode) — point camera at a surface, see the closest RAL match in real-time, capture as a single-color swatch
2. **Tap-on-swatch** (palette viewer) — tap any color in an extracted palette to see its RAL match in a popover
3. **Remove** the current "Correspondances RAL" section from the palette viewer

RAL is a future **pro feature** but will be built unlocked for now; gating comes later.

---

## 1. Settings & Mode Switching

### New setting: `captureMode`

- **Values**: `"palette"` (default) | `"ral"`
- **Persistence**: Saved in `AppSettings` via the existing localStorage-backed settings store
- **UI**: Segment button at the **top** of the settings panel, above all extraction settings
- **Behavior**: When `"ral"` is selected, the extraction algorithm subsections (median-cut params, grid params, palette scoring) are **hidden** since they don't apply to single-point RAL sampling

### Settings data model change

```javascript
// Added to AppSettings
captureMode: "palette" | "ral"  // default: "palette"
```

### Settings UI

- New segment button component using the existing segment button pattern
- Label: "MODE" (matching existing uppercase label style)
- Placed as the first item in the settings panel
- Extraction settings sections get conditional visibility based on `captureMode`

---

## 2. Camera View in RAL Mode

When `captureMode === "ral"`, the live camera view transforms:

### Reticle overlay

- Small rounded square (~24px) centered on the viewport
- Subtle stroke (1px, semi-transparent white with drop shadow for visibility on any background)
- No crosshair lines — just the square indicator

### Sampling

- Samples a small region around the center point (5x5 pixel average) to reduce noise from individual pixels
- Uses the existing `findClosestRAL(r, g, b)` function from `color-matching-ral.js`
- Throttled to ~10fps to avoid performance issues

### RAL swatch display

Replaces the palette strip at the bottom of the camera view. **Stacked layout** (not side-by-side):

- **Top**: Color block (wide rectangle showing the matched RAL color)
- **Below**: RAL code (e.g., "RAL 8028"), name (e.g., "Terra brown"), quality label with delta-E (e.g., "PROCHE . delta-E 3.1")
- Updates in real-time as the camera moves
- Styled consistently with the app's dark theme, gold accent for quality label

### Capture behavior

- Same shutter button as palette mode
- Captures the photo + the single RAL match at the moment of capture
- Saved to the same collection as palette captures

---

## 3. Collection Card for RAL Captures

RAL captures appear in the same collection alongside palette captures.

### Card differences

- Photo thumbnail (same as palette cards)
- Instead of a multi-color palette strip: a **single color bar** spanning the full width
- RAL code displayed on or just below the color bar

### Data model

RAL captures are stored as `Palette` objects but with:
- `colors` array containing a single `PaletteColor`
- A new field or convention to distinguish RAL captures from palette captures (e.g., `captureMode: "ral"` on the palette object, or `ralMatch` metadata)

---

## 4. Palette Viewer Adaptations

### For RAL captures

- Photo preview (same as today)
- Single large swatch below: color block on top, RAL code/name/delta-E underneath (stacked layout)
- Action buttons remain the same (share, download, publish, delete)

### For palette captures

- Photo preview + palette strip (same as today)
- **"Correspondances RAL" section is removed entirely**
- RAL info is now accessed via tap-on-swatch (see section 5)

---

## 5. Tap-on-Swatch RAL Lookup

In the palette viewer for palette captures, tapping a color swatch shows its closest RAL match.

### Interaction

- User taps a color in the palette strip
- A small **popover** appears above/near the tapped swatch
- Shows the RAL match in stacked layout: color block on top, RAL code/name/delta-E underneath
- Tap elsewhere or swipe down to dismiss
- Only one popover visible at a time

### Why a popover

- Keeps the palette strip undisturbed
- No layout reflow
- Feels like an inspection tool — deliberate, on-demand
- Consistent with the idea that RAL is a targeted precision feature, not ambient info

---

## 6. What Gets Removed

- The entire `.palette-viewer-ral` section from `palette-viewer-overlay.js`
- The `matchPaletteToRAL()` batch function call in the viewer (individual `findClosestRAL()` calls remain for tap-on-swatch)
- Associated CSS for the horizontal RAL card list

---

## 7. Files Affected

| File | Change |
|------|--------|
| `src/app-settings.js` | Add `captureMode` to settings schema and defaults |
| `types/app.d.ts` | Add `captureMode` to `AppSettings` type |
| `src/settings-ui.js` | Add mode segment button, conditional visibility for extraction sections |
| `src/modules/collection/palette-viewer-overlay.js` | Remove RAL section, add tap-on-swatch popover, adapt viewer for RAL captures |
| `public/styles/panel.css` | Remove RAL list styles, add popover styles, add RAL swatch card styles |
| `public/index.html` | Add reticle overlay element, add RAL swatch container for camera view |
| Camera/capture logic (TBD) | Add RAL mode sampling loop, modify capture to save RAL data |
| `src/modules/collection/palette-card.js` | Adapt card rendering for single-color RAL captures |

---

## 8. Out of Scope

- Pro/premium gating (built unlocked, gating is a separate future effort)
- Tap-on-photo eyedropper (can be added later, overlaps with the other two features)
- RAL color families or advanced filtering
- Export formats specific to RAL (e.g., material spec sheets)
