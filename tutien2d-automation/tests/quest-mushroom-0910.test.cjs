const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('dist/tutien2d-0.9.10.user.js', 'utf8');
const start = source.indexOf('A.createQuestRunner = function');
const end = source.indexOf('// src/quests/later-intro.js', start);
assert.ok(start >= 0 && end > start);

function fixture({ complete = false, alternatives = true } = {}) {
  const c = vm.createContext({ Math, Date, Set, Map }); vm.runInContext('var A={}', c);
  vm.runInContext(fs.readFileSync('src/core/controller.js', 'utf8'), c);
  vm.runInContext(source.slice(start, end), c);
  let now = 10000;
  const logs = [], keys = [];
  const first = { id: 'linh_chi_1', x: 300, y: 316, r: 40 };
  const second = { id: 'linh_chi_2', x: 600, y: 216, r: 40 };
  const props = alternatives ? [first, second] : [first];
  const active = { id: 'linh_chi', name: 'Linh Chi', progress: complete ? 3 : 2, need: 3, complete, round: 0 };
  c.A.readDuocCong = () => ({ available: true, active, tasks: [{ id: 'linh_chi', status: 'READY' }] });
  const p = { x: 0, y: 0, hp: 100, hpMax: 100, state: 'idle', setPath(path) {
    if (path.length) { this.x = path.at(-1).x; this.y = path.at(-1).y; }
  } };
  const g = { CONFIG: { TILE: 32 }, MapData: {}, HUD: { dialogOpen: false }, Inventory: { count: () => complete ? 3 : 2 },
    Progress: { duocCong: 0 }, Quest: { seedTaskInfo: () => ({ propIds: props.map(o => o.id) }),
      autoSeedStep: () => ({ act: 'hai', place: { mapId: 'tan_vien', ids: props.map(o => o.id) } }) },
    SceneWorld: { player: p, map: { data: { id: 'tan_vien' }, props, portals: [{ tx: 2, ty: 2, toMap: 'duoc_vien' }] } },
    Targeting: { list: [second], current: () => ({ obj: second, kind: 'prop', dist: 10, r: 40 }), cycle() {} } };
  c.A.tileCenter = (_, x, y) => ({ x: x * 32 + 16, y: y * 32 + 16 });
  c.A.makePath = (_, target) => Math.hypot(target.x - 300, target.y - 300) < 70 ? null : [target];
  c.A.automaticPortal = () => true; c.A.mapRoute = () => [{ to: 'duoc_vien' }];
  const doc = { dispatchEvent(event) { if (event.type === 'keydown') keys.push(event.code); }, querySelector: () => null };
  const controller = c.A.createController();
  const runner = c.A.createQuestRunner({ getGame: () => g, doc, host: { KeyboardEvent: class {
    constructor(type, fields) { this.type = type; Object.assign(this, fields); }
  } }, controller, logger: { add(event, data) { logs.push({ event, data }); } }, now: () => now });
  assert.equal(runner.start({ otherScriptsStopped: true }), true);
  return { runner, logs, keys, tick(ms = 6000) { now += ms; runner.tick(); } };
}

test('skips an unreachable mushroom and interacts with an alternative', () => {
  const f = fixture();
  for (let i = 0; i < 9 && !f.keys.includes('KeyE'); i++) f.tick();
  assert.ok(f.logs.some(e => e.event === 'QUEST_MUSHROOM_SKIP' && e.data.id === 'linh_chi_1'));
  assert.ok(f.keys.includes('KeyE'));
  assert.equal(f.runner.status().running, true);
});
test('when already complete, returns to the physician if remaining mushrooms are unreachable', () => {
  const f = fixture({ complete: true, alternatives: false });
  for (let i = 0; i < 7; i++) f.tick();
  assert.ok(f.logs.some(e => e.event === 'QUEST_BATCH_EARLY_RETURN'));
  assert.equal(f.runner.status().running, true);
});
