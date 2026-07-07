# Palette extraction refactor — working notes

Status as of 2026-06-22. Branch: `pwa/prod`. Nothing here is in the shipped app yet — all new work lives in a **debug harness**. The production pipeline is unchanged in behaviour (only cleaned up).

> **Update (2026-07):** the New selector described below has since shipped as `src/modules/hybrid-selector.js` (the "perceptual" selector). This file remains as the historical record of how the design was chosen; for a full explanation of the pipeline as it exists today — theory, every stage, diagrams — see **[extraction-pipeline.md](extraction-pipeline.md)**.

---

## 1. Why

PaletCam is a **live camera** palette tool. The extraction had three structural problems, confirmed visually with the debug harness across ~216 test images:

1. **Muting** — every displayed swatch is an *average* (median-cut box mean → 3-frame temporal mean → lerp). Averages pull toward grey, so vivid colors come out muddy.
2. **Missed colors** — neutrals (black/white) were never reserved, small-but-salient colors (a pink tray, yellow text) got out-massed, and one dominant hue (red) could claim every slot.
3. **Needs per-image tuning** — the 5 scorer weights (Vivid/Light-Dark/Rare hue/Spread + population) had to be hand-tuned per image to get a good result. **Impossible on a live feed**, and users found the sliders confusing.

The win condition for a live tool is **good with zero tuning**. That reframed everything: the goal is a selector that's good by default and exposes at most 2–3 intuitive knobs.

---

## 2. Two phases of work

### Phase A — maintainability cleanup (done, safe, could ship)

Pure cleanup of the existing pipeline, no behaviour change. All 38 test files pass, app bundles, Biome clean.

- Removed the **OKLCH-into-ARGB-int quantization hack** (`packImageDataToOklchArgb`/`swatchOklchToRgb`) — it mangled reds via hue-wrap. Quantization is RGB-only now.
- Removed the now-inert **`colorSpace` setting** from `app-settings.js`, `algorithm-settings.js`, and their tests.
- Extracted **`createColorSmoother()`** factory (`src/modules/color-smoothing.js`) out of module-global state in `palette-extraction.js`; `live-preview-controller.js` owns one instance.
- New **`src/modules/color-math.js`** (`srgbToLinear`, `rgbToHsl`, `rgbDistance(Squared)`) — de-duplicated 3 copies of `rgbToHsl`, 2 of `srgbToLinear`, and scattered distance helpers.
- Cleaned **`color-cut-quantizer.js`** — removed the unused HSL filter system and Android-parity cruft.
- Collapsed dead pool-size constants in `palette-extract-median-cut.js`; removed dead barrel re-exports in `palette-extraction.js`.
- Added **`rgbToOklab`** (Cartesian) to `color-space-oklch.js`; `rgbToOklch` now derives from it. **Rule going forward: do geometry (distance/averaging/clustering) in OKLab (L,a,b); derive C/H only for labels.** Hue is an angle — never do linear math on it.

`palette-color.js` (rich color wrapper) is intentionally **kept though currently unused** — planned for a future "polaroid verso" feature (flip a gallery polaroid to show palette + color codes + names).

### Phase B — the new extraction pipeline (prototype, in the harness)

A new selector built and A/B-tested against production in the debug harness. **This is the chosen direction**, not yet ported to the app.

---

## 3. The debug harness — how to run it

```bash
bun run scripts/dev-server.js     # serves on http://localhost:3000
```

Open **http://localhost:3000/debug-extraction.html**.

- **Gallery** (left): auto-populated from `public/assets/img/**` via the dev-server endpoint `GET /debug/images.json` (grouped by `sets/<Name>/` subfolder). Drop images in, refresh, they appear.
- **Scatter** (center): the image's pixels plotted in **OKLab** — vertical axis = L (lightness), the central vertical line = the neutral/grey spine, the horizontal plane = `+a red / −a green` and `+b yellow / −b blue`. Distance from the spine = chroma, angle = hue. Drag to orbit, **Shift/right-drag to pan**, wheel to zoom (up to 12×), double-click to reset.
- **Layers**: Pixels / Candidates (cluster reps) / Selected (numbered final swatches) / Repulsion (translucent spheres = the min-distance ball around each pick).
- **Selector** dropdown: **Current** (production median-cut + scorer) vs **New** (experimental). This is the A/B.
- **Source preview** (top-right): click to enlarge the source image.
- Footer: stats (lightness, chroma, spread, sparse, counts, reserved neutrals, neutral threshold).

The harness composes the **real** pipeline primitives — it is not a re-implementation. `extraction-trace.js` runs the actual stages and returns intermediates for plotting.

---

## 4. The New selector — algorithm

`src/modules/debug/experimental-selector.js` → `selectPaletteExperimental(imageData, w, h, swatchCount, params)`.

Pipeline, all in OKLab:

1. **Sample** pixels (stride, capped by `maxQuantizerPixels`) → OKLab.
2. **Adaptive neutral threshold** from the 90th chroma percentile, with a **dominant-near-neutral lift**: if half the pixels are barely chromatic (a cream/grey field), raise the threshold above that mass so it reads as a neutral. Floor 0.02, cap ~0.06.
3. **Split** neutral vs chromatic pixels.
4. **Reserve achromatic slots** by lightness band (dark/mid/light), heaviest first, proportional to neutral mass. A band must hold **≥5% of pixels** to earn a slot (kills invisible anti-alias greys). Representative = cleanest (lowest-chroma) pixel near the band median.
5. **Grid-cluster** the chromatic pixels in OKLab cells. Each cluster keeps mean L/a/b, mass, its **highest-chroma pixel** (vivid rep) and its **mean RGB** (soft rep).
6. **Phantom guard** — drop tiny clusters, **but rescue** a tiny cluster that's genuinely vivid (`chroma ≥ chromaKeep && mass ≥ ~0.1%`), so a rare saturated accent survives.
7. **Greedy select** with a **hard repulsion radius** floor; each pick maximizes
   `chromaNorm + Variety·hueSpread + rarity·(1−massNorm)`,
   where `hueSpread` = min angular hue gap to already-picked colors. Relax to farthest-from-chosen if the radius can't be satisfied. This is what stops one hue (red) from claiming every slot.
8. **Representative pixel** — **Tone** blends each chromatic rep between the cluster mean (soft, tone→0) and its highest-chroma real pixel (vivid, tone→1). This is the anti-muting move.
9. Sort by lightness.

`suggestSelectorParams(imageData, w, h)` → `{ variety, distinctness }`: derives per-image defaults — chroma-weighted **hue concentration** drives Variety (concentrated image → more Variety to surface its other hues), **ab-plane spread** drives Distinctness.

---

## 5. The decision & the final control surface

**New wins** for a live tool: it's good at defaults almost everywhere; its misses were two narrow bugs (now fixed). Current can match it but only with per-image hand-tuning — a disqualifier for a live feed.

**Final control surface** (replaces the 5 interacting scorer weights):

| Knob | Internal | Default | Meaning |
|------|----------|---------|---------|
| **Variety** | hue-spread strength `spreadStrength` (0–1) | ~0.8 (auto) | monochrome ↔ rainbow |
| **Distinctness** | repulsion radius (OKLab) | ~0.06 (auto) | how separated swatches must be |
| **Tone** | rep blend mean↔peak (0–1) | 0.85 | soft/muted ↔ vivid |
| **Auto** | runs `suggestSelectorParams` | on | preset Variety + Distinctness from the image |

Everything else is **automatic**: neutral reservation, neutral threshold, phantom guard, representative-pixel pass, rarity (fixed internal `0.12`). For the app: ship default-good with Auto, expose **Variety** (+ swatch count) prominently, tuck Distinctness/Tone under "Advanced".

**Out of scope (intentional):** sub-0.1% accents (e.g. tiny Sony blue text) — they're filtered as noise before scoring; chasing them injects speckle everywhere.

---

## 6. Key files

New (all debug-only except color-math/color-smoothing/rgbToOklab):
- `public/debug-extraction.html` — harness page (design-token styled, `noindex`).
- `src/debug-extraction.js` — harness entry: gallery, controls, Auto, scene wiring.
- `src/modules/debug/experimental-selector.js` — **the New pipeline** + `suggestSelectorParams`.
- `src/modules/debug/extraction-trace.js` — runs real stages, returns intermediates; branches Current vs New.
- `src/modules/debug/oklab-scatter.js` — reusable Canvas-2D OKLab 3D scatter (orbit/pan/zoom).
- `src/modules/color-math.js`, `src/modules/color-smoothing.js` (+ test) — Phase A.

Modified: `scripts/dev-server.js` (added `/debug/images.json`), `color-space-oklch.js` (`rgbToOklab`), plus the Phase A cleanups listed in §2.

Production extraction (unchanged behaviour): `palette-extraction.js`, `palette-extract-median-cut.js`, `color-cut-quantizer.js`, `palette-scoring.js`, `palette-pixel-pack.js`, worker in `src/workers/palette-extraction.worker.js` + controller `src/modules/palette-extraction-worker.js`.

Also see memory: `memory/project-palette-extraction.md`.

---

## 7. Next moves

1. **Tune `suggestSelectorParams`** by gallery pass — the adaptive formulas are sane first cuts, not tuned. Watch the Auto defaults across images; where they fall short, adjust the variety/distinctness mappings (it's live in the harness).
2. **Decide the "fewer colors than requested" behaviour** — when an image genuinely has few distinct colors, New returns fewer swatches rather than padding with near-duplicates. The app renders N bars, so decide: pad (with tints / next-best) or show fewer.
3. **Port New into the app behind a flag** — replace `rankQuantizedCandidates` selection in `palette-extract-median-cut.js` (or add a parallel path). Keep median-cut as the quantizer/candidate source (cheap, temporally stable for video); the selection + representative-pixel logic is the new part. Run it in the existing worker.
4. **Temporal stability for live video** — the representative pixel can shimmer frame-to-frame on a live feed. Robustify (e.g. high-chroma *percentile* instead of single peak pixel) and reconcile with `createColorSmoother` (smooth the *selection*, keep the displayed color vivid with a chroma floor).
5. **Replace the app's 5 scorer sliders** with Variety (+ Advanced: Distinctness, Tone), wired to the adaptive defaults.
6. **Keep the harness out of the prod build** (`scripts/build.js`) — it's dev-only; the `/debug/images.json` endpoint is dev-server-only already.

## 8. Gotchas

- **OKLab vs OKLCH**: same space, different coordinates. Do geometry in OKLab (a,b linear, no wrap); derive chroma/hue only for labels. The old hue-wrap bug is gone but don't reintroduce it.
- The **production scorer runs in "classic" (HSL) mode** today (the perceptual/OKLab path in `palette-scoring.js` is built but dormant). The New selector is OKLab-native and bypasses it.
- Quantizer **mutates its input array** — the trace passes a copy (`Int32Array.from(packed)`).
- Tone's effect is subtle on tight clusters, pronounced on broad real-photo regions.
