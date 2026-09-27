// tiny-server.mjs — Minimal ES-module-safe static server for screenshot capture
// Mirrors tests/harness.js server: serves files with correct Content-Type so
// `type="module"` scripts load without being served as text/html.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname);
const PORT = 8092;

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';
  const filePath = path.join(ROOT, url);
  if (!filePath.startsWith(ROOT)) {
    res.statusCode = 403;
    return res.end();
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = err.code === 'ENOENT' ? 404 : 500;
      return res.end(err.code === 'ENOENT' ? 'Not found' : err.message);
    }
    res.setHeader('Content-Type', TYPES[path.extname(filePath)] || 'text/plain');
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running at http://127.0.0.1:${PORT}`);
});
