import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveRequestPath(webRoot, pathname) {
  let requested;
  try {
    requested = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (requested.includes('\0')) return null;
  if (requested === '/' || requested === '/play' || requested === '/play/') {
    requested = '/game.html';
  }
  if (requested.includes('..')) return null;
  const file = path.resolve(webRoot, `.${requested}`);
  const root = path.resolve(webRoot);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return file;
}

export function createStaticHandler(webRoot) {
  return async function serveStatic(request, response) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end('Method not allowed');
      return;
    }
    const url = new URL(request.url, 'http://localhost');
    const file = resolveRequestPath(webRoot, url.pathname);
    if (!file) {
      response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Bad request');
      return;
    }
    let info;
    try {
      info = await stat(file);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    if (!info.isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const extension = path.extname(file).toLowerCase();
    const contentType = MIME_TYPES[extension] ?? 'application/octet-stream';
    const isHtml = extension === '.html';
    const cacheControl = isHtml
      ? 'no-store'
      : file.includes(`${path.sep}assets${path.sep}`)
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=86400';
    const headers = {
      'Content-Type': contentType,
      'Content-Length': info.size,
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };
    if (isHtml) {
      headers['Content-Security-Policy'] = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self' ws: wss:",
        "media-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
      ].join('; ');
    }
    response.writeHead(200, headers);
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = createReadStream(file);
    stream.on('error', () => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
    stream.pipe(response);
  };
}

export function networkAddresses(port) {
  const addresses = [];
  try {
    const interfaces = networkInterfaces();
    for (const entries of Object.values(interfaces)) {
      for (const entry of entries ?? []) {
        if (entry.family === 'IPv4' && !entry.internal) {
          addresses.push(`http://${entry.address}:${port}/play`);
        }
      }
    }
  } catch {
    // fall through to localhost
  }
  return addresses;
}
