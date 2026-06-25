import { readFileSync } from "node:fs";
import { dirname, join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { traceExtraction } from "../src/modules/debug/extraction-trace.js";
import { selectPaletteHybrid } from "../src/modules/debug/hybrid-selector.js";
import { rgbToOklab } from "../src/modules/color-space-oklch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(__dirname);

async function decodeImage(path) {
  const ext = extname(path).toLowerCase();
  const buf = readFileSync(path);
  if (ext === ".png") {
    const png = PNG.sync.read(buf);
    return { data: png.data, width: png.width, height: png.height };
  }
  if (ext === ".jpg" || ext === ".jpeg") {
    const jpg = jpeg.decode(buf, { useTArray: true });
    return { data: jpg.data, width: jpg.width, height: jpg.height };
  }
  if (ext === ".webp") {
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  }
  return null;
}

function oklab(c) {
  const lab = rgbToOklab(c.r, c.g, c.b);
  return lab;
}

function dist(a, b) {
  return Math.hypot(a.L - b.L, a.a - b.a, a.b - b.b);
}

function hueName(lab) {
  const h = Math.atan2(lab.b, lab.a) * (180 / Math.PI);
  const hue = h < 0 ? h + 360 : h;
  if (Math.hypot(lab.a, lab.b) < 0.04) return "neutral";
  if (hue < 20 || hue >= 340) return "red";
  if (hue < 50) return "orange";
  if (hue < 70) return "yellow";
  if (hue < 160) return "green";
  if (hue < 200) return "cyan";
  if (hue < 260) return "blue";
  if (hue < 300) return "purple";
  return "pink";
}

function hex(c) {
  const to = (n) => Math.round(n).toString(16).padStart(2, "0");
  return `#${to(c.r)}${to(c.g)}${to(c.b)}`;
}

const imagePath = process.argv[2];
if (!imagePath) {
  console.error("usage: bun scripts/dump-trace.mjs <image-path-relative-to-public/assets/img>");
  process.exit(1);
}

const absPath = join(PROJECT_ROOT, "public/assets/img", imagePath);
const decoded = await decodeImage(absPath);
if (!decoded) {
  console.error(`could not decode ${absPath}`);
  process.exit(1);
}

const SWATCH_COUNT = Number(process.argv[3] ?? 6);
const REPULSION = Number(process.argv[4] ?? 0.055);
const VARIETY = 0.8;
const TONE = 0.85;

console.log(`=== ${imagePath} ===`);
console.log(`${decoded.width}x${decoded.height} pixels\n`);

const selectors = ["current", "new", "hybrid"];
const traces = {};
for (const selector of selectors) {
  traces[selector] = traceExtraction(decoded.data, decoded.width, decoded.height, SWATCH_COUNT, {}, {
    selector,
    repulsionRadius: REPULSION,
    spreadStrength: VARIETY,
    tone: TONE,
    maxScatterPoints: 100,
  });
}

console.log("--- selected swatches (sorted by lightness) ---");
for (const selector of selectors) {
  const sel = traces[selector].selected;
  console.log(`\n[${selector}] ${sel.length} swatches:`);
  for (let i = 0; i < sel.length; i++) {
    const s = sel[i];
    const lab = s.oklab;
    const c = Math.hypot(lab.a, lab.b);
    console.log(`  #${i + 1} ${hex(s.rgb)} rgb(${s.rgb.r},${s.rgb.g},${s.rgb.b}) L=${lab.L.toFixed(2)} chroma=${c.toFixed(3)} ${hueName(lab)}`);
  }
}

console.log("\n--- pairwise OKLab distances between selected (repulsion violations flagged) ---");
for (const selector of selectors) {
  const sel = traces[selector].selected;
  console.log(`\n[${selector}] (radius=${REPULSION})`);
  let violations = 0;
  for (let i = 0; i < sel.length; i++) {
    for (let j = i + 1; j < sel.length; j++) {
      const d = dist(sel[i].oklab, sel[j].oklab);
      const violated = d < REPULSION;
      if (violated) violations++;
      const flag = violated ? " *** VIOLATION" : "";
      console.log(`  #${i + 1}↔#${j + 1}: ${d.toFixed(3)}${flag}`);
    }
  }
  console.log(`  violations: ${violations}`);
}

console.log("\n--- candidates seen by each selector ---");
for (const selector of selectors) {
  const cands = traces[selector].candidates;
  console.log(`\n[${selector}] ${cands.length} candidates:`);
  const sorted = cands.slice().sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
  for (let i = 0; i < Math.min(sorted.length, 20); i++) {
    const c = sorted[i];
    const lab = c.oklab;
    const chroma = Math.hypot(lab.a, lab.b);
    console.log(`  ${hex(c.rgb)} L=${lab.L.toFixed(2)} chroma=${chroma.toFixed(3)} mass=${c.population ?? 0} ${hueName(lab)}`);
  }
}

console.log("\n--- hybrid internals: why each pick was made ---");
const hybridResult = selectPaletteHybrid(decoded.data, decoded.width, decoded.height, SWATCH_COUNT, {
  repulsionRadius: REPULSION,
  spreadStrength: VARIETY,
  tone: TONE,
  rarityStrength: 0.12,
});
console.log(`neutralThreshold: ${hybridResult.neutralThreshold.toFixed(4)}`);
console.log(`neutralCount: ${hybridResult.neutralCount}`);
console.log(`candidate count: ${hybridResult.candidates.length}`);
const hybCands = hybridResult.candidates
  .map((c, i) => ({ i, ...c, lab: rgbToOklab(c.meanRgb.r, c.meanRgb.g, c.meanRgb.b), vividLab: rgbToOklab(c.vividRgb.r, c.vividRgb.g, c.vividRgb.b) }))
  .sort((a, b) => b.mass - a.mass);
console.log("\nall candidates (mean + vivid, sorted by mass):");
for (const c of hybCands) {
  const meanChroma = Math.hypot(c.lab.a, c.lab.b);
  const vividChroma = Math.hypot(c.vividLab.a, c.vividLab.b);
  console.log(`  [#${c.i}] mean=${hex(c.meanRgb)} L=${c.lab.L.toFixed(2)} chroma=${meanChroma.toFixed(3)} | vivid=${hex(c.vividRgb)} chroma=${vividChroma.toFixed(3)} | mass=${c.mass} ${hueName(c.lab)}`);
}
