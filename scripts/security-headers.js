const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https://colorcatchers.co https://ccs.test https://api.color.pizza https://cclogs.ludique.dev",
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

export function createNetlifyHeadersFile() {
  const lines = ["/*"];

  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
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
