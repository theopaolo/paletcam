import { extname, join, normalize } from 'node:path';

const projectRoot = process.cwd();
const initialPort = Number(process.env.PORT ?? 3000);
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
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
  ['.webp', 'image/webp'],
]);

function resolveRequestPath(urlPathname) {
  const requestedPath = urlPathname === '/' ? 'index.html' : urlPathname.replace(/^\/+/, '');
  const normalizedPath = normalize(requestedPath);

  if (normalizedPath.startsWith('..') || normalizedPath.includes('\0')) {
    return null;
  }

  return join(projectRoot, normalizedPath);
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
  const resolvedPath = resolveRequestPath(decodedPathname);

  if (!resolvedPath) {
    return new Response('Not found', { status: 404 });
  }

  const response = await serveFile(resolvedPath);
  if (response) {
    return response;
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
