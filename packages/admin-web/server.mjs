import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const port = Number(process.env.PORT || 4102);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = join(root, safePath);
  const resolved = existsSync(filePath) ? filePath : join(root, 'index.html');
  response.setHeader('Content-Type', mimeTypes[extname(resolved)] || 'application/octet-stream');
  response.setHeader('Cache-Control', extname(resolved) === '.html' ? 'no-store' : 'public, max-age=3600');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  createReadStream(resolved).pipe(response);
}).listen(port, '0.0.0.0', () => console.log(`BinGO admin web listening on ${port}`));
