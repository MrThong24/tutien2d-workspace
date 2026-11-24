const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function source(file) { return fs.readFileSync(path.join(root, 'src', file), 'utf8'); }
function helpers() {
  const context = vm.createContext({ Date, Math, Map, Set, console });
  vm.runInContext('var A = {};', context);
  for (const file of ['core/game-access.js', 'core/logger.js', 'core/controller.js', 'navigation/map-graph.js', 'navigation/pathfinder.js', 'npc/npc-finder.js', 'core/state-reader.js', 'navigation/portal-travel.js']) vm.runInContext(source(file), context);
  return context.A;
}
function publicMaps() {
  const c = vm.createContext({ window: { PNTT: {} } });
  const filename = fs.readdirSync(path.join(root, 'evidence')).find(n => n.startsWith('mapdata.'));
  vm.runInContext(fs.readFileSync(path.join(root, 'evidence', filename), 'utf8'), c);
  return c.window.PNTT.MapData;
}
function fixture() {
  const A = helpers();
  let time = 10000;
  const log = A.createLogger(300), controller = A.createController(), calls = [];
  const MapData = {
    A: { id: 'a', portals: [{ tx: 3, ty: 1, toMap: 'b' }, { tx: 4, ty: 1, toMap: 'b' }] },
    B: { id: 'b', portals: [] }
  };
  const player = { x: 16, y: 48, hp: 100, state: 'idle', path: [], setPath(p) { this.path = p; calls.push(p); } };
  const game = { CONFIG: { TILE: 32, PLAYER: { HITBOX_W: 16, HITBOX_H: 12 } }, MapData,
    SceneWorld: { player, map: { data: MapData.A, portals: MapData.A.portals, props: [] }, autoOn: false },
    Pathfinder: { route(map, x, y, tx, ty) { return [{ x: tx, y: ty }]; } }, HUD: {} };
  const navigation = A.createNavigation({ getGame: () => game, logger: log, controller, now: () => time });
  return { A, game, navigation, log, controller, calls, advance(ms) { time += ms; navigation.tick(); } };
}

test('public map data proves directed tan_vien → thanh_truc_lam → duoc_vien', () => {
  const A = helpers(), maps = publicMaps();
  const route = A.mapRoute(maps, 'tan_vien', 'duoc_vien');
  assert.deepEqual(JSON.parse(JSON.stringify(route)), [
    { from: 'tan_vien', to: 'thanh_truc_lam' }, { from: 'thanh_truc_lam', to: 'duoc_vien' }
  ]);
  assert.equal(maps.DUOC_VIEN.props.find(p => p.id === 'dai_phu').block, true);
  assert.equal(A.mapRoute(maps, 'missing', 'duoc_vien'), null);
});

test('BFS handles cycles and excludes manual/cooldown portals', () => {
  const A = helpers();
  const maps = { a: { id: 'a', portals: [{ tx: 0, ty: 0, toMap: 'b', byHand: true }] }, b: { id: 'b', portals: [{ tx: 0, ty: 0, toMap: 'a' }] } };
  assert.equal(A.mapRoute(maps, 'a', 'b'), null);
  maps.a.portals[0].byHand = false; maps.a.portals[0].cooldownSec = 10;
  assert.equal(A.mapRoute(maps, 'a', 'b'), null);
  assert.equal(A.mapRoute(maps, 'a', 'a').length, 0);
});

test('capture survives actual namespace deletion and undefined assignment', () => {
  const A = helpers(), host = {}, access = A.createGameAccess(host);
  const g = { SceneWorld: {} };
  host.PNTT = g; host.PNTT = undefined; delete host.PNTT;
  assert.equal(access.get(), g);
});

test('capture preserves an existing debug setter', () => {
  const A = helpers(), host = {};
  let stored;
  Object.defineProperty(host, 'PNTT', { configurable: true, get: () => stored, set: v => { stored = v; } });
  const access = A.createGameAccess(host), value = {};
  host.PNTT = value;
  assert.equal(stored, value); delete host.PNTT;
  assert.equal(access.get(), value);
});

test('capture uses a setter value when an existing getter still returns undefined', () => {
  const A = helpers(), host = {};
  Object.defineProperty(host, 'PNTT', { configurable: true, get: () => undefined });
  const access = A.createGameAccess(host), value = { SceneWorld: {} };
  host.PNTT = value;
  assert.equal(access.get(), value);
});

test('PNTT takes precedence over stale gameDebug', () => {
  const A = helpers(), host = {}, current = { SceneWorld: {} }, stale = { old: true };
  host.gameDebug = stale;
  const access = A.createGameAccess(host);
  host.PNTT = current;
  assert.equal(access.get(), current);
});

test('diagnostic limits log size and never walks arbitrary game/account fields', () => {
  const A = helpers(), log = A.createLogger(3);
  for (let i = 0; i < 10; i++) log.add('TEST', { i });
  assert.equal(log.size(), 3); assert.equal(log.records()[0].data.i, 7);
  const g = { token: 'TOP_SECRET', Quest: { stage: 21, flags: { secret: 'TOP_SECRET' } }, SceneWorld: { player: { x: 1, y: 2, token: 'TOP_SECRET' }, map: { data: { id: 'a' } } } };
  assert.ok(!JSON.stringify(A.readState(g, null)).includes('TOP_SECRET'));
});

test('idle/Stop never clears a path owned by the player', () => {
  const f = fixture(); f.advance(1000); f.navigation.stop();
  assert.equal(f.calls.length, 0);
});

test('navigation refuses missing confirmation and conflicting native Auto', () => {
  const f = fixture();
  assert.equal(f.navigation.start({ target: 'b', npcId: null }), false);
  f.game.SceneWorld.autoOn = true;
  assert.equal(f.navigation.start({ target: 'b', npcId: null, otherScriptsStopped: true }), false);
  assert.equal(f.calls.length, 0);
});

test('route waits for a real map change, then releases its control', () => {
  const f = fixture();
  assert.equal(f.navigation.start({ target: 'b', npcId: null, otherScriptsStopped: true }), true);
  assert.equal(f.navigation.status().state, 'TRAVEL_TO_MAP');
  f.game.SceneWorld.player.x = 112; f.game.SceneWorld.player.y = 48;
  f.advance(1000);
  assert.equal(f.navigation.status().running, true);
  f.game.SceneWorld.transitioning = true; f.advance(1000);
  assert.equal(f.navigation.status().running, true);
  f.game.SceneWorld.map.data = f.game.MapData.B;
  f.game.SceneWorld.map.portals = [];
  f.game.SceneWorld.transitioning = false;
  f.advance(1000); f.advance(1000);
  assert.equal(f.navigation.status().state, 'DONE');
  assert.equal(f.controller.status().owner, null);
});

test('Stop clears owned path and later ticks cannot issue movement', () => {
  const f = fixture();
  f.navigation.start({ target: 'b', npcId: null, otherScriptsStopped: true });
  f.navigation.stop();
  assert.equal(f.calls.at(-1).length, 0);
  const count = f.calls.length; f.advance(100000);
  assert.equal(f.calls.length, count);
  assert.equal(f.controller.status().owner, null);
});

test('stuck retries end with ERROR after three assignments', () => {
  const f = fixture(); f.navigation.start({ target: 'b', npcId: null, otherScriptsStopped: true });
  f.advance(5001); f.advance(5001); f.advance(5001);
  assert.equal(f.navigation.status().state, 'ERROR');
  assert.equal(f.log.records().filter(e => e.event === 'PATH_ASSIGNED').length, 3);
  assert.equal(f.controller.status().owner, null);
});

test('unexpected map change stops instead of continuing blindly', () => {
  const f = fixture(); f.navigation.start({ target: 'b', npcId: null, otherScriptsStopped: true });
  f.game.SceneWorld.map.data = { id: 'elsewhere' }; f.advance(1000);
  assert.equal(f.navigation.status().state, 'ERROR');
});

test('rejects route() snapping away from the requested portal tile', () => {
  const f = fixture();
  f.game.Pathfinder.route = () => [{ x: 16, y: 16 }];
  assert.equal(f.A.makePath(f.game, { x: 112, y: 48 }, { tx: 3, ty: 1 }), null);
});

test('rejects a path that would activate a portal outside its selected tile', () => {
  const f = fixture();
  f.game.SceneWorld.map.portals.unshift({ tx: 1, ty: 1, toMap: 'elsewhere' });
  assert.equal(f.A.makePath(f.game, { x: 112, y: 48 }, { tx: 3, ty: 1 }), null);
});

test('NPC path uses runtime coordinates and approaches beside blocked tile', () => {
  const f = fixture(), w = f.game.SceneWorld;
  w.map.data = f.game.MapData.B; w.map.portals = [];
  w.map.props = [{ id: 'dai_phu', type: 'npc', x: 144, y: 96, r: 48 }];
  assert.equal(f.A.findNpc(f.game, 'dai_phu').y, 80);
  f.navigation.start({ target: 'b', npcId: 'dai_phu', otherScriptsStopped: true });
  assert.equal(f.navigation.status().state, 'MOVE_TO_NPC');
  const destination = w.player.path.at(-1);
  assert.ok(Math.hypot(destination.x - 144, destination.y - 80) <= 36);
  w.player.x = destination.x; w.player.y = destination.y; f.advance(1000);
  assert.equal(f.navigation.status().state, 'DONE');
});

test('leg timeout and global transition timeout are bounded', () => {
  const f = fixture(); f.navigation.start({ target: 'b', npcId: null, otherScriptsStopped: true });
  f.advance(66000); assert.equal(f.navigation.status().state, 'ERROR');
  const t = fixture(); t.navigation.start({ target: 'b', npcId: null, otherScriptsStopped: true });
  t.game.SceneWorld.transitioning = true; t.advance(240001);
  assert.equal(t.navigation.status().state, 'ERROR');
});
