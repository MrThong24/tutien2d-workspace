const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('dist/tutien2d-0.9.11.user.js', 'utf8');
const start = source.indexOf('A.gardenSeedPurchaseAllowed ='), end = source.indexOf('// src/farm/ascension.js', start);
assert.ok(start >= 0 && end > start);
const ctx = vm.createContext({ Math, Set, Number }); vm.runInContext('var A={}', ctx); vm.runInContext(source.slice(start, end), ctx);
function fixture(realm) {
  const game = { Progress: { realmId: realm }, SceneWorld: { player: { realmId: realm }, enemies: [] }, Game: { time: 1 },
    Farm: { SEEDS: [{ seed: 'hat_linh_ngoc', crop: 'linh_ngoc_diep' }] }, Quest: {
      packUnlocked: () => true, SEED_PACKS: [{ cost: 5, give: [['hat_linh_ngoc', 3]] }]
    } };
  const data = { experience: { full: true }, breakthrough: { ready: false }, water: true,
    plots: [], seeds: [], duocCong: 20, goal: { id: 'luyen_khi_dan', name: 'Luyện Khí Đan', have: 0, need: 1,
      materials: [{ id: 'linh_ngoc_diep', have: 0, qty: 3 }] } };
  return { game, data };
}
test('before tầng 13, a matching seed pack can still be selected', () => {
  const f = fixture('luyen_khi_12'); assert.equal(ctx.A.planGarden(f.game, f.data).kind, 'buySeeds');
});
test('at tầng 13 and Trúc Cơ, no seed exchange is selected', () => {
  for (const realm of ['luyen_khi_13', 'truc_co_1']) {
    const f = fixture(realm); const decision = ctx.A.planGarden(f.game, f.data);
    assert.equal(decision.kind, 'waitResources'); assert.match(decision.reason, /không đi đổi thêm hạt/);
  }
});
test('an unknown realm does not authorize spending', () => {
  const f = fixture('unknown'); const decision = ctx.A.planGarden(f.game, f.data);
  assert.equal(decision.kind, 'waitResources'); assert.match(decision.reason, /Chưa xác định/);
});
test('existing seeds may still be planted at tầng 13', () => {
  const f = fixture('luyen_khi_13'); f.data.plots = [{ id: 'plot_1', seed: null }];
  f.data.seeds = [{ id: 'hat_linh_ngoc', crop: 'linh_ngoc_diep', qty: 2 }];
  assert.equal(ctx.A.planGarden(f.game, f.data).kind, 'sow');
});
test('realm ordering covers higher realms defined by the game', () => {
  const f = fixture('new_higher_realm'); f.game.REALMS = [{ id: 'luyen_khi_12' }, { id: 'luyen_khi_13' }, { id: 'new_higher_realm' }];
  assert.equal(ctx.A.gardenSeedPurchaseAllowed(f.game), false);
});
test('does not buy when either realm source has already reached tầng 13', () => {
  const f = fixture('luyen_khi_12'); f.game.SceneWorld.player.realmId = 'luyen_khi_13';
  assert.equal(ctx.A.gardenSeedPurchaseAllowed(f.game), false);
});
