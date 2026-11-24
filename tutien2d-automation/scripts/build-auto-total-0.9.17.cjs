const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const previousPath = path.join(root, 'dist/tutien2d-auto-tong-0.9.16.user.js');
const outputPath = path.join(root, 'dist/tutien2d-auto-tong-0.9.17.user.js');
let bundle = fs.readFileSync(previousPath, 'utf8');

function replaceSection(startMarker, endMarker, file) {
  const start = bundle.indexOf(startMarker);
  const end = bundle.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error('Could not locate bundle section: ' + startMarker);
  const source = fs.readFileSync(path.join(root, file), 'utf8').trimEnd();
  bundle = bundle.slice(0, start) + startMarker + source + bundle.slice(end);
}

replaceSection('// src/quests/later-intro.js\n', '\n// src/quests/intro-runner.js', 'src/quests/later-intro.js');
replaceSection('// src/quests/intro-runner.js\n', '\n// src/farm/garden-reader.js', 'src/quests/intro-runner.js');
replaceSection('// src/farm/garden-runner.js\n', '\n// src/core/auto-runner.js', 'src/farm/garden-runner.js');
replaceSection('// src/core/auto-runner.js\n', '\n// src/ui/native-actions.js', 'src/core/auto-runner.js');
bundle = bundle.replaceAll('0.9.16', '0.9.17');
fs.writeFileSync(outputPath, bundle, 'utf8');
console.log('Built ' + path.relative(root, outputPath));
