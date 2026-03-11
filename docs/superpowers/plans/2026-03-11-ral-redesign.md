# RAL Integration Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reposition RAL from an always-visible section to a dedicated camera capture mode and on-demand swatch lookup tool.

**Architecture:** New `captureMode` setting toggles between palette extraction and single-point RAL sampling. Camera view adapts (reticle + RAL swatch vs palette strip). Viewer overlay gets tap-on-swatch popover for palette captures, and a single RAL swatch display for RAL captures. The intrusive "Correspondances RAL" section is removed.

**Tech Stack:** Vanilla JS, Lit web components, Bun test runner, Dexie (IndexedDB), CSS custom properties

**Spec:** `docs/superpowers/specs/2026-03-11-ral-redesign-design.md`

---

## Chunk 1: Settings & Data Model Foundation

### Task 1: Add `captureMode` to AppSettings

**Files:**
- Modify: `src/app-settings.js:26-45` (DEFAULT_SETTINGS)
- Modify: `src/app-settings.js:166-174` (normalizeSettings)
- Modify: `src/app-settings.js:176-191` (areSettingsEqual)
- Modify: `types/app.d.ts:84-90` (AppSettings interface)
- Test: `src/app-settings.test.js`

- [ ] **Step 1: Write failing tests for captureMode setting**

Add to `src/app-settings.test.js`:

```javascript
describe('app-settings captureMode', () => {
  test('defaults to palette', async () => {
    const { module } = await loadAppSettingsModule();

    expect(module.getDefaultAppSettings().captureMode).toBe('palette');
    expect(module.getAppSettings().captureMode).toBe('palette');
  });

  test('loads a persisted ral setting', async () => {
    const { module } = await loadAppSettingsModule({
      captureMode: 'ral',
    });

    expect(module.getAppSettings().captureMode).toBe('ral');
  });

  test('normalizes invalid captureMode to palette', async () => {
    const { module } = await loadAppSettingsModule({
      captureMode: 'invalid',
    });

    expect(module.getAppSettings().captureMode).toBe('palette');
  });

  test('notifies listeners when captureMode changes', async () => {
    const { module } = await loadAppSettingsModule();
    const updates = [];
    module.subscribeAppSettings((settings) => updates.push(settings));

    module.updateAppSettings({ captureMode: 'ral' });

    expect(updates).toHaveLength(1);
    expect(updates[0].captureMode).toBe('ral');
  });

  test('does not notify when captureMode is unchanged', async () => {
    const { module } = await loadAppSettingsModule();
    const updates = [];
    module.subscribeAppSettings((settings) => updates.push(settings));

    module.updateAppSettings({ captureMode: 'palette' });

    expect(updates).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/app-settings.test.js`
Expected: FAIL — `captureMode` is undefined on settings objects

- [ ] **Step 3: Add captureMode to types**

In `types/app.d.ts`, add `captureMode` to `AppSettings` (after line 89):

```typescript
interface AppSettings {
  captureMode: CaptureMode;
  photoExportQuality: number;
  paletteExtractionAlgorithm: PaletteExtractionAlgorithm;
  grid: GridSettings;
  medianCut: MedianCutSettings;
  paletteScoring: PaletteScoringWeights;
}
```

Add the type alias (near the other type aliases around line 79):

```typescript
type CaptureMode = 'palette' | 'ral';
```

Also add `captureMode` to the `AppSettingsPatch` interface (around line 93-99) so that `updateAppSettings({ captureMode: 'ral' })` is type-valid:

```typescript
interface AppSettingsPatch {
  captureMode?: CaptureMode;
  // ... existing fields unchanged
}
```

- [ ] **Step 4: Implement captureMode in app-settings.js**

In `src/app-settings.js`:

**Add valid modes constant** (near top, after existing constants around line 23):

```javascript
const VALID_CAPTURE_MODES = new Set(['palette', 'ral']);
```

**Add to DEFAULT_SETTINGS** (line 26-45, add as first property):

```javascript
const DEFAULT_SETTINGS = Object.freeze({
  captureMode: 'palette',
  photoExportQuality: 0.95,
  // ... rest unchanged
});
```

**Add normalization function** (near the other normalize functions, around line 93):

```javascript
function normalizeCaptureMode(value) {
  return VALID_CAPTURE_MODES.has(value) ? value : 'palette';
}
```

**Update normalizeSettings()** (line 166-174, add captureMode):

```javascript
function normalizeSettings(candidate) {
  return {
    captureMode: normalizeCaptureMode(candidate?.captureMode),
    photoExportQuality: clampPhotoExportQuality(candidate?.photoExportQuality),
    // ... rest unchanged
  };
}
```

**Update areSettingsEqual()** (line 176-191, add captureMode comparison):

```javascript
function areSettingsEqual(firstSettings, secondSettings) {
  return (
    firstSettings.captureMode === secondSettings.captureMode &&
    firstSettings.photoExportQuality === secondSettings.photoExportQuality &&
    // ... rest unchanged
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test src/app-settings.test.js`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/app-settings.js src/app-settings.test.js types/app.d.ts
git commit -m "feat: add captureMode setting (palette/ral)"
```

---

### Task 2: Add `captureMode` and `ralMatch` to Palette data model

**Files:**
- Modify: `types/app.d.ts:38-51` (Palette interface)
- Modify: `src/palette-storage.js:110-169` (savePalette function)

- [ ] **Step 1: Update Palette type definition**

In `types/app.d.ts`, add to the `Palette` interface (after line 50):

```typescript
interface Palette {
  id: number;
  timestamp: string;
  colors: RgbColor[];
  photoBlob: Blob;
  captureAspectRatio?: string;
  captureCropRect?: CropRect | null;
  captureMode?: CaptureMode;
  ralMatch?: RalMatchRecord;
  remoteCatchId: string | null;
  moderationStatus: ModerationStatus | null;
  postedAt: string | null;
  moderationUpdatedAt: string | null;
  lastModerationCheckAt: string | null;
}
```

And add the `RalMatchRecord` type (near the other RAL types):

```typescript
interface RalMatchRecord {
  code: string;
  name: string;
  r: number;
  g: number;
  b: number;
  deltaE: number;
}
```

- [ ] **Step 2: Update savePalette to accept RAL metadata**

In `src/palette-storage.js`, update the `savePalette` function signature and body (lines 110-169):

Update the options destructuring (line 112-117) to include new fields:

```javascript
export async function savePalette(
  colors,
  {
    photoDataUrl,
    photoBlob: providedPhotoBlob = null,
    captureAspectRatio = '4:3',
    captureCropRect = null,
    captureMode,
    ralMatch = null,
  } = {},
) {
```

Update the `db.palettes.add()` call (line 139-150) to include the new fields:

```javascript
    const id = await db.palettes.add({
      timestamp,
      colors: [...colors],
      photoBlob,
      captureAspectRatio,
      captureCropRect: safeCaptureCropRect,
      ...(captureMode === 'ral' ? { captureMode: 'ral', ralMatch } : {}),
      remoteCatchId: null,
      moderationStatus: null,
      postedAt: null,
      moderationUpdatedAt: null,
      lastModerationCheckAt: null,
    });
```

Update the return object (lines 152-164) similarly:

```javascript
    return {
      id,
      timestamp,
      colors: [...colors],
      photoBlob,
      captureAspectRatio,
      captureCropRect: safeCaptureCropRect,
      ...(captureMode === 'ral' ? { captureMode: 'ral', ralMatch } : {}),
      remoteCatchId: null,
      moderationStatus: null,
      postedAt: null,
      moderationUpdatedAt: null,
      lastModerationCheckAt: null,
    };
```

Note: No IndexedDB migration needed — these are additive optional fields. Existing palettes without `captureMode` default to palette behavior.

- [ ] **Step 3: Update JSDoc for savePalette**

Update the JSDoc above `savePalette` (lines 101-108):

```javascript
/**
 * @param {RgbColor[]} colors
 * @param {object} [options]
 * @param {string} [options.photoDataUrl]
 * @param {Blob | null} [options.photoBlob]
 * @param {string} [options.captureAspectRatio]
 * @param {CropRect | null} [options.captureCropRect]
 * @param {CaptureMode} [options.captureMode]
 * @param {RalMatchRecord | null} [options.ralMatch]
 * @returns {Promise<Palette>}
 */
```

- [ ] **Step 4: Commit**

```bash
git add types/app.d.ts src/palette-storage.js
git commit -m "feat: add captureMode and ralMatch to Palette data model"
```

---

### Task 3: Extract `getRalQualityLabel` into shared module

**Files:**
- Modify: `src/modules/color-matching-ral.js` (add exported function)
- Modify: `src/modules/collection/palette-viewer-overlay.js` (remove local function, import shared one)
- Test: `src/modules/color-matching-ral.test.js`

- [ ] **Step 1: Write failing test for getRalQualityLabel**

Add to `src/modules/color-matching-ral.test.js`:

```javascript
import { findClosestRAL, matchPaletteToRAL, getRalQualityLabel } from './color-matching-ral.js';

describe('getRalQualityLabel', () => {
  test('returns Très proche for deltaE <= 2', () => {
    expect(getRalQualityLabel(0)).toBe('Très proche');
    expect(getRalQualityLabel(1.5)).toBe('Très proche');
    expect(getRalQualityLabel(2)).toBe('Très proche');
  });

  test('returns Proche for deltaE <= 5', () => {
    expect(getRalQualityLabel(2.1)).toBe('Proche');
    expect(getRalQualityLabel(5)).toBe('Proche');
  });

  test('returns Bonne piste for deltaE <= 10', () => {
    expect(getRalQualityLabel(5.1)).toBe('Bonne piste');
    expect(getRalQualityLabel(10)).toBe('Bonne piste');
  });

  test('returns Approximation for deltaE > 10', () => {
    expect(getRalQualityLabel(10.1)).toBe('Approximation');
    expect(getRalQualityLabel(50)).toBe('Approximation');
  });

  test('returns empty string for non-finite values', () => {
    expect(getRalQualityLabel(NaN)).toBe('');
    expect(getRalQualityLabel(Infinity)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/modules/color-matching-ral.test.js`
Expected: FAIL — `getRalQualityLabel` is not exported

- [ ] **Step 3: Add getRalQualityLabel to color-matching-ral.js**

Add at the end of `src/modules/color-matching-ral.js` (before any closing):

```javascript
/**
 * Human-readable quality label for a RAL match delta-E distance.
 * @param {number} deltaE
 * @returns {string}
 */
export function getRalQualityLabel(deltaE) {
  if (!Number.isFinite(deltaE)) {
    return '';
  }

  if (deltaE <= 2) {
    return 'Très proche';
  }

  if (deltaE <= 5) {
    return 'Proche';
  }

  if (deltaE <= 10) {
    return 'Bonne piste';
  }

  return 'Approximation';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/modules/color-matching-ral.test.js`
Expected: ALL PASS

- [ ] **Step 5: Update palette-viewer-overlay.js to use shared function**

In `src/modules/collection/palette-viewer-overlay.js`:

1. Add import at top (near existing `color-matching-ral` import):
```javascript
import { matchPaletteToRAL, getRalQualityLabel } from '../color-matching-ral.js';
```

2. Remove the local `getRalQualityLabel` function (lines 200-218).

- [ ] **Step 6: Run all tests to ensure nothing is broken**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/color-matching-ral.js src/modules/color-matching-ral.test.js src/modules/collection/palette-viewer-overlay.js
git commit -m "refactor: extract getRalQualityLabel into shared color-matching-ral module"
```

---

## Chunk 2: Settings UI & Camera Mode Toggle

### Task 4: Add capture mode segment button to settings UI

**Files:**
- Modify: `public/index.html:191-207` (add segment button before algorithm selector)
- Modify: `src/settings-ui.js` (bind mode buttons, conditional section visibility)

- [ ] **Step 1: Add capture mode HTML**

In `public/index.html`, add the mode segment button **before** the existing algorithm section. Find the settings panel content area (the section containing the algorithm segment around line 191). Insert above it:

```html
<div class="settings-subsection" id="settingsCaptureModeSection">
  <label class="settings-subsection-label">Mode</label>
  <div class="settings-segment" role="group" aria-label="Mode de capture">
    <button class="settings-segment-button" data-settings-capture-mode="palette">Palette</button>
    <button class="settings-segment-button" data-settings-capture-mode="ral">RAL</button>
  </div>
</div>
```

- [ ] **Step 2: Add a wrapper around extraction-only settings in HTML**

Wrap all the extraction-related settings sections (algorithm selector, algorithm panels, scoring section) in a container that can be hidden. Find the algorithm segment (around line 191) and wrap everything from there through the scoring section in:

```html
<div id="settingsPaletteModeGroup">
  <!-- existing algorithm segment, algorithm panels, scoring section -->
</div>
```

- [ ] **Step 3: Bind capture mode controls in settings-ui.js**

In `src/settings-ui.js`:

Add DOM queries at the top (near existing queries around lines 14-22):

```javascript
const captureModeButtons = Array.from(
  document.querySelectorAll('[data-settings-capture-mode]')
);
const paletteModeGroup = document.getElementById('settingsPaletteModeGroup');
```

Add sync function (near existing `syncAlgorithmButtons` around line 246):

```javascript
function syncCaptureModeButtons(activeMode) {
  captureModeButtons.forEach((button) => {
    const buttonMode = button.getAttribute('data-settings-capture-mode');
    button.setAttribute('aria-pressed', String(buttonMode === activeMode));
  });
}

function syncPaletteModeGroupVisibility(captureMode) {
  if (paletteModeGroup) {
    paletteModeGroup.hidden = captureMode === 'ral';
  }
}
```

Add binding function (near existing `bindAlgorithmControls` around line 286):

```javascript
function bindCaptureModeControls() {
  captureModeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const nextMode = button.getAttribute('data-settings-capture-mode');
      if (nextMode === 'palette' || nextMode === 'ral') {
        updateAppSettings({ captureMode: nextMode });
      }
    });
  });
}
```

Update `renderSettingsUi` to include mode sync. Find the existing render function and add:

```javascript
syncCaptureModeButtons(settings.captureMode);
syncPaletteModeGroupVisibility(settings.captureMode);
```

Add `bindCaptureModeControls()` to the initialization section (around line 409-417).

- [ ] **Step 4: Verify in browser**

Open the app, open settings panel. Verify:
- "Mode" segment button appears above algorithm settings
- Clicking "RAL" hides the extraction settings
- Clicking "Palette" shows them again
- Reloading preserves the selected mode

- [ ] **Step 5: Commit**

```bash
git add public/index.html src/settings-ui.js
git commit -m "feat: add capture mode toggle (Palette/RAL) to settings UI"
```

---

### Task 5: Toggle camera UI elements based on capture mode

**Files:**
- Modify: `src/app.js` (listen to settings changes, toggle UI)
- Modify: `public/index.html` (add reticle element, add RAL swatch container)
- Modify: `public/styles/panel.css` (reticle and RAL swatch styles)

- [ ] **Step 1: Add reticle and RAL swatch HTML**

In `public/index.html`, add the reticle inside the camera preview dock (around line 862-876, inside `.camera-preview-dock`):

```html
<div class="ral-reticle" id="ralReticle" hidden aria-hidden="true"></div>
```

Add the RAL swatch display container. Find the `.sliders-container` (line 80) and add **after** it:

```html
<div class="ral-live-swatch" id="ralLiveSwatch" hidden>
  <div class="ral-live-swatch-color" id="ralLiveSwatchColor"></div>
  <div class="ral-live-swatch-info">
    <p class="ral-live-swatch-code" id="ralLiveSwatchCode"></p>
    <p class="ral-live-swatch-name" id="ralLiveSwatchName"></p>
    <p class="ral-live-swatch-quality" id="ralLiveSwatchQuality"></p>
  </div>
</div>
```

- [ ] **Step 2: Add reticle and RAL swatch CSS**

In `public/styles/panel.css`, add:

```css
/* RAL Reticle — centered in camera viewport */
.ral-reticle {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 24px;
  height: 24px;
  transform: translate(-50%, -50%);
  border: 1px solid rgba(255, 255, 255, 0.8);
  border-radius: 4px;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
  pointer-events: none;
  z-index: 10;
}

/* RAL Live Swatch — replaces palette strip in RAL mode */
.ral-live-swatch {
  padding: 0.5rem 1rem;
  text-align: center;
}

.ral-live-swatch-color {
  width: 100%;
  height: 3rem;
  border-radius: 0.6rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.ral-live-swatch-info {
  padding: 0.4rem 0;
}

.ral-live-swatch-code {
  font-weight: bold;
  font-size: 0.82rem;
  margin: 0;
}

.ral-live-swatch-name {
  font-size: 0.78rem;
  opacity: 0.8;
  margin: 0;
}

.ral-live-swatch-quality {
  font-size: 0.68rem;
  text-transform: uppercase;
  color: var(--accent-color, #ffc800);
  margin: 0;
}
```

- [ ] **Step 3: Add mode toggle logic in app.js**

In `src/app.js`:

Add imports at the top (near existing imports around line 28):

```javascript
import { findClosestRAL, sampleColorAtPoint, getRalQualityLabel } from './modules/color-matching-ral.js';
```

Add DOM references (near existing DOM queries around line 69-71):

```javascript
const ralReticle = document.getElementById('ralReticle');
const ralLiveSwatch = document.getElementById('ralLiveSwatch');
const ralLiveSwatchColor = document.getElementById('ralLiveSwatchColor');
const ralLiveSwatchCode = document.getElementById('ralLiveSwatchCode');
const ralLiveSwatchName = document.getElementById('ralLiveSwatchName');
const ralLiveSwatchQuality = document.getElementById('ralLiveSwatchQuality');
const slidersContainer = document.querySelector('.sliders-container');
const paletteCaptureStage = document.querySelector('.capture-palette-stage');
```

Add a mode state variable (near existing state variables around line 98-107):

```javascript
let currentCaptureMode = 'palette';
```

Add a function to sync UI to capture mode:

```javascript
function syncCaptureMode(mode) {
  const isRal = mode === 'ral';
  currentCaptureMode = mode;

  // Toggle camera UI elements
  if (ralReticle) ralReticle.hidden = !isRal;
  if (ralLiveSwatch) ralLiveSwatch.hidden = !isRal;
  if (slidersContainer) slidersContainer.hidden = isRal;
  if (paletteCaptureStage) paletteCaptureStage.hidden = isRal;

  // Reset state when switching modes
  resetPalettePreviewState();
  schedulePreviewRefresh();
}
```

Update the existing `applyAppSettings()` function (around line 504-523). This function uses destructuring — add `captureMode` to the destructured params and call `syncCaptureMode`:

```javascript
function applyAppSettings({
  captureMode,                              // <-- ADD THIS
  photoExportQuality: nextPhotoExportQuality,
  paletteExtractionAlgorithm,
  grid,
  medianCut,
  paletteScoring,
}) {
  // ... existing body unchanged ...

  // ADD at the end of the function:
  syncCaptureMode(captureMode);
}
```

- [ ] **Step 4: Verify in browser**

Open the app, switch to RAL mode in settings:
- Reticle appears centered on camera
- Palette strip and swatch slider disappear
- RAL swatch container appears (empty for now)
- Switching back to Palette restores normal UI

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/styles/panel.css src/app.js
git commit -m "feat: toggle camera UI elements based on capture mode"
```

---

## Chunk 3: Live RAL Sampling & Capture

### Task 6: Implement live RAL sampling in camera loop

**Files:**
- Modify: `src/app.js:1010-1097` (refreshPreview function)

- [ ] **Step 1: Add RAL sampling to the preview loop**

In `src/app.js`, modify `refreshPreview()` (around line 1010-1097).

The current extraction logic runs around lines 1063-1092. Add a branch for RAL mode. Replace the extraction block with a mode-aware version:

```javascript
// Inside refreshPreview(), after drawing frame to canvas (around line 1050):

if (currentCaptureMode === 'ral') {
  // RAL mode: sample center point every frame
  const frameImageData = frameContext.getImageData(0, 0, frameWidth, frameHeight);
  const centerX = Math.round(frameWidth / 2);
  const centerY = Math.round(frameHeight / 2);
  const sampled = sampleColorAtPoint(frameImageData.data, frameWidth, frameHeight, centerX, centerY);
  const matches = findClosestRAL(sampled.r, sampled.g, sampled.b, 1);

  if (matches.length > 0) {
    const best = matches[0];
    lastRalMatch = best;
    if (ralLiveSwatchColor) {
      ralLiveSwatchColor.style.backgroundColor = `rgb(${best.ral.r}, ${best.ral.g}, ${best.ral.b})`;
    }
    if (ralLiveSwatchCode) ralLiveSwatchCode.textContent = best.ral.code;
    if (ralLiveSwatchName) ralLiveSwatchName.textContent = best.ral.name;
    if (ralLiveSwatchQuality) {
      ralLiveSwatchQuality.textContent = `${getRalQualityLabel(best.deltaE)} · ΔE ${best.deltaE.toFixed(1)}`;
    }
  }
} else {
  // Existing palette extraction logic (unchanged)
  // ... keep all existing code from lines 1052-1092
}
```

Add state variable for last RAL match (near other state vars around line 98-107):

```javascript
let lastRalMatch = null;
```

Note: The RAL sampling runs every frame but `sampleColorAtPoint` is fast (9x9 pixels). No throttle needed — it's much cheaper than full palette extraction.

- [ ] **Step 2: Verify in browser**

Open app, switch to RAL mode, point camera at colored objects:
- RAL swatch updates in real-time showing the closest RAL color
- Code, name, and quality label update as you move the camera
- Performance feels smooth

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "feat: live RAL sampling in camera preview loop"
```

---

### Task 7: Modify capture flow for RAL mode

**Files:**
- Modify: `src/app.js:1099-1185` (captureCurrentFrame function)

- [ ] **Step 1: Add RAL capture branch to captureCurrentFrame**

In `src/app.js`, modify `captureCurrentFrame()` (around line 1099-1185).

After the existing frame drawing and before the photo export, add a branch. The key change is in the color extraction and save logic.

Find the section where `paletteColors` is determined (around lines 1124-1130) and the `savePalette` call (around line 1172). Make this mode-aware:

```javascript
// Replace the paletteColors section (around lines 1124-1130):
let paletteColors;
let ralMatchData = null;

if (currentCaptureMode === 'ral') {
  // Use the last sampled RAL match from the preview loop
  if (lastRalMatch) {
    paletteColors = [{ r: lastRalMatch.ral.r, g: lastRalMatch.ral.g, b: lastRalMatch.ral.b }];
    ralMatchData = {
      code: lastRalMatch.ral.code,
      name: lastRalMatch.ral.name,
      r: lastRalMatch.ral.r,
      g: lastRalMatch.ral.g,
      b: lastRalMatch.ral.b,
      deltaE: lastRalMatch.deltaE,
    };
  } else {
    paletteColors = [];
  }
} else {
  // Existing palette extraction logic
  paletteColors = getCapturePaletteColors();
  if (paletteColors.length === 0) {
    // ... existing fallback re-extraction
  }
}
```

Update the `savePalette` call (around line 1172) to pass RAL data:

```javascript
const savedPalette = await savePalette(paletteColors, {
  photoBlob: masterPhotoBlob,
  captureAspectRatio: CAMERA_FRAME_ASPECT_RATIO_LABEL,
  captureCropRect,
  captureMode: currentCaptureMode,
  ralMatch: ralMatchData,
});
```

- [ ] **Step 2: Verify in browser**

Open app, switch to RAL mode:
- Point camera at a surface
- Press capture button
- Verify capture flash fires
- Verify mini output thumbnail shows

- [ ] **Step 3: Commit**

```bash
git add src/app.js
git commit -m "feat: capture flow saves RAL match data in ral mode"
```

---

## Chunk 4: Remove Old RAL Section & Adapt Viewer

### Task 8: Remove the "Correspondances RAL" section

**Files:**
- Modify: `src/modules/collection/palette-viewer-overlay.js:220-276` (remove renderRalMatches)
- Modify: `public/index.html:827-830` (remove RAL section HTML)
- Modify: `public/styles/panel.css` (remove RAL list styles)

- [ ] **Step 1: Remove RAL section HTML**

In `public/index.html`, find and remove the RAL section (around lines 827-830):

```html
<!-- DELETE this entire section -->
<section class="palette-viewer-ral" id="catchDetailsRalSection" hidden>
  <h3 class="palette-viewer-ral-title">Correspondances RAL</h3>
  <div class="palette-viewer-ral-list" id="catchDetailsRalList"></div>
</section>
```

- [ ] **Step 2: Remove renderRalMatches from viewer overlay**

In `src/modules/collection/palette-viewer-overlay.js`:

1. Remove the `matchPaletteToRAL` import (keep `getRalQualityLabel` import from Task 3).
2. Remove the `renderRalMatches()` function (around lines 220-276).
3. Remove DOM references to `viewerRalSection` and `viewerRalList` (the `const` declarations near the top of the module).
4. Remove all usages of `viewerRalSection` and `viewerRalList` in `resetViewerFrame()` (around lines 93-110) — these null refs would cause `ReferenceError` after step 3.
5. Remove the `renderRalMatches(colors)` call in `openPaletteViewerOverlay()` (around line 310).

- [ ] **Step 3: Remove RAL list CSS**

In `public/styles/panel.css`, find and remove all styles for:
- `.palette-viewer-ral`
- `.palette-viewer-ral-title`
- `.palette-viewer-ral-list`
- `.palette-viewer-ral-card`
- `.palette-viewer-ral-swatch`
- `.palette-viewer-ral-code`
- `.palette-viewer-ral-name`
- `.palette-viewer-ral-quality`

Search for these class names and remove the entire rule blocks.

- [ ] **Step 4: Run all tests**

Run: `bun test`
Expected: ALL PASS (no tests depended on the RAL section rendering)

- [ ] **Step 5: Verify in browser**

Open a palette capture in the viewer. Verify:
- No "Correspondances RAL" section appears
- Palette strip and action buttons still work

- [ ] **Step 6: Commit**

```bash
git add src/modules/collection/palette-viewer-overlay.js public/index.html public/styles/panel.css
git commit -m "remove: intrusive Correspondances RAL section from palette viewer"
```

---

### Task 9: Adapt viewer overlay for RAL captures

**Files:**
- Modify: `src/modules/collection/palette-viewer-overlay.js` (adapt for RAL captures)
- Modify: `types/app.d.ts:396-408` (PaletteViewerOpenOptions)
- Modify: `public/index.html` (add RAL swatch viewer HTML)
- Modify: `public/styles/panel.css` (RAL viewer swatch styles)

- [ ] **Step 1: Update PaletteViewerOpenOptions type**

In `types/app.d.ts`, update the interface (around line 396-408):

```typescript
interface PaletteViewerOpenOptions {
  colors?: RgbColor[];
  captureMode?: CaptureMode;
  ralMatch?: RalMatchRecord;
  getPreviewAsset?: () => Promise<PreviewAsset>;
  onShare?: () => void | Promise<void>;
  onExport?: () => void | Promise<void>;
  onPublish?: () => void | Promise<void>;
  publishAction?: PublicationAction;
  onDelete?: () => void | Promise<void>;
  canShare?: boolean;
  canExport?: boolean;
  canPublish?: boolean;
  canDelete?: boolean;
}
```

- [ ] **Step 2: Add RAL swatch viewer HTML**

In `public/index.html`, inside the viewer overlay panel (near where the RAL section was removed in Task 8), add:

```html
<div class="palette-viewer-ral-swatch" id="catchDetailsRalSwatch" hidden>
  <div class="palette-viewer-ral-swatch-color" id="catchDetailsRalSwatchColor"></div>
  <div class="palette-viewer-ral-swatch-info">
    <p class="palette-viewer-ral-swatch-code" id="catchDetailsRalSwatchCode"></p>
    <p class="palette-viewer-ral-swatch-name" id="catchDetailsRalSwatchName"></p>
    <p class="palette-viewer-ral-swatch-quality" id="catchDetailsRalSwatchQuality"></p>
  </div>
</div>
```

- [ ] **Step 3: Add RAL swatch viewer CSS**

In `public/styles/panel.css`:

```css
/* RAL Swatch in Viewer (for RAL captures) */
.palette-viewer-ral-swatch {
  padding: 1rem;
  text-align: center;
}

.palette-viewer-ral-swatch-color {
  width: 100%;
  height: 4rem;
  border-radius: 0.8rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.palette-viewer-ral-swatch-info {
  padding: 0.5rem 0;
}

.palette-viewer-ral-swatch-code {
  font-weight: bold;
  font-size: 0.95rem;
  margin: 0;
}

.palette-viewer-ral-swatch-name {
  font-size: 0.85rem;
  opacity: 0.8;
  margin: 0;
}

.palette-viewer-ral-swatch-quality {
  font-size: 0.72rem;
  text-transform: uppercase;
  color: var(--accent-color, #ffc800);
  margin: 0;
}
```

- [ ] **Step 4: Update openPaletteViewerOverlay to handle RAL captures**

In `src/modules/collection/palette-viewer-overlay.js`:

Update the function signature to accept new params:

```javascript
export async function openPaletteViewerOverlay({
  colors = [],
  captureMode,
  ralMatch,
  getPreviewAsset,
  // ... rest unchanged
})
```

Add DOM references at top of module:

```javascript
const viewerRalSwatch = document.getElementById('catchDetailsRalSwatch');
const viewerRalSwatchColor = document.getElementById('catchDetailsRalSwatchColor');
const viewerRalSwatchCode = document.getElementById('catchDetailsRalSwatchCode');
const viewerRalSwatchName = document.getElementById('catchDetailsRalSwatchName');
const viewerRalSwatchQuality = document.getElementById('catchDetailsRalSwatchQuality');
```

Add rendering logic inside `openPaletteViewerOverlay`, after `resetViewerFrame()`:

```javascript
// Show RAL swatch for RAL captures, hide for palette captures
const isRalCapture = captureMode === 'ral' && ralMatch;
if (viewerRalSwatch) {
  viewerRalSwatch.hidden = !isRalCapture;
}

if (isRalCapture && ralMatch) {
  if (viewerRalSwatchColor) {
    viewerRalSwatchColor.style.backgroundColor = `rgb(${ralMatch.r}, ${ralMatch.g}, ${ralMatch.b})`;
  }
  if (viewerRalSwatchCode) viewerRalSwatchCode.textContent = ralMatch.code;
  if (viewerRalSwatchName) viewerRalSwatchName.textContent = ralMatch.name;
  if (viewerRalSwatchQuality) {
    viewerRalSwatchQuality.textContent = `${getRalQualityLabel(ralMatch.deltaE)} · ΔE ${ralMatch.deltaE.toFixed(1)}`;
  }
}
```

- [ ] **Step 5: Update palette-card.js to pass RAL data to viewer**

In `src/modules/collection/palette-card.js`, find the `openViewer()` function (around line 308-332) and update the `openPaletteViewerOverlay` call to include RAL data:

```javascript
openPaletteViewerOverlay({
  colors: palette.colors,
  captureMode: palette.captureMode,
  ralMatch: palette.ralMatch,
  // ... rest unchanged
});
```

- [ ] **Step 6: Verify in browser**

1. Capture something in RAL mode
2. Open it from the collection
3. Verify: single RAL swatch with code/name/quality, no palette strip
4. Open a normal palette capture — verify: palette strip as usual, no RAL swatch

- [ ] **Step 7: Commit**

```bash
git add types/app.d.ts src/modules/collection/palette-viewer-overlay.js src/modules/collection/palette-card.js public/index.html public/styles/panel.css
git commit -m "feat: adapt viewer overlay for RAL captures with single swatch display"
```

---

## Chunk 5: Tap-on-Swatch Popover & Collection Cards

### Task 10: Implement tap-on-swatch RAL popover in viewer

**Files:**
- Modify: `src/modules/collection/palette-viewer-overlay.js` (add popover logic)
- Modify: `public/index.html` (add popover container)
- Modify: `public/styles/panel.css` (popover styles)

- [ ] **Step 1: Add popover HTML**

In `public/index.html`, inside the viewer overlay panel, add a popover container (near the viewer content area):

```html
<div class="ral-popover" id="ralPopover" hidden>
  <div class="ral-popover-color" id="ralPopoverColor"></div>
  <p class="ral-popover-code" id="ralPopoverCode"></p>
  <p class="ral-popover-name" id="ralPopoverName"></p>
  <p class="ral-popover-quality" id="ralPopoverQuality"></p>
</div>
```

- [ ] **Step 2: Add popover CSS**

In `public/styles/panel.css`:

```css
/* RAL Popover for tap-on-swatch — uses position:fixed for viewport-relative coords from getBoundingClientRect */
.ral-popover {
  position: fixed;
  width: 140px;
  background: var(--primary-color, #222222);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 0.6rem;
  padding: 0.5rem;
  text-align: center;
  z-index: 1200;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.ral-popover[hidden] {
  display: none;
}

.ral-popover-color {
  width: 100%;
  height: 2.5rem;
  border-radius: 0.5rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.ral-popover-code {
  font-weight: bold;
  font-size: 0.78rem;
  margin: 0.3rem 0 0;
}

.ral-popover-name {
  font-size: 0.72rem;
  opacity: 0.8;
  margin: 0;
}

.ral-popover-quality {
  font-size: 0.62rem;
  text-transform: uppercase;
  color: var(--accent-color, #ffc800);
  margin: 0.2rem 0 0;
}
```

- [ ] **Step 3: Implement popover logic in viewer overlay**

In `src/modules/collection/palette-viewer-overlay.js`:

Add DOM references at module top:

```javascript
const ralPopover = document.getElementById('ralPopover');
const ralPopoverColor = document.getElementById('ralPopoverColor');
const ralPopoverCode = document.getElementById('ralPopoverCode');
const ralPopoverName = document.getElementById('ralPopoverName');
const ralPopoverQuality = document.getElementById('ralPopoverQuality');
```

Add import for `findClosestRAL` (update existing import):

```javascript
import { findClosestRAL, getRalQualityLabel } from '../color-matching-ral.js';
```

Add popover show/hide functions:

```javascript
function showRalPopover(color, anchorElement) {
  const matches = findClosestRAL(color.r, color.g, color.b, 1);
  if (matches.length === 0 || !ralPopover) return;

  const best = matches[0];

  if (ralPopoverColor) {
    ralPopoverColor.style.backgroundColor = `rgb(${best.ral.r}, ${best.ral.g}, ${best.ral.b})`;
  }
  if (ralPopoverCode) ralPopoverCode.textContent = best.ral.code;
  if (ralPopoverName) ralPopoverName.textContent = best.ral.name;
  if (ralPopoverQuality) {
    ralPopoverQuality.textContent = `${getRalQualityLabel(best.deltaE)} · ΔE ${best.deltaE.toFixed(1)}`;
  }

  // Position above the anchor, centered horizontally
  const anchorRect = anchorElement.getBoundingClientRect();
  const popoverWidth = 140;
  let left = anchorRect.left + (anchorRect.width / 2) - (popoverWidth / 2);
  let top = anchorRect.top - ralPopover.offsetHeight - 8;

  // Flip below if clipping top
  if (top < 0) {
    top = anchorRect.bottom + 8;
  }

  // Keep within viewport horizontally
  left = Math.max(8, Math.min(left, window.innerWidth - popoverWidth - 8));

  ralPopover.style.left = `${left}px`;
  ralPopover.style.top = `${top}px`;
  ralPopover.hidden = false;
}

function hideRalPopover() {
  if (ralPopover) {
    ralPopover.hidden = true;
  }
}
```

- [ ] **Step 4: Add tap listeners to palette swatches in viewer**

The palette swatches in the viewer are rendered as colored sections on the `#canvas-palette` or as individual swatch elements. Check the exact rendering in the viewer to determine the correct approach.

In `openPaletteViewerOverlay()`, after the colors are available, render clickable swatch elements for palette captures. Add a swatch strip container in the HTML if one doesn't exist for the viewer, and populate it with tappable swatch buttons:

In `openPaletteViewerOverlay()`, for palette captures (not RAL captures), add after the preview loading section:

```javascript
if (!isRalCapture && colors.length > 0) {
  renderViewerSwatches(colors);
}
```

Add the swatch rendering function:

```javascript
function renderViewerSwatches(colors) {
  const container = document.getElementById('catchDetailsSwatchStrip');
  if (!container) return;

  container.innerHTML = '';

  colors.forEach((color) => {
    const swatch = document.createElement('button');
    swatch.className = 'palette-viewer-swatch';
    swatch.style.backgroundColor = `rgb(${color.r}, ${color.g}, ${color.b})`;
    swatch.setAttribute('aria-label', `Voir correspondance RAL`);
    swatch.addEventListener('click', (event) => {
      event.stopPropagation();
      showRalPopover(color, swatch);
    });
    container.appendChild(swatch);
  });
}
```

Add to `public/index.html` in the viewer panel (where the palette strip area is):

```html
<div class="palette-viewer-swatch-strip" id="catchDetailsSwatchStrip"></div>
```

Add CSS for the swatch strip:

```css
.palette-viewer-swatch-strip {
  display: flex;
  gap: 0;
  width: 100%;
}

.palette-viewer-swatch {
  flex: 1;
  height: 2.5rem;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: transform 0.1s ease;
}

.palette-viewer-swatch:first-child {
  border-radius: 0.4rem 0 0 0.4rem;
}

.palette-viewer-swatch:last-child {
  border-radius: 0 0.4rem 0.4rem 0;
}

.palette-viewer-swatch:active {
  transform: scale(0.95);
}
```

- [ ] **Step 5: Add dismiss listener**

In `openPaletteViewerOverlay()`, add a document-level tap listener to dismiss the popover:

```javascript
document.addEventListener('click', hideRalPopover);
```

Add cleanup in the viewer close handler (find `handleViewerPanelClosing` or similar):

```javascript
document.removeEventListener('click', hideRalPopover);
hideRalPopover();
```

Also hide popover in `resetViewerFrame()`.

- [ ] **Step 6: Verify in browser**

1. Capture a palette (normal mode)
2. Open it in the viewer
3. Tap on a color swatch
4. Verify: popover appears above the swatch showing RAL match
5. Tap elsewhere — popover dismisses
6. Tap near the top of the screen — popover flips below

- [ ] **Step 7: Commit**

```bash
git add src/modules/collection/palette-viewer-overlay.js public/index.html public/styles/panel.css
git commit -m "feat: tap-on-swatch RAL popover in palette viewer"
```

---

### Task 11: Adapt collection cards for RAL captures

**Files:**
- Modify: `src/modules/collection/palette-card.js` (adapt card for single-color RAL captures)
- Modify: `public/styles/panel.css` (RAL card badge/indicator)

- [ ] **Step 1: Add RAL indicator to card rendering**

In `src/modules/collection/palette-card.js`, find the card creation section in `createPaletteCard()` (around lines 77-120).

After the publication badge, add a RAL indicator for RAL captures:

```javascript
if (palette.captureMode === 'ral') {
  const ralIndicator = document.createElement('span');
  ralIndicator.className = 'palette-card-ral-indicator';
  ralIndicator.textContent = 'RAL';
  card.appendChild(ralIndicator);
}
```

- [ ] **Step 2: Add RAL card indicator CSS**

In `public/styles/panel.css`:

```css
.palette-card-ral-indicator {
  position: absolute;
  top: 0.3rem;
  right: 0.3rem;
  font-size: 0.6rem;
  font-weight: bold;
  text-transform: uppercase;
  background: var(--accent-color, #ffc800);
  color: var(--primary-color, #222222);
  padding: 0.1rem 0.3rem;
  border-radius: 0.2rem;
  pointer-events: none;
}
```

- [ ] **Step 3: Verify in browser**

1. Capture something in RAL mode
2. Check the collection — card should show a "RAL" badge in the top-right
3. Normal palette cards should not have the badge

- [ ] **Step 4: Commit**

```bash
git add src/modules/collection/palette-card.js public/styles/panel.css
git commit -m "feat: RAL badge indicator on collection cards for RAL captures"
```

---

### Task 12: Final integration test and cleanup

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 2: Full manual QA in browser**

Test the complete flow:

**Palette mode (default):**
1. Open app — camera shows palette strip and swatch slider
2. Capture a photo — saved to collection with multi-color palette
3. Open capture in viewer — palette strip shown, no RAL section
4. Tap a swatch — RAL popover appears with match info
5. Tap elsewhere — popover dismisses

**RAL mode:**
1. Open settings — switch to RAL
2. Camera shows reticle, RAL swatch display, no palette strip/slider
3. Point at colored surface — swatch updates in real-time
4. Capture — saved to collection
5. Card shows "RAL" badge
6. Open capture in viewer — single large RAL swatch display
7. No tap-on-swatch (single color, already showing RAL)

**Mode switching:**
1. Switch back to Palette — camera restores palette strip and slider
2. Reload app — mode persisted correctly

- [ ] **Step 3: Run linter**

Run: `bun run lint`
Fix any lint errors.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: lint cleanup for RAL redesign"
```

- [ ] **Step 5: Final commit with all changes verified**

If no additional fixes needed, the implementation is complete.
