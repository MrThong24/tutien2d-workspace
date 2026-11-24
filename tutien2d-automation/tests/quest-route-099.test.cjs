const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const file = fs.readFileSync('dist/tutien2d-0.9.9.user.js', 'utf8');
const start = file.indexOf('A.createQuestRunner = function');
const end = file.indexOf('// src/quests/later-intro.js', start);
assert.ok(start >= 0 && end > start);
function fixture() {
  const context = vm.createContext({ Math, Date, Set, Map }); vm.runInContext('var A={}', context);
  vm.runInContext(file.slice(start, end), context);
  const log = [], paths = [];
  const player = { x: 48, y: 48, setPath(path) { paths.push(path); } };
  const game = { CONFIG: { TILE: 32 }, MapData: {}, SceneWorld: { player,
    map: { data: { id: 'a' }, portals: [{ tx: 1, ty: 1, toMap: 'b' }] } } };
  context.A.mapRoute = (_, from) => from === 'unreachable' ? null : [{ to: from === 'a' ? 'b' : 'goal' }];
  context.A.tileCenter = (_, x, y) => ({ x: x * 32 + 16, y: y * 32 + 16 });
  context.A.automaticPortal = () => true;
  context.A.makePath = (_, target) => [target];
  const runner = context.A.createQuestRunner({ getGame: () => game, doc: {}, host: {},
    controller: {}, logger: { add(event, data) { log.push({ event, data }); } }, now: () => 10000 });
  return { game, player, movement: runner.movement, log, paths };
}
test('replans from an unexpected reachable map after a portal', () => {
  const f = fixture(); assert.equal(f.movement.travel(f.game, 'goal'), false);
  f.game.SceneWorld.map = { data: { id: 'c' }, portals: [{ tx: 2, ty: 2, toMap: 'goal' }] };
  assert.equal(f.movement.travel(f.game, 'goal'), false);
  const replan = f.log.find(entry => entry.event === 'QUEST_ROUTE_REPLAN');
  assert.ok(replan);
  assert.equal(replan.data.actual, 'c');
  assert.equal(f.movement.travel(f.game, 'goal'), false);
  assert.ok(f.paths.some(path => path.length));
});
test('explicit stage reset removes an old portal wait', () => {
  const f = fixture(); f.movement.travel(f.game, 'goal'); f.movement.clear();
  f.game.SceneWorld.map = { data: { id: 'c' }, portals: [] };
  assert.equal(f.movement.travel(f.game, 'c'), true);
  assert.equal(f.log.filter(x => x.event === 'QUEST_ROUTE_REPLAN').length, 0);
});
test('reports actual and destination maps when no safe route exists', () => {
  const f = fixture(); f.movement.travel(f.game, 'goal');
  f.game.SceneWorld.map = { data: { id: 'unreachable' }, portals: [] };
  assert.throws(() => f.movement.travel(f.game, 'goal'), /unreachable.*goal/);
});
test('an unexpected map during local movement never applies old coordinates on the new map', () => {
  const f = fixture(); f.movement.move(f.game, { x: 250, y: 250 });
  const before = f.paths.length; f.game.SceneWorld.map.data.id = 'c';
  assert.equal(f.movement.move(f.game, { x: 400, y: 400 }), false);
  assert.equal(f.paths.length, before);
  assert.ok(f.log.some(entry => entry.event === 'QUEST_ROUTE_REPLAN'));
});
