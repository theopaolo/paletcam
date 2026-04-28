import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SCAN_ROOT = "public";
const DEFAULT_LIT_SCAN_ROOT = "src";
const DEFAULT_OUTPUT_DIR = "output/css-audit";
const DEFAULT_MIN_OCCURRENCES = 2;
const CATEGORY_ORDER = [
  "color",
  "gradient",
  "shadow",
  "font-family",
  "font-size",
  "font-weight",
  "letter-spacing",
  "space",
  "radius",
  "duration",
  "easing",
  "z-index",
];
const CATEGORY_LABELS = {
  color: "Colors",
  duration: "Durations",
  easing: "Easings",
  "font-family": "Font Families",
  "font-size": "Font Sizes",
  "font-weight": "Font Weights",
  gradient: "Gradients",
  "letter-spacing": "Letter Spacing",
  radius: "Radii",
  shadow: "Shadows",
  space: "Spacing",
  "z-index": "Z-Indexes",
};
const CATEGORY_TOKEN_PREFIXES = {
  color: "color-raw",
  duration: "duration",
  easing: "easing",
  "font-family": "font-family",
  "font-size": "font-size",
  "font-weight": "font-weight",
  gradient: "gradient-raw",
  "letter-spacing": "tracking",
  radius: "radius",
  shadow: "shadow",
  space: "space",
  "z-index": "layer",
};
const COLOR_FUNCTION_NAMES = [
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "lab",
  "lch",
  "oklab",
  "oklch",
  "color",
];
const GRADIENT_FUNCTION_NAMES = [
  "linear-gradient",
  "radial-gradient",
  "conic-gradient",
  "repeating-linear-gradient",
  "repeating-radial-gradient",
  "repeating-conic-gradient",
];
const EASING_PATTERNS = [
  /\bcubic-bezier\([^)]*\)/gi,
  /\bsteps\([^)]*\)/gi,
  /\blinear\([^)]*\)/gi,
  /\bease-in-out\b/gi,
  /\bease-in\b/gi,
  /\bease-out\b/gi,
  /\bease\b/gi,
  /\blinear\b/gi,
];
const TIME_PATTERN = /-?(?:\d+|\d*\.\d+)(?:ms|s)\b/gi;
const LENGTH_PATTERN = /-?(?:\d+|\d*\.\d+)(?:px|rem|em|vw|vh|svh|dvh|ch|ex|lh|rlh)\b/gi;
const HEX_COLOR_PATTERN = /#[\da-f]{3,8}\b/gi;
const FONT_WEIGHT_PATTERN =
  /\b(?:100|200|300|400|500|600|700|800|900|normal|bold|lighter|bolder)\b/gi;
const Z_INDEX_PATTERN = /-?\d+/g;

function normalizeWhitespace(value) {
  return value.trim().replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")");
}

function normalizeValue(value, lowercase = false) {
  const normalized = normalizeWhitespace(value);
  return lowercase ? normalized.toLowerCase() : normalized;
}

function isZeroLike(value) {
  return /^(?:0|0px|0rem|0em|0vw|0vh|0svh|0dvh|0ch|0ex|0lh|0rlh)$/i.test(value);
}

function buildLineIndex(source) {
  const positions = [];

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      positions.push(index);
    }
  }

  return positions;
}

function getLineNumber(index, lineBreaks) {
  let low = 0;
  let high = lineBreaks.length;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);

    if (lineBreaks[middle] < index) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low + 1;
}

function stripComments(source) {
  let result = "";
  let index = 0;

  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];

    if (current === "/" && next === "*") {
      result += "  ";
      index += 2;

      while (index < source.length) {
        const innerCurrent = source[index];
        const innerNext = source[index + 1];

        if (innerCurrent === "*" && innerNext === "/") {
          result += "  ";
          index += 2;
          break;
        }

        result += innerCurrent === "\n" ? "\n" : " ";
        index += 1;
      }

      continue;
    }

    result += current;
    index += 1;
  }

  return result;
}

function extractLeafBlocks(source) {
  const blocks = [];
  const stack = [];
  let quote = "";

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }

      if (char === quote) {
        quote = "";
      }

      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "{") {
      if (stack.length > 0) {
        stack[stack.length - 1].hasNested = true;
      }

      stack.push({
        contentStart: index + 1,
        hasNested: false,
      });
      continue;
    }

    if (char === "}") {
      const block = stack.pop();

      if (block && !block.hasNested) {
        blocks.push({
          contentStart: block.contentStart,
          contentEnd: index,
        });
      }
    }
  }

  return blocks;
}

function findUnnestedColon(segment) {
  let quote = "";
  let parenDepth = 0;

  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index];

    if (quote) {
      if (char === "\\") {
        index += 1;
        continue;
      }

      if (char === quote) {
        quote = "";
      }

      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }

    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (char === ":" && parenDepth === 0) {
      return index;
    }
  }

  return -1;
}

function isDesignTokenFile(filePath) {
  return /(?:^|\/)(?:settings\.)?tokens\.css$/i.test(filePath);
}

export function parseDeclarations(source, filePath = "", { lineOffset = 0 } = {}) {
  const sanitized = stripComments(source);
  const lineBreaks = buildLineIndex(sanitized);
  const blocks = extractLeafBlocks(sanitized);
  const declarations = [];

  for (const block of blocks) {
    const blockContent = sanitized.slice(block.contentStart, block.contentEnd);
    let segmentStart = 0;
    let quote = "";
    let parenDepth = 0;

    const pushSegment = (segmentEnd) => {
      const segmentOffset = segmentStart;
      const segment = blockContent.slice(segmentStart, segmentEnd);
      const colonIndex = findUnnestedColon(segment);
      const trimmed = segment.trim();
      const trimmedOffset = segment.indexOf(trimmed);

      segmentStart = segmentEnd + 1;

      if (!trimmed || trimmed.startsWith("@") || colonIndex < 0) {
        return;
      }

      const property = segment.slice(0, colonIndex).trim();
      const value = segment.slice(colonIndex + 1).trim();

      if (!property || !value) {
        return;
      }

      declarations.push({
        filePath,
        line:
          getLineNumber(block.contentStart + segmentOffset + Math.max(0, trimmedOffset), lineBreaks) +
          lineOffset,
        property,
        value,
      });
    };

    for (let index = 0; index < blockContent.length; index += 1) {
      const char = blockContent[index];

      if (quote) {
        if (char === "\\") {
          index += 1;
          continue;
        }

        if (char === quote) {
          quote = "";
        }

        continue;
      }

      if (char === "'" || char === '"') {
        quote = char;
        continue;
      }

      if (char === "(") {
        parenDepth += 1;
        continue;
      }

      if (char === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
        continue;
      }

      if (char === ";" && parenDepth === 0) {
        pushSegment(index);
      }
    }

    if (segmentStart < blockContent.length) {
      pushSegment(blockContent.length);
    }
  }

  return declarations;
}

function extractFunctionCalls(value, functionNames) {
  const calls = [];
  const lowerValue = value.toLowerCase();

  for (const name of functionNames) {
    let searchIndex = 0;
    const needle = `${name.toLowerCase()}(`;

    while (searchIndex < lowerValue.length) {
      const startIndex = lowerValue.indexOf(needle, searchIndex);

      if (startIndex < 0) {
        break;
      }

      let index = startIndex + needle.length;
      let parenDepth = 1;
      let quote = "";

      while (index < value.length && parenDepth > 0) {
        const char = value[index];

        if (quote) {
          if (char === "\\") {
            index += 2;
            continue;
          }

          if (char === quote) {
            quote = "";
          }

          index += 1;
          continue;
        }

        if (char === "'" || char === '"') {
          quote = char;
          index += 1;
          continue;
        }

        if (char === "(") {
          parenDepth += 1;
        } else if (char === ")") {
          parenDepth -= 1;
        }

        index += 1;
      }

      calls.push(value.slice(startIndex, index));
      searchIndex = index;
    }
  }

  return calls;
}

function uniqueNormalizedValues(values, lowercase = false) {
  return [...new Set(values.map((value) => normalizeValue(value, lowercase)))];
}

function matchAllNormalized(value, pattern, lowercase = false) {
  return uniqueNormalizedValues(value.match(pattern) ?? [], lowercase);
}

function extractLengths(value) {
  return uniqueNormalizedValues(
    (value.match(LENGTH_PATTERN) ?? []).filter((length) => !isZeroLike(length)),
    true,
  );
}

function extractEasings(value) {
  const matches = [];

  for (const pattern of EASING_PATTERNS) {
    matches.push(...(value.match(pattern) ?? []));
  }

  return uniqueNormalizedValues(matches, true);
}

function isSpacingProperty(property) {
  return /^(?:margin|padding|gap|row-gap|column-gap|inset|top|right|bottom|left)/i.test(property);
}

function isRadiusProperty(property) {
  return /radius/i.test(property);
}

function isShadowProperty(property) {
  return /(?:box-shadow|text-shadow)$/i.test(property);
}

function shouldExtractFontFamily(property) {
  return /^font-family$/i.test(property);
}

function shouldExtractFontSize(property) {
  return /^font-size$/i.test(property);
}

function shouldExtractFontWeight(property) {
  return /^font-weight$/i.test(property);
}

function shouldExtractLetterSpacing(property) {
  return /^letter-spacing$/i.test(property);
}

function shouldExtractDuration(property) {
  return /^(?:transition|transition-duration|animation|animation-duration)$/i.test(property);
}

function shouldExtractEasing(property) {
  return /^(?:transition|transition-timing-function|animation|animation-timing-function)$/i.test(
    property,
  );
}

function shouldExtractZIndex(property) {
  return /^z-index$/i.test(property);
}

function formatUsageReference(usage) {
  return `${usage.filePath}:${usage.line}`;
}

function createAccumulator() {
  return {
    categories: new Map(),
    cssFileCount: 0,
    declarationCount: 0,
    designTokens: [],
    files: [],
    litSourceCount: 0,
    localCustomProperties: [],
  };
}

function recordOccurrence(accumulator, category, rawValue, declaration) {
  const normalizedValue = normalizeValue(rawValue, category !== "font-family");

  if (!normalizedValue || normalizedValue.includes("var(")) {
    return;
  }

  let categoryMap = accumulator.categories.get(category);

  if (!categoryMap) {
    categoryMap = new Map();
    accumulator.categories.set(category, categoryMap);
  }

  let entry = categoryMap.get(normalizedValue);

  if (!entry) {
    entry = {
      category,
      normalizedValue,
      properties: new Set(),
      sampleValue: rawValue.trim(),
      usages: [],
    };
    categoryMap.set(normalizedValue, entry);
  }

  entry.properties.add(declaration.property);
  entry.usages.push({
    filePath: declaration.filePath,
    line: declaration.line,
    property: declaration.property,
  });
}

function buildCandidateEntries(categoryMap, category, existingValueIndex, minOccurrences) {
  const entries = [];

  for (const entry of categoryMap.values()) {
    if (entry.usages.length < minOccurrences) {
      continue;
    }

    const matchingExistingTokens = existingValueIndex.get(entry.normalizedValue) ?? [];

    entries.push({
      category,
      normalizedValue: entry.normalizedValue,
      properties: [...entry.properties].sort((left, right) => left.localeCompare(right)),
      sampleValue: entry.sampleValue,
      suggestedName: null,
      usages: entry.usages
        .slice()
        .sort((left, right) =>
          formatUsageReference(left).localeCompare(formatUsageReference(right)),
        ),
      usageCount: entry.usages.length,
      matchingExistingTokens,
    });
  }

  const sortedEntries = entries.sort((left, right) => {
    if (right.usageCount !== left.usageCount) {
      return right.usageCount - left.usageCount;
    }

    return left.normalizedValue.localeCompare(right.normalizedValue);
  });

  let suggestedIndex = 1;

  for (const entry of sortedEntries) {
    if (entry.matchingExistingTokens.length > 0) {
      continue;
    }

    entry.suggestedName = `--${CATEGORY_TOKEN_PREFIXES[category]}-${String(suggestedIndex).padStart(2, "0")}`;
    suggestedIndex += 1;
  }

  return sortedEntries;
}

function createExistingValueIndex(existingTokens) {
  const index = new Map();

  for (const token of existingTokens) {
    const normalizedValue = normalizeValue(token.value, !token.value.includes('"'));
    const values = index.get(normalizedValue) ?? [];
    values.push(token.name);
    index.set(normalizedValue, values);
  }

  return index;
}

export function analyzeCssSources(files, { minOccurrences = DEFAULT_MIN_OCCURRENCES } = {}) {
  const accumulator = createAccumulator();
  accumulator.files = files
    .map((file) => file.sourceId ?? file.filePath)
    .sort((left, right) => left.localeCompare(right));

  for (const file of files) {
    if (file.kind === "lit-css") {
      accumulator.litSourceCount += 1;
    } else {
      accumulator.cssFileCount += 1;
    }

    const declarations = parseDeclarations(file.content, file.filePath, {
      lineOffset: file.lineOffset ?? 0,
    });
    accumulator.declarationCount += declarations.length;

    for (const declaration of declarations) {
      const { property, value } = declaration;

      if (property.startsWith("--")) {
        const tokenRecord = {
          filePath: declaration.filePath,
          line: declaration.line,
          name: property,
          value: normalizeValue(value),
        };

        if (isDesignTokenFile(declaration.filePath)) {
          accumulator.designTokens.push(tokenRecord);
        } else {
          accumulator.localCustomProperties.push(tokenRecord);
        }

        continue;
      }

      for (const color of matchAllNormalized(value, HEX_COLOR_PATTERN, true)) {
        recordOccurrence(accumulator, "color", color, declaration);
      }

      for (const colorFunction of uniqueNormalizedValues(
        extractFunctionCalls(value, COLOR_FUNCTION_NAMES).filter((item) => !item.includes("var(")),
        true,
      )) {
        recordOccurrence(accumulator, "color", colorFunction, declaration);
      }

      for (const gradient of uniqueNormalizedValues(
        extractFunctionCalls(value, GRADIENT_FUNCTION_NAMES),
        true,
      )) {
        recordOccurrence(accumulator, "gradient", gradient, declaration);
      }

      if (isShadowProperty(property)) {
        recordOccurrence(accumulator, "shadow", value, declaration);
      }

      if (shouldExtractFontFamily(property)) {
        recordOccurrence(accumulator, "font-family", value, declaration);
      }

      if (shouldExtractFontSize(property)) {
        recordOccurrence(accumulator, "font-size", value, declaration);
      }

      if (shouldExtractFontWeight(property)) {
        for (const fontWeight of matchAllNormalized(value, FONT_WEIGHT_PATTERN, true)) {
          recordOccurrence(accumulator, "font-weight", fontWeight, declaration);
        }
      }

      if (shouldExtractLetterSpacing(property)) {
        recordOccurrence(accumulator, "letter-spacing", value, declaration);
      }

      if (isSpacingProperty(property)) {
        for (const length of extractLengths(value)) {
          recordOccurrence(accumulator, "space", length, declaration);
        }
      }

      if (isRadiusProperty(property)) {
        for (const length of extractLengths(value)) {
          recordOccurrence(accumulator, "radius", length, declaration);
        }
      }

      if (shouldExtractDuration(property)) {
        for (const duration of matchAllNormalized(value, TIME_PATTERN, true)) {
          recordOccurrence(accumulator, "duration", duration, declaration);
        }
      }

      if (shouldExtractEasing(property)) {
        for (const easing of extractEasings(value)) {
          recordOccurrence(accumulator, "easing", easing, declaration);
        }
      }

      if (shouldExtractZIndex(property)) {
        for (const layer of matchAllNormalized(value, Z_INDEX_PATTERN, true)) {
          recordOccurrence(accumulator, "z-index", layer, declaration);
        }
      }
    }
  }

  accumulator.designTokens.sort((left, right) => left.name.localeCompare(right.name));
  accumulator.localCustomProperties.sort((left, right) => left.name.localeCompare(right.name));
  const existingValueIndex = createExistingValueIndex(accumulator.designTokens);
  const categories = {};
  let repeatedCandidateCount = 0;

  for (const category of CATEGORY_ORDER) {
    const categoryMap = accumulator.categories.get(category) ?? new Map();
    const entries = buildCandidateEntries(
      categoryMap,
      category,
      existingValueIndex,
      minOccurrences,
    );

    categories[category] = entries;
    repeatedCandidateCount += entries.length;
  }

  return {
    categories,
    cssFileCount: accumulator.cssFileCount,
    declarationCount: accumulator.declarationCount,
    designTokenCount: accumulator.designTokens.length,
    designTokens: accumulator.designTokens,
    files: accumulator.files,
    litSourceCount: accumulator.litSourceCount,
    localCustomPropertyCount: accumulator.localCustomProperties.length,
    localCustomProperties: accumulator.localCustomProperties,
    repeatedCandidateCount,
  };
}

export async function listCssFiles(rootDir) {
  const files = [];

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".css")) {
        files.push(entryPath);
      }
    }
  }

  try {
    await walk(rootDir);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return files;
    }

    throw error;
  }

  return files.sort((left, right) => left.localeCompare(right));
}

function isLitSourceFile(fileName) {
  return /\.(?:js|mjs|ts)$/i.test(fileName);
}

export function extractLitCssSources(source, filePath = "") {
  const matches = [];
  const lineBreaks = buildLineIndex(source);
  const pattern = /\bcss`([\s\S]*?)`/g;
  let match;
  let blockIndex = 0;

  while ((match = pattern.exec(source)) !== null) {
    const contentStartIndex = match.index + 4;

    matches.push({
      content: match[1],
      filePath,
      kind: "lit-css",
      lineOffset: getLineNumber(contentStartIndex, lineBreaks) - 1,
      sourceId: `${filePath}#lit-css-${blockIndex + 1}`,
    });

    blockIndex += 1;
  }

  return matches;
}

export async function listLitCssSources(rootDir, projectRoot = process.cwd()) {
  const files = [];

  async function walk(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      if (!entry.isFile() || !isLitSourceFile(entry.name)) {
        continue;
      }

      const filePath = relative(projectRoot, entryPath).split("\\").join("/");
      const content = await readFile(entryPath, "utf8");
      files.push(...extractLitCssSources(content, filePath));
    }
  }

  try {
    await walk(rootDir);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return files;
    }

    throw error;
  }

  return files.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

export async function analyzeCssDirectory({
  projectRoot = process.cwd(),
  litScanRoot = DEFAULT_LIT_SCAN_ROOT,
  scanRoot = DEFAULT_SCAN_ROOT,
  minOccurrences = DEFAULT_MIN_OCCURRENCES,
} = {}) {
  const absoluteScanRoot = resolve(projectRoot, scanRoot);
  const filePaths = await listCssFiles(absoluteScanRoot);
  const cssFiles = await Promise.all(
    filePaths.map(async (filePath) => ({
      content: await readFile(filePath, "utf8"),
      filePath: relative(projectRoot, filePath).split("\\").join("/"),
      kind: "css",
    })),
  );
  const litFiles = await listLitCssSources(resolve(projectRoot, litScanRoot), projectRoot);
  const files = [...cssFiles, ...litFiles];

  return analyzeCssSources(files, { minOccurrences });
}

function renderUsageList(usages, limit = 4) {
  return usages
    .slice(0, limit)
    .map((usage) => `\`${formatUsageReference(usage)}\``)
    .join(", ");
}

function renderMarkdownReport(report, { litScanRoot, scanRoot, minOccurrences }) {
  const scanSummary = report.litSourceCount
    ? `Scanned ${report.files.length} style sources: ${report.cssFileCount} CSS files under \`${scanRoot}\` and ${report.litSourceCount} Lit \`css\`\` blocks under \`${litScanRoot}\`.`
    : `Scanned ${report.files.length} CSS files under \`${scanRoot}\`.`;
  const lines = [
    "# CSS Token Audit",
    "",
    scanSummary,
    "",
    `- Declarations parsed: ${report.declarationCount}`,
    `- Design tokens in token files: ${report.designTokenCount}`,
    `- Local custom properties outside token files: ${report.localCustomPropertyCount}`,
    `- Repeated raw token candidates (threshold: ${minOccurrences}+): ${report.repeatedCandidateCount}`,
    "",
    "## Design Tokens",
    "",
  ];

  if (report.designTokens.length === 0) {
    lines.push("No design tokens found in token files.", "");
  } else {
    for (const token of report.designTokens) {
      lines.push(`- \`${token.name}\` = \`${token.value}\` in \`${token.filePath}:${token.line}\``);
    }
    lines.push("");
  }

  lines.push("## Local Custom Properties", "");

  if (report.localCustomProperties.length === 0) {
    lines.push("No local custom properties found outside token files.", "");
  } else {
    for (const token of report.localCustomProperties) {
      lines.push(`- \`${token.name}\` = \`${token.value}\` in \`${token.filePath}:${token.line}\``);
    }
    lines.push("");
  }

  lines.push("## Repeated Raw Values", "");

  for (const category of CATEGORY_ORDER) {
    const entries = report.categories[category] ?? [];

    if (entries.length === 0) {
      continue;
    }

    lines.push(`### ${CATEGORY_LABELS[category]}`, "");

    for (const entry of entries) {
      const suggested = entry.matchingExistingTokens.length
        ? `reuse ${entry.matchingExistingTokens.map((name) => `\`${name}\``).join(", ")}`
        : `promote as \`${entry.suggestedName}\``;

      lines.push(
        `- \`${entry.sampleValue}\``,
        `  Uses: ${entry.usageCount}. Properties: ${entry.properties.join(", ")}. Suggestion: ${suggested}.`,
        `  Sample refs: ${renderUsageList(entry.usages)}.`,
      );
    }

    lines.push("");
  }

  lines.push(
    "## Notes",
    "",
    report.litSourceCount
      ? `- This audit scans both \`.css\` files under \`${scanRoot}\` and Lit \`css\`\` template literals under \`${litScanRoot}\`.`
      : "- This audit scans `.css` files under the configured root.",
    "- Values already defined as custom properties are listed separately so you can distinguish existing token coverage from raw duplication.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function renderTokenCss(report) {
  const lines = [":root {"];

  for (const category of CATEGORY_ORDER) {
    const entries = (report.categories[category] ?? []).filter((entry) => entry.suggestedName);

    if (entries.length === 0) {
      continue;
    }

    lines.push(`  /* ${CATEGORY_LABELS[category]} */`);

    for (const entry of entries) {
      lines.push(
        `  /* ${entry.usageCount} uses across ${entry.properties.join(", ")} */`,
        `  ${entry.suggestedName}: ${entry.sampleValue};`,
      );
    }

    lines.push("");
  }

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  lines.push("}");
  return `${lines.join("\n")}\n`;
}

function renderConsoleSummary(report) {
  const sourceSummary = report.litSourceCount
    ? `Scanned ${report.files.length} style sources (${report.cssFileCount} CSS files, ${report.litSourceCount} Lit blocks) and parsed ${report.declarationCount} declarations.`
    : `Scanned ${report.files.length} CSS files and parsed ${report.declarationCount} declarations.`;
  const lines = [
    sourceSummary,
    `Found ${report.designTokenCount} design tokens, ${report.localCustomPropertyCount} local custom properties, and ${report.repeatedCandidateCount} repeated raw token candidates.`,
    "",
    "Top candidates:",
  ];

  for (const category of CATEGORY_ORDER) {
    const entries = report.categories[category] ?? [];

    if (entries.length === 0) {
      continue;
    }

    for (const entry of entries.slice(0, 3)) {
      lines.push(`- ${CATEGORY_LABELS[category]}: ${entry.sampleValue} (${entry.usageCount} uses)`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function parseCliArgs(argv) {
  const args = {
    litScanRoot: DEFAULT_LIT_SCAN_ROOT,
    minOccurrences: DEFAULT_MIN_OCCURRENCES,
    outputDir: DEFAULT_OUTPUT_DIR,
    scanRoot: DEFAULT_SCAN_ROOT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--scan-root" && next) {
      args.scanRoot = next;
      index += 1;
      continue;
    }

    if (arg === "--out-dir" && next) {
      args.outputDir = next;
      index += 1;
      continue;
    }

    if (arg === "--lit-scan-root" && next) {
      args.litScanRoot = next;
      index += 1;
      continue;
    }

    if (arg === "--min-occurrences" && next) {
      const parsed = Number(next);

      if (Number.isFinite(parsed) && parsed >= 1) {
        args.minOccurrences = parsed;
      }

      index += 1;
    }
  }

  return args;
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  const projectRoot = process.cwd();
  const report = await analyzeCssDirectory({
    litScanRoot: args.litScanRoot,
    minOccurrences: args.minOccurrences,
    projectRoot,
    scanRoot: args.scanRoot,
  });
  const outputDir = resolve(projectRoot, args.outputDir);

  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "report.md"), renderMarkdownReport(report, args), "utf8");
  await writeFile(join(outputDir, "tokens.css"), renderTokenCss(report), "utf8");
  await writeFile(join(outputDir, "tokens.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(renderConsoleSummary(report));
  process.stdout.write(
    `Outputs written to ${relative(projectRoot, outputDir).split("\\").join("/")}\n`,
  );
}

const entryFilePath = fileURLToPath(import.meta.url);

if (process.argv[1] && resolve(process.argv[1]) === entryFilePath) {
  await runCli();
}
