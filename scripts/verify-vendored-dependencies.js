import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { verifyVendoredDependency } from "./vendor-provenance.js";

const projectRoot = process.cwd();
const provenancePath = resolve(projectRoot, "src/vendor/dexie.provenance.json");
const provenance = JSON.parse(await readFile(provenancePath, "utf8"));
const relativeVendoredPath = String(provenance.vendoredPath || "");
if (!relativeVendoredPath.startsWith("src/vendor/") || relativeVendoredPath.includes("..")) {
  throw new Error(
    "Invalid vendored dependency provenance: vendoredPath must stay inside src/vendor",
  );
}
const vendoredPath = resolve(projectRoot, relativeVendoredPath);
const fileBytes = await readFile(vendoredPath);
const verified = verifyVendoredDependency(provenance, fileBytes);

console.log(
  `Verified ${verified.package} ${verified.version} at ${verified.vendoredPath} (${verified.sha256}).`,
);
