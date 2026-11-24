const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const c = vm.createContext({ Date, Number, Array, Object, Math });
vm.runInContext('var A={}', c);
vm.runInContext(fs.readFileSync('src/farm/garden-hud-adapter.js', 'utf8'), c);
vm.runInContext(fs.readFileSync('src/farm/garden-planner-original-0.9.1.js', 'utf8'), c);

test('the supplied garden snapshot maps to ten mature plots and two missing pills', () => {
  const now = 1795100409334, farm = {};
  for (let i = 1; i <= 10; i++) farm['plot_' + i] = {
    seed: i <= 5 ? 'hat_bich_van' : 'hat_long_huyet', at: 1795099154875, dur: 480602, wet: true
  };
  const saved = { realm: 'luyen_khi_10', farm, bag: { hat_bich_van: 1, hat_long_huyet: 1, linh_thuy: 198 } };
  const hud = { ready: true, realm: 'Luyện Khí Tầng 10', experienceFull: true, breakthrough: [
    { label: 'Đạo Hạnh', current: '2820', need: '2820', done: true },
    { label: 'Phá Cảnh Đan', current: '0', need: '2', done: false }
  ] };
  const data = c.A.readGardenFromHud(saved, hud, now);
  assert.equal(data.plots.filter(p => p.ready).length, 10);
  assert.equal(data.goal.materials[0].required, 6);
  assert.equal(data.goal.materials[2].have, 198);
  assert.equal(data.confidence.enemies, 'only-current-target');
  const g = { SceneWorld: { enemies: [], brewCooldownUntil: 0 }, Game: { time: 1 }, Farm: { SEEDS: [] }, Quest: { SEED_PACKS: [] } };
  // This is a planning preview: the live enemy and plot state is not verified.
  assert.equal(c.A.planGarden(g, data).kind, 'harvest');
});

test('rejects mismatched realm, pill counts and invalid plot timing', () => {
  const hud = { ready: true, realm: 'Luyện Khí Tầng 10', breakthrough: [{ label: 'Phá Cảnh Đan', current: '0', need: '2' }] };
  assert.equal(c.A.readGardenFromHud({ realm: 'luyen_khi_9', farm: {}, bag: {} }, hud, 1), null);
  assert.equal(c.A.readGardenFromHud({ realm: 'luyen_khi_10', farm: {}, bag: { pha_canh_dan: 1 } }, hud, 1), null);
  assert.equal(c.A.readGardenFromHud({ realm: 'luyen_khi_10', farm: { plot_1: { seed: 'hat_bich_van' } }, bag: {} }, hud, 1), null);
});
