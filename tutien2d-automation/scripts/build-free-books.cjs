const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const old = fs.readFileSync(path.join(root, 'dist/tutien2d-0.9.7.user.js'), 'utf8');
function part(start, end) {
  const i = old.indexOf(start), j = old.indexOf(end, i + start.length);
  if (i < 0 || j < 0) throw new Error('Missing source section ' + start);
  return old.slice(i, j);
}
const header = `// ==UserScript==
// @name         TuTien2D - Rút bí tịch miễn phí
// @namespace    local.tutien2d.free-books
// @version      1.0.4
// @description  Kiểm tra và tự rút các lượt bí tịch miễn phí hằng ngày.
// @match        https://tutien2d.com/*
// @match        https://www.tutien2d.com/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @noframes
// ==/UserScript==

(() => {
'use strict';
const A = {};
`;
const code = [
  fs.readFileSync(path.join(root, 'src/standalone/free-books-access.js'), 'utf8'),
  part('// src/core/controller.js', '// src/core/combat-skills.js'),
  part('// src/navigation/map-graph.js', '// src/navigation/flight.js'),
  part('// src/npc/npc-finder.js', '// src/core/state-reader.js'),
  part('// src/navigation/portal-travel.js', '// src/quests/quest-reader.js'),
  fs.readFileSync(path.join(root, 'src/standalone/free-books-main.js'), 'utf8')
];
fs.writeFileSync(path.join(root, 'dist/tutien2d-bi-tich-mien-phi-1.0.4.user.js'), header + code.join('\n') + '\n})();\n');
