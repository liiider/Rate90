import {createServer} from 'node:http';
import {readFile, realpath} from 'node:fs/promises';
import {extname, isAbsolute, relative, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import matches from '../server/matches-api.mjs';

const publicRoot = await realpath(fileURLToPath(new URL('../public/', import.meta.url)));
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

export async function handleRequest(req, res) {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (path === '/api/matches') {
    res.status = code => {
      res.statusCode = code;
      return res;
    };
    res.json = data => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(data));
    };
    return matches(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, {Allow:'GET, HEAD'});
    return res.end();
  }
  try {
    const file = await realpath(resolve(publicRoot, '.' + (path === '/' ? '/index.html' : path)));
    const rel = relative(publicRoot, file);
    const type = types[extname(file)];
    if (isAbsolute(rel) || rel.split(sep).some(part => part.startsWith('.')) || !type) {
      res.writeHead(404);
      return res.end();
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': type, 'Content-Length': body.byteLength, 'X-Content-Type-Options': 'nosniff'
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    const invalidPath = ['ENOENT', 'ENOTDIR', 'EISDIR', 'ERR_INVALID_ARG_VALUE'].includes(error.code);
    res.writeHead(invalidPath ? 404 : 500);
    res.end();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const port = Number(process.env.PORT || 3000);
  const server = createServer(handleRequest);
  server.on('error', error => {
    console.error('Rate90 服务启动失败：' + error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('Rate90  http://127.0.0.1:' + server.address().port);
  });
}
