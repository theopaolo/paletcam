import { dirname, join, normalize } from "node:path";

const STATIC_IMPORT_PATTERN = /\bimport\s*(?:[^"'(]*?\bfrom\s*)?["']([^"']+)["']/g;
const STATIC_REEXPORT_PATTERN = /\bexport\s*[^;"']*?\bfrom\s*["']([^"']+)["']/g;

export function extractStaticImportSpecifiers(source) {
  const text = String(source);
  return [...text.matchAll(STATIC_IMPORT_PATTERN), ...text.matchAll(STATIC_REEXPORT_PATTERN)].map(
    (match) => match[1],
  );
}

/** Resolves synchronously loaded ESM files. Dynamic import() targets are excluded. */
export async function collectInitialJsFiles({ entrypoints, hasFile, readSource }) {
  const pending = [...entrypoints];
  const visited = new Set();

  while (pending.length > 0) {
    const file = pending.pop();
    if (!file || visited.has(file) || !(await hasFile(file))) continue;
    visited.add(file);

    const source = await readSource(file);
    for (const specifier of extractStaticImportSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const resolved = normalize(join(dirname(file), specifier))
        .split("\\")
        .join("/");
      if (resolved.endsWith(".js") && !visited.has(resolved)) pending.push(resolved);
    }
  }

  return visited;
}
