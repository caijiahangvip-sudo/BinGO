import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const port = Number(process.env.PORT || 4104);
const upstream = process.env.BINGO_SYNC_UPSTREAM || 'http://127.0.0.1:4100';
const mimeTypes = { '.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml' };

createServer(async (request, response) => {
  const url = new URL(request.url || '/', 'http://localhost');
  if (url.pathname === '/health' || url.pathname.startsWith('/v1/')) {
    try {
      const body = ['GET','HEAD'].includes(request.method || 'GET') ? undefined : request;
      const proxied = await fetch(`${upstream}${url.pathname}${url.search}`, {
        method: request.method,
        headers: Object.fromEntries(Object.entries(request.headers).filter(([, value]) => typeof value === 'string')),
        body,
        duplex: body ? 'half' : undefined,
      });
      response.writeHead(proxied.status, Object.fromEntries(proxied.headers.entries()));
      if (proxied.body) for await (const chunk of proxied.body) response.write(chunk);
      return response.end();
    } catch {
      response.writeHead(502, { 'Content-Type':'application/json' });
      return response.end(JSON.stringify({ error:'教师端暂时无法连接 BinGO 服务器' }));
    }
  }
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const safePath = normalize(requested).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = join(root, safePath);
  const resolved = existsSync(filePath) ? filePath : join(root, 'index.html');
  response.setHeader('Content-Type', mimeTypes[extname(resolved)] || 'application/octet-stream');
  response.setHeader('Cache-Control', extname(resolved) === '.html' ? 'no-store' : 'public, max-age=3600');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  createReadStream(resolved).pipe(response);
}).listen(port, '0.0.0.0', () => console.log(`BinGO teacher web listening on ${port}`));
