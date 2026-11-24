const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup({ free = true, readyQuest = true, unsupported = false } = {}) {
  let timer, bookState = { running: false, state: 'IDLE', message: '' }, farmState = { running: false, state: 'IDLE', message: '', gained: 0 },
    quests = { running: false, state: 'IDLE', message: '' }, catalog = { available: true, active: null, tasks: readyQuest ? [{ status: unsupported ? 'NEEDS_ADAPTER' : 'READY', name: 'Việc thử' }] : [] };
  const game = { SceneWorld: { player: {}, autoOn: false }, Gateway: { ready: true, connected: true },
    Gacha: { open: () => true, freeToday: () => free, soldOut: () => false }, Quest: { canOpenSeedMenu: () => true } };
  const auto = { status: () => ({ snapshot: { ready: true }, quests }), startQuests: () => { quests = { running: true, state: 'RUNNING' }; return true; }, stop: () => { quests.running = false; } };
  const farm = { status: () => farmState, start: () => { farmState = { running: true, state: 'CHECK', message: 'farm', gained: 0 }; return true; }, tick() {}, stop: () => { farmState.running = false; } };
  const books = { status: () => bookState, start: () => { bookState = { running: true, state: 'PREPARE', message: 'rút' }; }, tick() {}, stop: () => { bookState.running = false; } };
  const A = { createGameAccess: () => ({ get: () => game, diagnostics: () => ({}) }), createController: () => ({}), createNavigation: () => ({}),
    createStoneFarm: () => farm, createIntegratedBooks: () => books, readDuocCong: () => catalog, stoneFarmCandidates: () => [{ id: 'field', name: 'Bãi thử' }] };
  const document = { getElementById: id => id === 'hud-name' ? { textContent: 'Tester' } : null, addEventListener() {} };
  const window = { TuTienAuto: auto, addEventListener() {}, sessionStorage: { setItem() {}, removeItem() {}, getItem: () => null } };
  vm.runInNewContext('(() => {\n' + fs.readFileSync('src/standalone/combat-pipeline-main.js', 'utf8') + '\n})()', { A, window, document, sessionStorage: window.sessionStorage, setInterval: fn => { timer = fn; }, Date, JSON });
  return { api: window.TuTienStoneFarm, tick: () => timer(), completeBooks() { bookState = { running: false, state: 'DONE', message: 'xong' }; },
    completeQuest() { quests = { running: false, state: 'DONE', message: 'xong' }; catalog = { available: true, active: null, tasks: [] }; },
    failQuest() { quests = { running: false, state: 'ERROR', message: 'lỗi nhiệm vụ' }; }, get farmStarted() { return farmState.running; } };
}

test('thứ tự bí tịch, Dược Công, sau đó farm', () => {
  const x = setup(); assert.equal(x.api.start(), true); x.tick(); assert.equal(x.api.status().phase, 'BOOKS');
  x.completeBooks(); x.tick(); x.tick(); assert.equal(x.api.status().phase, 'QUESTS'); assert.equal(x.farmStarted, false);
  x.completeQuest(); x.tick(); x.tick(); x.tick(); assert.equal(x.api.status().phase, 'FARM'); assert.equal(x.farmStarted, true);
});
test('bỏ qua bí tịch hết lượt, Dược Công hết lượt thì farm', () => {
  const x = setup({ free: false, readyQuest: false }); x.api.start(); x.tick(); x.tick(); x.tick();
  assert.equal(x.api.status().phase, 'FARM');
});
test('nhiệm vụ chưa hỗ trợ được báo lại; lỗi thực thi vẫn dừng', () => {
  const a = setup({ free: false, unsupported: true }); a.api.start(); a.tick(); a.tick();
  a.tick(); assert.equal(a.api.status().state, 'FARM'); assert.equal(a.api.status().skippedTasks.length, 1);
  const b = setup({ free: false }); b.api.start(); b.tick(); b.tick(); b.failQuest(); b.tick();
  assert.equal(b.api.status().state, 'ERROR'); assert.equal(b.farmStarted, false);
});

test('chỉ nhận bản đồ phù hợp và giữ lựa chọn trong trạng thái', () => {
  const x = setup({ free: false, readyQuest: false });
  assert.equal(x.api.start({ mapId: 'field' }), true);
  assert.equal(x.api.status().preferredMapId, 'field');
  x.tick(); x.tick(); x.tick(); assert.equal(x.api.status().phase, 'FARM');
  const y = setup(); assert.equal(y.api.start({ mapId: 'unknown' }), false);
  assert.equal(y.api.status().state, 'ERROR');
});
