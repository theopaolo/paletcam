import { extname, join, normalize } from "node:path";
import { resolveCommunityApiBaseUrl } from "./community-api-config.js";
import { resolveLogApiBaseUrl } from "./log-api-config.js";
import { withSecurityHeaders } from "./security-headers.js";
import { resolveDeployBranchName } from "./git-utils.js";

const projectRoot = process.cwd();
const publicRoot = join(projectRoot, "public");
const sourceRoot = join(projectRoot, "src");
const initialPort = Number(process.env.PORT ?? 3000);
const browserBundleNodeEnv = process.env.BROWSER_BUNDLE_NODE_ENV ?? "production";
const deployBranchName = resolveDeployBranchName();
const { version: appVersion } = await Bun.file(join(projectRoot, "package.json")).json();
const appCommitHash = (() => {
  const env = String(process.env.COMMIT_HASH || "").trim();
  if (env) return env.slice(0, 12);
  try {
    return Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]).stdout.toString().trim();
  } catch {
    return "unknown";
  }
})();
const communityApiProxyPrefix = "/api/v1";
const communityApiProxyTarget = resolveCommunityApiBaseUrl(
  process.env.COMMUNITY_API_PROXY_TARGET ?? "https://colorcatchers.co",
  "",
);
const logApiBaseUrl = resolveLogApiBaseUrl(process.env.PALETCAM_LOG_API_BASE_URL, "");
const fallbackPorts = [
  ...Array.from({ length: 120 }, (_, index) => initialPort + index),
  5173,
  8080,
  8787,
];

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".webp", "image/webp"],
]);

function resolveRequestCandidates(urlPathname) {
  const requestedPath = urlPathname === "/" ? "index.html" : urlPathname.replace(/^\/+/, "");
  const normalizedPath = normalize(requestedPath);

  if (normalizedPath.startsWith("..") || normalizedPath.includes("\0")) {
    return [];
  }

  if (normalizedPath === "_headers" || normalizedPath === "_redirects") {
    return [];
  }

  if (normalizedPath === "debug/performance-hud.js") {
    return [join(sourceRoot, "modules", "performance-hud.js")];
  }

  return [join(publicRoot, normalizedPath), join(sourceRoot, normalizedPath)];
}

function shouldProxyCommunityApi(urlPathname) {
  return (
    urlPathname === communityApiProxyPrefix || urlPathname.startsWith(`${communityApiProxyPrefix}/`)
  );
}

function stripProxyPrefix(urlPathname) {
  if (urlPathname === communityApiProxyPrefix) {
    return "/";
  }

  if (urlPathname.startsWith(`${communityApiProxyPrefix}/`)) {
    const stripped = urlPathname.slice(communityApiProxyPrefix.length);
    return stripped || "/";
  }

  return urlPathname;
}

async function proxyCommunityApiRequest(request, urlPathname, searchParams) {
  const proxyPathCandidates = [urlPathname, stripProxyPrefix(urlPathname)].filter(
    (value, index, values) => values.indexOf(value) === index,
  );
  const headers = new Headers(request.headers);

  headers.delete("connection");
  headers.delete("accept-encoding");
  headers.delete("content-length");
  headers.delete("host");
  headers.delete("origin");

  const requestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    requestInit.body = request.body;
  }

  let response = null;
  let lastProxyError = null;

  for (const proxyPath of proxyPathCandidates) {
    const targetUrl = `${communityApiProxyTarget}${proxyPath}${searchParams}`;

    try {
      response = await fetch(targetUrl, requestInit);
      if (response.status !== 404 && response.status !== 405 && response.status !== 419) {
        break;
      }
    } catch (error) {
      lastProxyError = error;
      response = null;
    }
  }

  if (!response) {
    return new Response(
      `Community API proxy failed: ${lastProxyError?.message || "unknown error"}`,
      {
        status: 502,
        headers: withSecurityHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
      },
    );
  }

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("connection");
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("keep-alive");
  responseHeaders.delete("transfer-encoding");
  responseHeaders.set("Cache-Control", "no-store");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: withSecurityHeaders(responseHeaders),
  });
}

async function serveFile(filePath) {
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return null;
  }

  const contentType = MIME_TYPES.get(extname(filePath).toLowerCase()) ?? file.type;
  const headers = new Headers({ "Cache-Control": "no-store" });

  if (contentType) {
    headers.set("Content-Type", contentType);
  }

  return new Response(file, { headers: withSecurityHeaders(headers) });
}

function isSourceJavaScriptFile(filePath) {
  return filePath.startsWith(sourceRoot) && extname(filePath).toLowerCase() === ".js";
}

async function bundleSourceModule(filePath) {
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return null;
  }

  const buildResult = await Bun.build({
    entrypoints: [filePath],
    target: "browser",
    format: "esm",
    splitting: false,
    minify: false,
    sourcemap: "inline",
    write: false,
    define: {
      "process.env.NODE_ENV": JSON.stringify(browserBundleNodeEnv),
      __COMMUNITY_BASE_URL__: JSON.stringify(communityApiProxyTarget),
      __PALETCAM_DEPLOY_BRANCH__: JSON.stringify(deployBranchName),
      __PALETCAM_DEBUG_TOOLS__: "true",
      __PALETCAM_BUILD_ARTIFACT__: "false",
      __PALETCAM_LOG_API_BASE_URL__: JSON.stringify(logApiBaseUrl),
      __PALETCAM_BACKUP_API_BASE_URL__: JSON.stringify(
        String(process.env.PALETCAM_BACKUP_API_BASE_URL || "").trim(),
      ),
      __APP_VERSION__: JSON.stringify(appVersion),
      __COMMIT_HASH__: JSON.stringify(appCommitHash),
    },
  });

  if (!buildResult.success || buildResult.outputs.length === 0) {
    const errorLogs = buildResult.logs.map((log) => log.message).join("\n");

    return new Response(errorLogs || `Failed to bundle ${filePath}`, {
      status: 500,
      headers: withSecurityHeaders({
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      }),
    });
  }

  const bundledCode = await buildResult.outputs[0].text();

  return new Response(bundledCode, {
    headers: withSecurityHeaders({
      "Cache-Control": "no-store",
      "Content-Type": "text/javascript; charset=utf-8",
    }),
  });
}

// Read-only listing of public/assets/img for the extraction debug harness, so
// the gallery stays in sync with the folder without a hardcoded list.
async function serveDebugImageManifest() {
  const imageRoot = join(publicRoot, "assets", "img");
  const glob = new Bun.Glob("**/*.{jpg,jpeg,png,webp,gif}");
  const entries = [];

  try {
    for await (const relativePath of glob.scan({ cwd: imageRoot })) {
      const normalized = relativePath.split("\\").join("/");
      const segments = normalized.split("/");
      const set = segments[0] === "sets" && segments.length > 2 ? segments[1] : "";
      entries.push({
        url: encodeURI(`/assets/img/${normalized}`),
        name: segments[segments.length - 1],
        set,
      });
    }
  } catch {
    // Return whatever was collected before the failure.
  }

  entries.sort((a, b) => (a.set || "").localeCompare(b.set || "") || a.name.localeCompare(b.name));

  return new Response(JSON.stringify(entries), {
    headers: withSecurityHeaders({ "Content-Type": "application/json; charset=utf-8" }),
  });
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const decodedPathname = decodeURIComponent(url.pathname);

  if (shouldProxyCommunityApi(decodedPathname)) {
    return proxyCommunityApiRequest(request, decodedPathname, url.search);
  }

  if (decodedPathname === "/debug/images.json") {
    return serveDebugImageManifest();
  }

  const candidatePaths = resolveRequestCandidates(decodedPathname);

  for (const candidatePath of candidatePaths) {
    if (isSourceJavaScriptFile(candidatePath)) {
      const bundledResponse = await bundleSourceModule(candidatePath);
      if (bundledResponse) {
        return bundledResponse;
      }
    }

    const response = await serveFile(candidatePath);
    if (response) {
      return response;
    }
  }

  return new Response("Not found", {
    status: 404,
    headers: withSecurityHeaders({ "Content-Type": "text/plain; charset=utf-8" }),
  });
}

function startServer() {
  for (const port of fallbackPorts) {
    try {
      const server = Bun.serve({ port, fetch: handleRequest });
      return { server, usedFallback: port !== initialPort };
    } catch (error) {
      if (error?.code === "EPERM") {
        throw new Error("Unable to bind a local dev server port (EPERM).");
      }

      if (error?.code !== "EADDRINUSE") {
        throw error;
      }
    }
  }

  throw new Error("Failed to start dev server: no available port was found.");
}

const { server, usedFallback } = startServer();

if (usedFallback) {
  console.log(`Port ${initialPort} was busy. Dev server is using http://localhost:${server.port}`);
} else {
  console.log(`Dev server running at http://localhost:${server.port}`);
}

console.log(
  `Proxying ${communityApiProxyPrefix}/* to ${communityApiProxyTarget} (tries stripped and original paths)`,
);
console.log(`Bundling browser modules with NODE_ENV=${browserBundleNodeEnv}`);
console.log(`Resolved deploy branch: ${deployBranchName || "unknown"}`);
