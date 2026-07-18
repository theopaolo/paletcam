import { extname, join, normalize } from "node:path";
import { createContentBuildId } from "./build-id.js";
import { withSecurityHeaders } from "./security-headers.js";

const root = process.cwd();
const distRoot = join(root, "dist");
const port = Number(process.env.PORT ?? 4174);
const isPwaTestServer = process.env.PWA_E2E === "1";
let shouldFailRequiredShell = false;
let requiredShellFailureCount = 0;
let shouldFailOptionalAsset = false;
let serviceWorkerRevision = "";
let artifactRevision = null;
const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
]);

function resolveDistPath(pathname) {
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const normalizedPath = normalize(requestedPath);
  if (normalizedPath.startsWith("..") || normalizedPath.includes("\0")) return null;
  return join(distRoot, normalizedPath);
}

function normalizeE2eRevision(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 80);
}

async function createArtifactRevision(value) {
  const revision = normalizeE2eRevision(value);
  if (!revision) return null;

  const precacheUrls = await Bun.file(join(distRoot, "precache-manifest.json")).json();
  const baseBuildManifest = await Bun.file(join(distRoot, "build-manifest.json")).json();
  const marker = `e2e-artifact:${revision}`;
  const appSource = `${await Bun.file(join(distRoot, "app.js")).text()}\n// ${marker}\n`;
  const buildIdEntries = await Promise.all(
    precacheUrls.map(async (url) => {
      const path = String(url).replace(/^\/+/, "");
      return {
        path: url,
        content:
          url === "/app.js"
            ? appSource
            : new Uint8Array(await Bun.file(join(distRoot, path)).arrayBuffer()),
      };
    }),
  );
  const buildId = createContentBuildId(buildIdEntries);

  return {
    appSource,
    baseBuildId: baseBuildManifest.buildId,
    buildId,
    buildManifestSource: `${JSON.stringify({ ...baseBuildManifest, buildId }, null, 2)}\n`,
    marker,
    revision,
  };
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (isPwaTestServer && url.pathname === "/__e2e/fail-required-shell") {
      shouldFailRequiredShell = url.searchParams.get("enabled") === "1";
      if (shouldFailRequiredShell) requiredShellFailureCount = 0;
      return Response.json({ shouldFailRequiredShell, requiredShellFailureCount });
    }
    if (isPwaTestServer && url.pathname === "/__e2e/status") {
      return Response.json({
        shouldFailRequiredShell,
        requiredShellFailureCount,
        shouldFailOptionalAsset,
      });
    }
    if (isPwaTestServer && url.pathname === "/__e2e/fail-optional-asset") {
      shouldFailOptionalAsset = url.searchParams.get("enabled") === "1";
      return Response.json({ shouldFailOptionalAsset });
    }
    if (isPwaTestServer && url.pathname === "/__e2e/service-worker-revision") {
      artifactRevision = null;
      serviceWorkerRevision = normalizeE2eRevision(url.searchParams.get("value"));
      return Response.json({ serviceWorkerRevision });
    }
    if (isPwaTestServer && url.pathname === "/__e2e/artifact-revision") {
      serviceWorkerRevision = "";
      artifactRevision = await createArtifactRevision(url.searchParams.get("value"));
      return Response.json({
        enabled: Boolean(artifactRevision),
        baseBuildId: artifactRevision?.baseBuildId ?? null,
        buildId: artifactRevision?.buildId ?? null,
        marker: artifactRevision?.marker ?? null,
      });
    }
    if (isPwaTestServer && url.pathname === "/uncatalogued-resource.txt") {
      return new Response("network-only test resource", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    if (shouldFailRequiredShell && url.pathname === "/app.js") {
      requiredShellFailureCount += 1;
      return new Response("Injected required-shell failure", { status: 503 });
    }
    if (shouldFailOptionalAsset && url.pathname === "/logo/colorcatchers.svg") {
      return new Response("Injected optional-asset failure", { status: 503 });
    }
    const filePath = resolveDistPath(url.pathname);
    if (!filePath) return new Response("Not found", { status: 404 });

    let file = Bun.file(filePath);
    if (!(await file.exists()) && request.headers.get("accept")?.includes("text/html")) {
      file = Bun.file(join(distRoot, "index.html"));
    }
    if (!(await file.exists())) return new Response("Not found", { status: 404 });

    const extension = extname(file.name ?? filePath).toLowerCase();
    const headers = withSecurityHeaders({
      "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=0, must-revalidate",
      "Content-Type": MIME_TYPES.get(extension) ?? file.type,
    });
    if (isPwaTestServer && artifactRevision) {
      if (url.pathname === "/app.js") {
        return new Response(artifactRevision.appSource, { headers });
      }
      if (url.pathname === "/build-manifest.json") {
        return new Response(artifactRevision.buildManifestSource, { headers });
      }
      if (url.pathname === "/service-worker.js") {
        const source = await file.text();
        const baseCacheName = `colorcatcher-${artifactRevision.baseBuildId}`;
        if (!source.includes(baseCacheName)) {
          return new Response("Base service-worker identity mismatch", { status: 500 });
        }
        return new Response(
          `${source.replaceAll(baseCacheName, `colorcatcher-${artifactRevision.buildId}`)}\n// ${artifactRevision.marker}\n`,
          { headers },
        );
      }
    }
    if (isPwaTestServer && url.pathname === "/service-worker.js" && serviceWorkerRevision) {
      return new Response(`${await file.text()}\n// e2e-revision:${serviceWorkerRevision}\n`, {
        headers,
      });
    }
    return new Response(file, { headers });
  },
});

console.log(`Production artifact server running at http://${server.hostname}:${server.port}`);
