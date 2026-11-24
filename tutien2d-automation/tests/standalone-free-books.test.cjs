const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/standalone/free-books-main.js', 'utf8');

function fixture() {
  let time = 10000, interval, copied = 0, allowConfirmation = true;
  const free = { so_cap: true, bi_dong: true };
  const p = { x: 0, y: 0, hp: 100, hpMax: 100, state: 'idle', flying: false };
  const npc = { id: 'tang_kinh_lao_nhan' };
  const g = { Quest: { stage: 16 }, SceneWorld: { player: p, map: { data: { id: 'tan_vien' }, props: [npc] }, autoOn: false },
    HUD: { dialogOpen: false }, GachaUI: { open: false, rolling: false, show(id) { this.open = true; g.Gacha.activePoolId = id; } },
    Gacha: { activePoolId: 'so_cap', open: () => true, freeToday: (_, id) => free[id], soldOut: () => false },
    Targeting: { list: [npc], current: () => ({ obj: npc, dist: 2, r: 40 }), cycle() {} } };
  const handlers = {}, ui = {};
  for (const id of ['status', 'start', 'stop', 'log', 'drag', 'fold', 'panel-body']) ui[id] = { textContent: '', disabled: false, hidden: false,
    addEventListener: (name, f) => { handlers[id + ':' + name] = f; if (name === 'click') handlers[id] = f; }, setAttribute() {}, setPointerCapture() {} };
  const shadow = { innerHTML: '', getElementById: id => ui[id] };
  const host = { style: {}, attachShadow: () => shadow, getBoundingClientRect: () => ({ left: 12, top: 120, width: 285, height: 120 }) };
  let drawLabel = 'Rút 1 · Miễn phí hôm nay';
  const button = { disabled: false, getClientRects: () => [{}], get textContent() { return drawLabel; },
    click() { copied++; if (allowConfirmation) free[g.Gacha.activePoolId] = false; } };
  const choices = ['Tàng Kinh Sơ Cấp', 'Tàng Kinh Bị Động'].map(label => ({ disabled: false, textContent: label,
    getClientRects: () => [{}], click() { g.HUD.dialogOpen = false; g.GachaUI.open = true; } }));
  const tabs = [{ textContent: 'Sơ Cấp', id: 'so_cap' }, { textContent: 'Bị Động', id: 'bi_dong' }].map(o => ({ ...o,
    disabled: false, getClientRects: () => [{}], click() { g.Gacha.activePoolId = o.id; } }));
  const doc = { documentElement: { appendChild() {} }, createElement: () => host, addEventListener() {},
    dispatchEvent(event) { if (event.type === 'keydown' && event.code === 'KeyE') g.HUD.dialogOpen = true; },
    querySelector(selector) { if (selector === '#gacha-one') return button;
      if (selector === '#gacha-close') return { click() { g.GachaUI.open = false; } };
      if (selector === '#dialog-title') return { textContent: 'Tàng Kinh Lão Nhân' };
      if (selector === '#dialog-close') return { click() { g.HUD.dialogOpen = false; } }; return null; },
    querySelectorAll(selector) { if (selector === '#gacha-pools button') return tabs;
      if (selector === '#dialog-choices button') return choices; return []; } };
  const nav = { start: () => true, status: () => ({ running: false, state: 'DONE' }), tick() {}, stop() {} };
  const A = { createGameAccess: () => ({ get: () => g, diagnostics: () => ({}) }), findNpc: () => ({ x: 0, y: 0, r: 40 }),
    createController: () => ({ reset() {} }), createNavigation: () => nav };
  const context = { A, document: doc, window: { innerWidth: 1000, innerHeight: 700, addEventListener() {} }, localStorage: { getItem() { return null; }, setItem() {} }, KeyboardEvent: class { constructor(type, values) { this.type = type; Object.assign(this, values); } },
    Date: class extends Date { static now() { return time; } }, setInterval(f) { interval = f; }, setTimeout() {}, URL: {}, Blob: class {}, console };
  vm.runInNewContext(source, context);
  return { g, free, ui, bridge: context.window.TuTienFreeBooks, start: () => handlers.start(), tick(ms = 1500) { time += ms; interval(); },
    paidLabel() { drawLabel = 'Rút 1 · 100 Linh Thạch'; }, noConfirmation() { allowConfirmation = false; }, get count() { return copied; } };
}

test('monitor bridge reads both free pools without drawing', () => {
  const f = fixture();
  f.free.bi_dong = false;
  const status = f.bridge.status();
  assert.equal(status.ready, true);
  assert.equal(status.pools.find(pool => pool.id === 'so_cap').free, true);
  assert.equal(status.pools.find(pool => pool.id === 'bi_dong').free, false);
  assert.equal(f.count, 0);
  f.g.SceneWorld.player = null;
  assert.equal(f.bridge.status().ready, false);
});

test('visits NPC and draws both available free pools once', () => {
  const f = fixture(); f.start();
  for (let i = 0; i < 20; i++) f.tick();
  assert.equal(f.count, 2); assert.equal(f.free.so_cap, false); assert.equal(f.free.bi_dong, false);
  assert.match(f.ui.status.textContent, /Đã kiểm tra/);
});
test('never clicks a paid option even if free state says available', () => {
  const f = fixture(); f.paidLabel(); f.start(); for (let i = 0; i < 12; i++) f.tick();
  assert.equal(f.count, 0); assert.match(f.ui.status.textContent, /Không xác nhận/);
});
test('does not draw twice when game has not confirmed the first request', () => {
  const f = fixture(); f.noConfirmation(); f.start(); for (let i = 0; i < 35; i++) f.tick();
  assert.equal(f.count, 1); assert.match(f.ui.status.textContent, /Chưa xác nhận/);
});
test('stage 15 opens the unlocked game shop near the NPC and draws free pools', () => {
  const f = fixture(); f.g.Quest.stage = 15; f.start(); for (let i = 0; i < 20; i++) f.tick();
  assert.equal(f.count, 2); assert.match(f.ui.status.textContent, /Đã kiểm tra/);
});
test('stage 15 cannot open the shop when the game has not unlocked it', () => {
  const f = fixture(); f.g.Quest.stage = 15; f.g.Gacha.open = () => false; f.start();
  assert.equal(f.count, 0); assert.match(f.ui.status.textContent, /chưa mở quầy/);
});
test('stage 15 does not open the shop if the NPC is too far away', () => {
  const f = fixture(); f.g.Quest.stage = 15; f.g.SceneWorld.player.x = 500; f.start();
  for (let i = 0; i < 8; i++) f.tick();
  assert.equal(f.count, 0); assert.match(f.ui.status.textContent, /gần Tàng Kinh/);
});
