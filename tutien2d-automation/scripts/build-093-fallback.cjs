const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let base = fs.readFileSync(path.join(root, 'dist/tutien2d-0.9.2.user.js'), 'utf8');
let fallback = fs.readFileSync(path.join(root, 'dist/tutien2d-test.user.js'), 'utf8');
base = base.replace(/0\.9\.[12]/g, '0.9.3');
fallback = fallback.replace("const version = '0.4.1';", "const version = '0.9.3-hud';")
  .replace('TuTien2D · Bảng test ${version}', 'TuTien2D · Chế độ HUD ${version}');
const tail = '\n})();';
const end = base.lastIndexOf(tail);
if (end < 0 || !fallback.includes("const version = '0.9.3-hud';")) throw Error('Unexpected userscript format');
const bridge = `
// The original automation requires game internals. If they are unavailable,
// switch to the separately maintained HUD automation after the game HUD appears.
const bridgeStartedAt = Date.now();
const bridgeTimer = setInterval(() => {
  if (disposed) { clearInterval(bridgeTimer); return; }
  const game = access.get();
  if (game?.SceneWorld?.player && game?.SceneWorld?.map?.data?.id) {
    clearInterval(bridgeTimer); return;
  }
  const hud = document.getElementById('hud');
  const map = document.getElementById('hud-map');
  const pos = document.getElementById('hud-pos');
  if (Date.now() - bridgeStartedAt < 4000 || !hud || hud.hidden || hud.classList.contains('hidden') ||
      !map?.textContent.trim() || !pos?.textContent.match(/\\(\\s*-?\\d+\\s*,\\s*-?\\d+\\s*\\)/) ||
      !hud.getClientRects().length || document.getElementById('tutien2d-smoke-test')) return;
  clearInterval(bridgeTimer);
  api.dispose();
  ${fallback}
}, 500);
`;
fs.writeFileSync(path.join(root, 'dist/tutien2d-0.9.3.user.js'), base.slice(0, end) + bridge + base.slice(end));
