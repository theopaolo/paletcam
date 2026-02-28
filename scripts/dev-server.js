import { extname, join, normalize } from 'node:path';

const projectRoot = process.cwd();
const publicRoot = join(projectRoot, 'public');
const sourceRoot = join(projectRoot, 'src');
const initialPort = Number(process.env.PORT ?? 3000);
const communityApiProxyPrefix = '/api/v1';
const communityApiProxyTarget = (
  process.env.COMMUNITY_API_PROXY_TARGET
  ?? 'https://ccs.preview.name'
).replace(/\/+$/, '');
const fallbackPorts = [
  ...Array.from({ length: 120 }, (_, index) => initialPort + index),
  5173,
  8080,
  8787,
];

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.webp', 'image/webp'],
]);

function resolveRequestCandidates(urlPathname) {
  const requestedPath = urlPathname === '/' ? 'index.html' : urlPathname.replace(/^\/+/, '');
  const normalizedPath = normalize(requestedPath);

  if (normalizedPath.startsWith('..') || normalizedPath.includes('\0')) {
    return [];
  }

  return [
    join(publicRoot, normalizedPath),
    join(sourceRoot, normalizedPath),
  ];
}

function shouldProxyCommunityApi(urlPathname) {
  return (
    urlPathname === communityApiProxyPrefix ||
    urlPathname.startsWith(`${communityApiProxyPrefix}/`)
  );
}

function stripProxyPrefix(urlPathname) {
  if (urlPathname === communityApiProxyPrefix) {
    return '/';
  }

  if (urlPathname.startsWith(`${communityApiProxyPrefix}/`)) {
    const stripped = urlPathname.slice(communityApiProxyPrefix.length);
    return stripped || '/';
  }

  return urlPathname;
}

async function proxyCommunityApiRequest(request, urlPathname, searchParams) {
  const proxyPathCandidates = [
    urlPathname,
    stripProxyPrefix(urlPathname),
  ].filter((value, index, values) => values.indexOf(value) === index);
  const headers = new Headers(request.headers);

  headers.delete('connection');
  headers.delete('accept-encoding');
  headers.delete('content-length');
  headers.delete('host');
  headers.delete('origin');

  const requestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    requestInit.body = request.body;
  }

  let response = null;
  let lastProxyError = null;

  for (const proxyPath of proxyPathCandidates) {
    const targetUrl = `${communityApiProxyTarget}${proxyPath}${searchParams}`;

    try {
      response = await fetch(targetUrl, requestInit);
      if (
        response.status !== 404 &&
        response.status !== 405 &&
        response.status !== 419
      ) {
        break;
      }
    } catch (error) {
      lastProxyError = error;
      response = null;
    }
  }

  if (!response) {
    return new Response(
      `Community API proxy failed: ${lastProxyError?.message || 'unknown error'}`,
      { status: 502 }
    );
  }

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('connection');
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  responseHeaders.delete('keep-alive');
  responseHeaders.delete('transfer-encoding');
  responseHeaders.set('Cache-Control', 'no-store');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}

async function serveFile(filePath) {
  const file = Bun.file(filePath);

  if (!(await file.exists())) {
    return null;
  }

  const contentType = MIME_TYPES.get(extname(filePath).toLowerCase()) ?? file.type;
  const headers = new Headers({ 'Cache-Control': 'no-store' });

  if (contentType) {
    headers.set('Content-Type', contentType);
  }

  return new Response(file, { headers });
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const decodedPathname = decodeURIComponent(url.pathname);

  if (shouldProxyCommunityApi(decodedPathname)) {
    return proxyCommunityApiRequest(request, decodedPathname, url.search);
  }

  const candidatePaths = resolveRequestCandidates(decodedPathname);

  for (const candidatePath of candidatePaths) {
    const response = await serveFile(candidatePath);
    if (response) {
      return response;
    }
  }

  return new Response('Not found', { status: 404 });
}

function startServer() {
  for (const port of fallbackPorts) {
    try {
      const server = Bun.serve({ port, fetch: handleRequest });
      return { server, usedFallback: port !== initialPort };
    } catch (error) {
      if (error?.code === 'EPERM') {
        throw new Error('Unable to bind a local dev server port (EPERM).');
      }

      if (error?.code !== 'EADDRINUSE') {
        throw error;
      }
    }
  }

  throw new Error('Failed to start dev server: no available port was found.');
}

const { server, usedFallback } = startServer();

if (usedFallback) {
  console.log(
    `Port ${initialPort} was busy. Dev server is using http://localhost:${server.port}`
  );
} else {
  console.log(`Dev server running at http://localhost:${server.port}`);
}

console.log(
  `Proxying ${communityApiProxyPrefix}/* to ${communityApiProxyTarget} (tries stripped and original paths)`
);
