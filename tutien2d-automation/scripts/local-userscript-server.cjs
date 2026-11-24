const http = require('http');
const fs = require('fs');
const path = require('path');
const files = new Map([
  ['/auto-total.user.js', 'tutien2d-auto-tong-0.9.17.user.js'],
  ['/auto-quai.user.js', 'tutien2d-auto-quai-2.0.27.user.js']
]);
http.createServer((req, res) => {
  const file = files.get(req.url);
  if (req.method !== 'GET' || !file) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
  fs.createReadStream(path.join(__dirname, '..', 'dist', file)).pipe(res);
}).listen(19444, '127.0.0.1');
