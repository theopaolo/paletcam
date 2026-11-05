import { isProductionDeploy } from "./build-policy.js";

const CONNECT_SOURCES = [
  "'self'",
  "https://colorcatchers.co",
  "https://cclogs.ludique.dev",
  "https://ccbackup.ludique.dev",
];

const IMAGE_SOURCES = ["'self'", "data:", "blob:", "https://colorcatchers.co"];

function createContentSecurityPolicy(connectSources, imageSources = IMAGE_SOURCES) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `img-src ${imageSources.join(" ")}`,
    "manifest-src 'self'",
    "media-src 'self' blob: data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self'",
  ].join("; ");
}

function parseAdditionalOrigin(value, kind) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Additional CSP ${kind} targets must be absolute URLs.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Additional CSP ${kind} targets must use HTTP or HTTPS.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      `Additional CSP ${kind} targets must not contain credentials, query strings, or fragments.`,
    );
  }

  return url.origin;
}

function createBuildSources(baseSources, additionalUrls, kind) {
  const sources = new Set(baseSources);

  for (const value of additionalUrls) {
    if (!String(value || "").trim()) continue;
    sources.add(parseAdditionalOrigin(value, kind));
  }

  return [...sources];
}

const CONTENT_SECURITY_POLICY = createContentSecurityPolicy(CONNECT_SOURCES);

export function isConnectOriginAllowed(value) {
  try {
    const origin = new URL(String(value || "")).origin;
    return CONNECT_SOURCES.includes(origin);
  } catch {
    return false;
  }
}

export const SECURITY_HEADERS = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": [
    "accelerometer=()",
    "autoplay=(self)",
    "camera=(self)",
    "fullscreen=(self)",
    "geolocation=()",
    "gyroscope=()",
    "microphone=()",
    "payment=()",
    "usb=()",
  ].join(", "),
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
};

const NETLIFY_ROUTE_HEADERS = [
  {
    path: "/.well-known/apple-app-site-association",
    headers: {
      "Content-Type": "application/json",
    },
  },
  {
    path: "/service-worker.js",
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  },
  {
    path: "/precache-manifest.json",
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  },
  {
    path: "/manifest.json",
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  },
  {
    path: "/index.html",
    headers: {
      "Cache-Control": "no-cache",
    },
  },
];

/**
 * @param {HeadersInit} [headersInit]
 * @param {{ additionalConnectUrls?: string[], additionalImageUrls?: string[] }} [extensions]
 *   Extra origins for a non-production server (the dev server talking to a
 *   local community API). Validated like the build's.
 */
export function withSecurityHeaders(headersInit = {}, extensions = {}) {
  const { additionalConnectUrls = [], additionalImageUrls = [] } = extensions;
  const headers = new Headers(headersInit);
  const hasExtensions = additionalConnectUrls.length > 0 || additionalImageUrls.length > 0;

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (name === "Strict-Transport-Security") {
      continue;
    }

    headers.set(
      name,
      name === "Content-Security-Policy" && hasExtensions
        ? createContentSecurityPolicy(
            createBuildSources(CONNECT_SOURCES, additionalConnectUrls, "connect"),
            createBuildSources(IMAGE_SOURCES, additionalImageUrls, "image"),
          )
        : value,
    );
  }

  return headers;
}

export function createNetlifyHeadersFile({
  additionalConnectUrls = [],
  additionalImageUrls = [],
} = {}) {
  const securityHeaders =
    additionalConnectUrls.length === 0 && additionalImageUrls.length === 0
      ? SECURITY_HEADERS
      : {
          ...SECURITY_HEADERS,
          "Content-Security-Policy": createContentSecurityPolicy(
            createBuildSources(CONNECT_SOURCES, additionalConnectUrls, "connect"),
            createBuildSources(IMAGE_SOURCES, additionalImageUrls, "image"),
          ),
        };
  const lines = ["/*"];

  for (const [name, value] of Object.entries(securityHeaders)) {
    lines.push(`  ${name}: ${value}`);
  }

  for (const routeConfig of NETLIFY_ROUTE_HEADERS) {
    lines.push("", routeConfig.path);
    for (const [name, value] of Object.entries(routeConfig.headers)) {
      lines.push(`  ${name}: ${value}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function createBuildNetlifyHeadersFile({
  deployBranchName,
  communityBaseUrl = "",
  logApiBaseUrl = "",
}) {
  const isProduction = isProductionDeploy(deployBranchName);
  return createNetlifyHeadersFile({
    additionalConnectUrls: isProduction ? [] : [communityBaseUrl, logApiBaseUrl],
    additionalImageUrls: isProduction ? [] : [communityBaseUrl],
  });
}
