const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const base = path.resolve(__dirname, '../evidence');
const html = fs.readFileSync(path.join(base, 'index.html'), 'utf8');
const urls = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => new URL(m[1], 'https://tutien2d.com/'));
const files = fs.readdirSync(base).filter(f => f.endsWith('.js') || f === 'index.html');
const manifest = files.map(file => {
  const data = fs.readFileSync(path.join(base, file));
  return { file, url: file === 'index.html' ? 'https://tutien2d.com/?choi' : String(urls.find(u => path.basename(u.pathname) === file)),
    bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
});
fs.writeFileSync(path.join(base, 'manifest.json'), JSON.stringify({ collectedOn: '2026-11-17', files: manifest }, null, 2));
const context = vm.createContext({ window: { PNTT: {} } });
const mapfile = files.find(f => f.startsWith('mapdata.'));
vm.runInContext(fs.readFileSync(path.join(base, mapfile), 'utf8'), context);
const maps = context.window.PNTT.MapData;
const route = ['TAN_VIEN', 'THANH_TRUC_LAM', 'DUOC_VIEN'].map((key, i, all) => ({
  id: maps[key].id, name: maps[key].name,
  portalsToNext: i + 1 < all.length ? maps[key].portals.filter(p => p.toMap === maps[all[i + 1]].id) : [],
  npc: maps[key].props.filter(p => p.id === 'dai_phu').map(({ id, type, tx, ty, r, block }) => ({ id, type, tx, ty, r, block }))
}));
fs.writeFileSync(path.join(base, 'route-source.json'), JSON.stringify({ basis: mapfile, note: 'Static source only; runtime may include map extensions. Userscript always reads live MapData and SceneWorld.', route }, null, 2));
const needles = {
  'config.': ['TILE:32', 'HITBOX_W:16,HITBOX_H:12'],
  'tilemap.': ['x:r.tx*t+t/2,y:(r.ty+1)*t', 'o.checkPortal=function'],
  'pathfinding.': ['n.route=function'],
  'world.': ['n.Input.consumeInteract()', 'function xn(', 'function Ze(', 'i.autoDCStop=We,i.autoDCStart=ze', 'Tự Đi Làm Việc Dược Công'],
  'input.': ['"KeyE"!==t.code&&"Enter"!==t.code'],
  'main.': ['delete window.PNTT']
};
const excerpts = [];
for (const [prefix, terms] of Object.entries(needles)) {
  const file = files.find(f => f.startsWith(prefix));
  const text = fs.readFileSync(path.join(base, file), 'utf8');
  for (const term of terms) {
    const offset = text.indexOf(term);
    if (offset < 0) throw Error('Evidence missing: ' + term);
    excerpts.push({ file, utf16Offset: offset, term, excerpt: text.slice(Math.max(0, offset - 60), offset + term.length + 250) });
  }
}
fs.writeFileSync(path.join(base, 'source-findings.json'), JSON.stringify(excerpts, null, 2));
console.log('Wrote manifest, route-source.json, source-findings.json');
