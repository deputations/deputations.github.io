const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = 'D:/claude/Deputation';
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html':'text/html','.css':'text/css','.js':'application/javascript',
  '.mjs':'application/javascript','.json':'application/json','.svg':'image/svg+xml',
  '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon',
  '.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.geojson':'application/json'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  let filePath = path.join(ROOT, urlPath);

  // Security: keep inside ROOT
  const realRoot = fs.realpathSync(ROOT);
  let realPath;
  try { realPath = fs.realpathSync(filePath); } catch { realPath = filePath; }
  if (!realPath.startsWith(realRoot)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.stat(realPath, (err, stat) => {
    if (err || stat.isDirectory()) {
      // Try index.html in directory
      const indexPath = path.join(realPath, 'index.html');
      fs.readFile(indexPath, (e2, data) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, {'Content-Type':'text/html','Cache-Control':'no-cache, no-store'});
        res.end(data);
      });
      return;
    }
    fs.readFile(realPath, (err2, data) => {
      if (err2) { res.writeHead(500); res.end('Server error'); return; }
      const ext = path.extname(realPath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(data);
    });
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`Serving ${ROOT} at http://localhost:${PORT}`));
