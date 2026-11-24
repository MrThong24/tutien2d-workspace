const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const old = read('dist/tutien2d-0.9.11.user.js').replace(/\r\n/g, '\n');
function section(from, to) {
  const a = old.indexOf('// src/' + from), b = old.indexOf('// src/' + to, a + 1);
  if (a < 0 || b < 0) throw Error('Missing section ' + from);
  return old.slice(a, b);
}
if (!process.argv.includes('--farm-only')) {
  const ending = "if (document.documentElement) mount();\nelse listen(document, 'DOMContentLoaded', mount);";
  if (!old.includes(ending)) throw Error('Cannot find main overlay mount');
  const headless = old.replaceAll('0.9.11', '0.9.12').replace(ending, '// UI hidden: control through ChromeGridApp.');
  fs.writeFileSync(path.join(root, 'dist/tutien2d-0.9.12-headless.user.js'), headless, 'utf8');
}
const source = [section('core/controller.js','core/combat-skills.js'), section('navigation/map-graph.js','navigation/flight.js'),
  section('npc/npc-finder.js','core/state-reader.js'), section('navigation/portal-travel.js','quests/quest-reader.js'),
  read('src/standalone/free-books-access.js'),
  read('src/farm/stone-planner.js'), read('src/farm/stone-runner.js'),
  read('src/standalone/combat-pipeline-main.js')].join('\n');
const header = `// ==UserScript==
// @name         TuTien2D - Auto quai, duoc cong va linh thach
// @namespace    local.tutien2d.stone-farm
// @version      2.0.27
// @updateURL    http://127.0.0.1:19444/auto-quai.user.js
// @downloadURL  http://127.0.0.1:19444/auto-quai.user.js
// @match        https://tutien2d.com/*
// @match        https://www.tutien2d.com/*
// @match        https://tutienpixel.online/*
// @match        https://www.tutienpixel.online/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==
`;
fs.writeFileSync(path.join(root, 'dist/tutien2d-auto-quai-2.0.27.user.js'), header + '\n(() => {\n\'use strict\';\nconst A = {};\n' + source + '\n})();\n', 'utf8');
console.log('Built headless Auto tổng and farm-only Auto quái');
