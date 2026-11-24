const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const bundle = fs.readFileSync('dist/tutien2d-0.9.7.user.js', 'utf8');
const start = bundle.indexOf('A.createAutoRunner = function');
const end = bundle.indexOf('// src/ui/native-actions.js', start);
assert.ok(start >= 0 && end > start);

function setup(stage) {
  const c = vm.createContext({ Math, Date, Number, Object });
  vm.runInContext('var A={}', c);
  vm.runInContext(fs.readFileSync('src/core/controller.js', 'utf8'), c);
  vm.runInContext(bundle.slice(start, end), c);
  c.A.readDuocCong = () => ({ available: true, tasks: [{ status: 'READY' }], active: null });
  const controller = c.A.createController(), calls = [];
  const game = { Quest: { stage, canOpenSeedMenu: () => true }, HUD: {},
    SceneWorld: { player: { hp: 100, hpMax: 100, state: 'idle', setPath() {} }, map: { data: { id: 'tan_vien' } } } };
  function worker(name) {
    let running = false;
    return { status: () => ({ running, state: running ? 'RUNNING' : 'STOPPED' }),
      start(options) { running = true; calls.push({ name, options }); return true; },
      stop() { running = false; } };
  }
  const intro = worker('intro'), quests = worker('quests'), garden = worker('garden'), navigation = worker('navigation');
  const auto = c.A.createAutoRunner({ getGame: () => game, doc: { dispatchEvent() {}, querySelector() { return null; } },
    host: { KeyboardEvent: class {}, setTimeout() {} }, intro, quests, garden, navigation,
    nativeActions: { cancel() {} }, controller, logger: { add() {} }, now: () => 10000 });
  return { auto, game, calls, intro };
}

test('stage 14 continues intro until reaching stage 15, then starts Dược Công', () => {
  const f = setup(14);
  assert.equal(f.auto.start({ otherScriptsStopped: true }), true);
  f.auto.tick();
  assert.equal(f.calls[0].name, 'intro');
  assert.equal(f.calls[0].options.stopAtStage, 15);
  f.auto.tick();
  assert.equal(f.intro.status().running, true);
  f.game.Quest.stage = 15;
  f.auto.tick(); f.auto.tick();
  assert.equal(f.calls[1].name, 'quests');
});

test('characters already at stage 15 start Dược Công directly', () => {
  const f = setup(15);
  f.auto.start({ otherScriptsStopped: true }); f.auto.tick();
  assert.equal(f.calls[0].name, 'quests');
});
