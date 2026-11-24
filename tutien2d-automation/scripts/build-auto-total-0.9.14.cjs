const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const previousPath = path.join(root, 'dist/tutien2d-auto-tong-0.9.13.user.js');
const outputPath = path.join(root, 'dist/tutien2d-auto-tong-0.9.14.user.js');
const old = fs.readFileSync(previousPath, 'utf8');
const runner = fs.readFileSync(path.join(root, 'src/core/auto-runner.js'), 'utf8').trimEnd();
const startMarker = '// src/core/auto-runner.js\n';
const endMarker = '\n// src/ui/native-actions.js';
const start = old.indexOf(startMarker);
const end = old.indexOf(endMarker, start + startMarker.length);
if (start < 0 || end < 0) throw new Error('Could not locate AutoRunner section in 0.9.13 bundle.');

const bundle = old.slice(0, start) + startMarker + runner + old.slice(end);
const versioned = bundle.replaceAll('0.9.13', '0.9.14')
  .replace('@description  Khao sat chi doc; di den Dai Phu khi bam Start.', '@description  Lam nhiem vu chinh toi giai doan chua ho tro roi dung lai.')
  .replace('// @namespace    local.tutien2d.headless\n', '// @namespace    local.tutien2d.headless\n// @updateURL    http://127.0.0.1:19444/auto-total.user.js\n// @downloadURL  http://127.0.0.1:19444/auto-total.user.js\n')
  .replace(
  '// @match        https://www.tutien2d.com/*\n',
  '// @match        https://www.tutien2d.com/*\n// @match        https://tutienpixel.online/*\n// @match        https://www.tutienpixel.online/*\n'
);
fs.writeFileSync(outputPath, versioned, 'utf8');
console.log('Built ' + path.relative(root, outputPath));
