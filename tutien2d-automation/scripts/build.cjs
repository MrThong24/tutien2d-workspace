const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = [
  'core/game-access.js', 'core/logger.js', 'core/state-reader.js', 'ui/overlay.js', 'main.js'
];
const header = `// ==UserScript==
// @name         TuTien2D Diagnostic (Read Only)
// @namespace    local.tutien2d.automation
// @version      1.0.0
// @description  Chi doc trang thai game va tao log cuc bo; khong dieu khien nhan vat.
// @match        https://tutien2d.com/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// ==/UserScript==
`;
const body = files.map(f => `\n// src/${f}\n${fs.readFileSync(path.join(root, 'src', f), 'utf8')}`).join('\n');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/tutien2d.user.js'), header + '\n(function () {\n"use strict";\nconst A = {};\n' + body + '\n})();\n');
console.log('Built dist/tutien2d.user.js');
