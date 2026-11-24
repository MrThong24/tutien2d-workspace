const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const original = fs.readFileSync(path.join(root, 'dist/tutien2d-0.9.11.user.js'), 'utf8');
function section(from, to) {
  const a = original.indexOf('// src/' + from), b = original.indexOf('// src/' + to, a + 1);
  if (a < 0 || b < 0) throw new Error('Missing source section: ' + from);
  return original.slice(a, b);
}
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const header = `// ==UserScript==
// @name         TuTien2D - Farm Linh Thach
// @namespace    local.tutien2d.stone-farm
// @version      1.0.0
// @description  Tu dong danh quai va nhat Linh Thach
// @match        https://tutien2d.com/*
// @match        https://www.tutien2d.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==
`;
const body = [
  section('core/controller.js', 'core/combat-skills.js'),
  section('navigation/map-graph.js', 'navigation/flight.js'),
  section('npc/npc-finder.js', 'core/state-reader.js'),
  section('navigation/portal-travel.js', 'quests/quest-reader.js'),
  read('src/standalone/game-access-hook.js'),
  read('src/farm/stone-planner.js'), read('src/farm/stone-runner.js'),
  read('src/standalone/stone-farm-main.js')
].join('\n');
const output = path.join(root, 'dist/tutien2d-farm-linh-thach-1.0.0.user.js');
fs.writeFileSync(output, header + '\n(() => {\n\'use strict\';\nconst A = {};\n' + body + '\n})();\n', 'utf8');
console.log(output);
