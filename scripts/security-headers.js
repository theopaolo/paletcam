import { isProductionDeploy } from "./build-policy.js";

const CONNECT_SOURCES = ["'self'", "https://colorcatchers.co", "https://cclogs.ludique.dev"];

function createContentSecurityPolicy(connectSources) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src ${connectSources.join(" ")}`,
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "manifest-src 'self'",
    "media-src 'self' blob: data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self'",
  ].join("; ");
}

function createBuildConnectSources(additionalConnectUrls) {
  const connectSources = new Set(CONNECT_SOURCES);

  for (const value of additionalConnectUrls) {
    if (!String(value || "").trim()) continue;

    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Additional CSP connect targets must be absolute URLs.");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Additional CSP connect targets must use HTTP or HTTPS.");
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error(
        "Additional CSP connect targets must not contain credentials, query strings, or fragments.",
      );
    }

    connectSources.add(url.origin);
  }

  return [...connectSources];
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

export function withSecurityHeaders(headersInit = {}) {
  const headers = new Headers(headersInit);

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (name === "Strict-Transport-Security") {
      continue;
    }

    headers.set(name, value);
  }

  return headers;
}

export function createNetlifyHeadersFile({ additionalConnectUrls = [] } = {}) {
  const securityHeaders =
    additionalConnectUrls.length === 0
      ? SECURITY_HEADERS
      : {
          ...SECURITY_HEADERS,
          "Content-Security-Policy": createContentSecurityPolicy(
            createBuildConnectSources(additionalConnectUrls),
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
  return createNetlifyHeadersFile({
    additionalConnectUrls: isProductionDeploy(deployBranchName)
      ? []
      : [communityBaseUrl, logApiBaseUrl],
  });
}
