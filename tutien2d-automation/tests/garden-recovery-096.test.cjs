const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const bundle = fs.readFileSync('dist/tutien2d-0.9.6.user.js', 'utf8');
const start = bundle.indexOf('A.createGarden = function');
const end = bundle.indexOf('// src/core/auto-runner.js', start);
assert.ok(start >= 0 && end > start);

function fixture() {
  const c = vm.createContext({ Math, Date, Array, Number });
  vm.runInContext('var A={}', c);
  vm.runInContext(fs.readFileSync('src/core/controller.js', 'utf8'), c);
  vm.runInContext(bundle.slice(start, end), c);
  c.A.readGarden = () => ({ plots: [], seeds: [], experience: { full: false } });
  c.A.planGarden = () => ({ kind: 'waitResources', reason: 'wait' });
  let time = 10000, target = null, navigationState = 'DONE';
  const events = [], journeys = [], logs = [];
  const p = { x: 0, y: 0, hp: 100, hpMax: 100, state: 'idle', setPath() {} };
  const w = { player: p, map: { data: { id: 'vuon_ca_nhan' }, props: [] }, enemies: [], autoOn: false };
  const g = { SceneWorld: w, HUD: {}, Inventory: { count: () => 0 } };
  const controller = c.A.createController();
  const navigation = {
    start(options) { target = options.target; journeys.push(target); return true; },
    status() { return { state: navigationState, running: false }; }, stop() {}
  };
  const doc = { dispatchEvent(event) { if (event.type === 'keydown') events.push(event.code); }, querySelector() { return null; } };
  const garden = c.A.createGarden({ getGame: () => g, doc, host: { KeyboardEvent: class { constructor(type, fields) { this.type = type; Object.assign(this, fields); } } },
    logger: { add(event) { logs.push(event); } }, controller, navigation, flight: null, now: () => time });
  assert.equal(garden.start({ otherScriptsStopped: true }), true);
  return { p, w, garden, journeys, events, logs, tick() { time += 1100; garden.tick(); },
    arrive() { w.map.data.id = target; }, failNavigation() { navigationState = 'ERROR'; } };
}

test('low health stops combat, rests outside garden, then resumes', () => {
  const f = fixture();
  f.p.hp = 39; f.w.autoOn = true; f.tick();
  assert.equal(f.events.at(-1), 'KeyT');
  assert.equal(f.journeys.length, 0);
  f.w.autoOn = false; f.tick();
  assert.equal(f.journeys.at(-1), 'duoc_vien');
  f.arrive(); f.tick();
  assert.equal(f.garden.status().state, 'HEAL');
  assert.equal(f.events.at(-1), 'KeyQ');
  f.p.state = 'sit'; f.p.hp = 64; f.tick();
  assert.equal(f.journeys.length, 1);
  f.p.hp = 65; f.tick();
  assert.equal(f.events.at(-1), 'KeyQ');
  f.p.state = 'idle'; f.tick();
  assert.equal(f.journeys.at(-1), 'vuon_ca_nhan');
  f.arrive(); f.tick();
  assert.equal(f.garden.status().running, true);
  assert.ok(f.logs.includes('GARDEN_HEAL_DONE'));
});

test('failed escape stops the worker with an error', () => {
  const f = fixture(); f.p.hp = 39; f.tick(); f.failNavigation(); f.tick();
  assert.equal(f.garden.status().running, false);
  assert.equal(f.garden.status().state, 'ERROR');
});
