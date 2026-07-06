import { readFileSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { traceExtraction } from "../src/modules/debug/extraction-trace.js";
import { rgbToOklab } from "../src/modules/color-space-oklch.js";
import { createColorSmoother } from "../src/modules/color-smoothing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(__dirname);

function decodeImage(path) {
  const buf = readFileSync(path);
  const ext = extname(path).toLowerCase();
  if (ext === ".png") {
    const png = PNG.sync.read(buf);
    return { data: png.data, width: png.width, height: png.height };
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    const jpg = jpeg.decode(buf, { useTArray: true });
    return { data: jpg.data, width: jpg.width, height: jpg.height };
  }
  return null;
}

function perturb(data, noise) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const n = (Math.random() - 0.5) * 2 * noise;
      out[i + c] = Math.max(0, Math.min(255, data[i + c] + n));
    }
    out[i + 3] = data[i + 3];
  }
  return out;
}

function paletteToOklab(colors) {
  return colors.map((c) => rgbToOklab(c.r, c.g, c.b));
}

function frameDrift(paletteA, paletteB) {
  if (paletteA.length === 0 || paletteB.length === 0) return Infinity;
  const labA = paletteToOklab(paletteA);
  const labB = paletteToOklab(paletteB);
  let total = 0;
  for (const a of labA) {
    let min = Infinity;
    for (const b of labB) {
      const d = Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
      if (d < min) min = d;
    }
    total += min;
  }
  return total / labA.length;
}

function positionDrift(paletteA, paletteB) {
  if (paletteA.length === 0 || paletteB.length === 0) return Infinity;
  const labA = paletteToOklab(paletteA);
  const labB = paletteToOklab(paletteB);
  const n = Math.min(labA.length, labB.length);
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += Math.hypot(labA[i].L - labB[i].L, labA[i].a - labB[i].a, labA[i].b - labB[i].b);
  }
  return total / n;
}

const TEST_IMAGES = [
  "public/assets/img/01.jpg",
  "public/assets/img/05.jpg",
  "public/assets/img/12.jpg",
  "public/assets/img/21.png",
  "public/assets/img/fish.jpeg",
  "public/assets/img/northern-lights.jpeg",
  "public/assets/img/17.jpg",
];

const FRAME_COUNT = 20;
const NOISE = 12;
const SWATCH_COUNT = 6;
const SELECTORS = ["current", "new", "hybrid"];
const SMOOTHING_FACTOR = 0.16;

console.log(
  `Jitter test: ${FRAME_COUNT} frames, noise=±${NOISE}/channel, swatchCount=${SWATCH_COUNT}`,
);
console.log(`With production smoother (factor=${SMOOTHING_FACTOR}) — matches what the user sees\n`);

const allResults = [];

for (const imgPath of TEST_IMAGES) {
  const absPath = join(PROJECT_ROOT, imgPath);
  const decoded = decodeImage(absPath);
  if (!decoded) {
    console.log(`skip ${imgPath}: unsupported format`);
    continue;
  }

  const frames = [{ data: decoded.data, width: decoded.width, height: decoded.height }];
  for (let f = 1; f < FRAME_COUNT; f++) {
    frames.push({
      data: perturb(decoded.data, NOISE),
      width: decoded.width,
      height: decoded.height,
    });
  }

  const perSelector = {};
  for (const selector of SELECTORS) {
    const smoother = createColorSmoother();
    const palettes = [];
    for (const frame of frames) {
      const r = traceExtraction(
        frame.data,
        frame.width,
        frame.height,
        SWATCH_COUNT,
        {},
        {
          selector,
          maxScatterPoints: 100,
        },
      );
      const rawColors = r.selected.map((s) => ({ ...s.rgb }));
      const smoothed = smoother.smooth(rawColors, SMOOTHING_FACTOR);
      palettes.push(smoothed);
    }

    let nnDrift = 0;
    let posDrift = 0;
    for (let f = 1; f < palettes.length; f++) {
      nnDrift += frameDrift(palettes[f - 1], palettes[f]);
      posDrift += positionDrift(palettes[f - 1], palettes[f]);
    }
    const count = palettes.length - 1;
    perSelector[selector] = {
      nnDrift: nnDrift / count,
      posDrift: posDrift / count,
    };
  }

  const rel = imgPath.replace("public/assets/img/", "");
  allResults.push({ image: rel, perSelector });

  console.log(
    rel.slice(0, 35).padEnd(35),
    "  nn-drift:",
    `cur=${perSelector.current.nnDrift.toFixed(3)}`.padStart(16),
    `new=${perSelector.new.nnDrift.toFixed(3)}`.padStart(16),
    `hyb=${perSelector.hybrid.nnDrift.toFixed(3)}`.padStart(16),
    "  pos-drift:",
    `cur=${perSelector.current.posDrift.toFixed(3)}`.padStart(16),
    `new=${perSelector.new.posDrift.toFixed(3)}`.padStart(16),
    `hyb=${perSelector.hybrid.posDrift.toFixed(3)}`.padStart(16),
  );
}

console.log("\n=== aggregates (avg across images) ===");
const avg = (sel, key) =>
  allResults.reduce((s, r) => s + r.perSelector[sel][key], 0) / allResults.length;

console.log(`nearest-neighbor drift (swatch identity agnostic — lower = more stable):`);
console.log(`  current: ${avg("current", "nnDrift").toFixed(4)}`);
console.log(`  new:     ${avg("new", "nnDrift").toFixed(4)}`);
console.log(`  hybrid:  ${avg("hybrid", "nnDrift").toFixed(4)}`);
console.log(`positional drift (same slot, frame-to-frame — lower = less shimmer):`);
console.log(`  current: ${avg("current", "posDrift").toFixed(4)}`);
console.log(`  new:     ${avg("new", "posDrift").toFixed(4)}`);
console.log(`  hybrid:  ${avg("hybrid", "posDrift").toFixed(4)}`);

const nn = {
  cur: avg("current", "nnDrift"),
  neu: avg("new", "nnDrift"),
  hyb: avg("hybrid", "nnDrift"),
};
const pos = {
  cur: avg("current", "posDrift"),
  neu: avg("new", "posDrift"),
  hyb: avg("hybrid", "posDrift"),
};
console.log(
  `\nhybrid vs current: nn ${((nn.hyb / nn.cur - 1) * 100).toFixed(1)}%, pos ${((pos.hyb / pos.cur - 1) * 100).toFixed(1)}%`,
);
console.log(
  `hybrid vs new:     nn ${((nn.hyb / nn.neu - 1) * 100).toFixed(1)}%, pos ${((pos.hyb / pos.neu - 1) * 100).toFixed(1)}%`,
);
