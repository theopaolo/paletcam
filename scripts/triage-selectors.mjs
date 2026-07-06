import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { traceExtraction } from "../src/modules/debug/extraction-trace.js";
import { rgbToOklab } from "../src/modules/color-space-oklch.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = dirname(__dirname);
const IMG_DIR = join(PROJECT_ROOT, "public/assets/img");
const SWATCH_COUNT = 6;

function listImages(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listImages(path));
    } else {
      const ext = extname(entry.name).toLowerCase();
      if (ext === ".jpg" || ext === ".jpeg" || ext === ".png") {
        out.push(path);
      }
    }
  }
  return out;
}

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

function paletteToOklab(colors) {
  return colors.map((c) => rgbToOklab(c.r, c.g, c.b));
}

function matchDistance(paletteA, paletteB) {
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

function meanChroma(colors) {
  if (colors.length === 0) return 0;
  let sum = 0;
  for (const c of colors) {
    const lab = rgbToOklab(c.r, c.g, c.b);
    sum += Math.hypot(lab.a, lab.b);
  }
  return sum / colors.length;
}

function duplicateCount(colors) {
  const seen = new Set();
  let dups = 0;
  for (const c of colors) {
    const key = `${c.r},${c.g},${c.b}`;
    if (seen.has(key)) dups++;
    else seen.add(key);
  }
  return dups;
}

const images = listImages(IMG_DIR);
console.log(`Triaging ${images.length} images (jpg/png only), swatchCount=${SWATCH_COUNT}\n`);

const rows = [];
const selectors = ["current", "new", "hybrid"];

for (const path of images) {
  const decoded = decodeImage(path);
  if (!decoded) continue;

  const rel = path.replace(`${IMG_DIR}/`, "");
  const perSelector = {};
  for (const selector of selectors) {
    try {
      const r = traceExtraction(
        decoded.data,
        decoded.width,
        decoded.height,
        SWATCH_COUNT,
        {},
        {
          selector,
          maxScatterPoints: 100,
        },
      );
      perSelector[selector] = {
        colors: r.selected.map((s) => s.rgb),
        neutrals: r.stats.neutralCount ?? null,
      };
    } catch (error) {
      perSelector[selector] = { colors: [], neutrals: null, error: error.message };
    }
  }

  const cur = perSelector.current.colors;
  const neu = perSelector.new.colors;
  const hyb = perSelector.hybrid.colors;

  rows.push({
    image: rel,
    curChroma: meanChroma(cur),
    newChroma: meanChroma(neu),
    hybChroma: meanChroma(hyb),
    curNeutrals: perSelector.current.neutrals,
    newNeutrals: perSelector.new.neutrals,
    hybNeutrals: perSelector.hybrid.neutrals,
    hybDups: duplicateCount(hyb),
    newDups: duplicateCount(neu),
    hybVsNew: matchDistance(hyb, neu),
    hybVsCur: matchDistance(hyb, cur),
    newVsCur: matchDistance(neu, cur),
  });
}

rows.sort((a, b) => b.hybVsNew - a.hybVsNew);

console.log(
  "image".padEnd(40),
  "hybVsNew",
  "hybVsCur",
  "newVsCur",
  "hybChroma",
  "newChroma",
  "hybDup",
  "newDup",
);
console.log("-".repeat(110));
for (const r of rows) {
  console.log(
    r.image.slice(0, 40).padEnd(40),
    r.hybVsNew.toFixed(3).padStart(8),
    r.hybVsCur.toFixed(3).padStart(8),
    r.newVsCur.toFixed(3).padStart(8),
    r.hybChroma.toFixed(3).padStart(9),
    r.newChroma.toFixed(3).padStart(9),
    String(r.hybDups).padStart(7),
    String(r.newDups).padStart(7),
  );
}

const avg = (key) => rows.reduce((s, r) => s + r[key], 0) / rows.length;
console.log("\n=== aggregates ===");
console.log(`images:            ${rows.length}`);
console.log(`avg hybVsNew:      ${avg("hybVsNew").toFixed(3)}  (lower = Hybrid closer to New)`);
console.log(`avg hybVsCur:      ${avg("hybVsCur").toFixed(3)}  (lower = Hybrid closer to Current)`);
console.log(
  `avg newVsCur:      ${avg("newVsCur").toFixed(3)}  (baseline: New vs Current divergence)`,
);
console.log(`avg hybChroma:     ${avg("hybChroma").toFixed(3)}  (higher = more vivid)`);
console.log(`avg newChroma:     ${avg("newChroma").toFixed(3)}  (baseline: New's vividness)`);
console.log(`avg curChroma:     ${avg("curChroma").toFixed(3)}  (baseline: Current's vividness)`);
console.log(`images w/ hyb dups: ${rows.filter((r) => r.hybDups > 0).length}`);
console.log(`images w/ new dups: ${rows.filter((r) => r.newDups > 0).length}`);

const tolerance = 0.1;
const outOfTolerance = rows.filter((r) => r.hybVsNew > tolerance);
console.log(
  `\nOracle tolerance gate (hybVsNew < ${tolerance}): ${outOfTolerance.length}/${rows.length} images OUT`,
);
if (outOfTolerance.length > 0) {
  console.log("worst offenders:");
  for (const r of outOfTolerance.slice(0, 8)) {
    console.log(
      `  ${r.image}  hybVsNew=${r.hybVsNew.toFixed(3)}  hybChroma=${r.hybChroma.toFixed(3)} newChroma=${r.newChroma.toFixed(3)} hybDup=${r.hybDups}`,
    );
  }
}
