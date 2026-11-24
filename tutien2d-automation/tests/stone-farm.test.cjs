const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const A = {};
vm.runInNewContext(fs.readFileSync('src/farm/stone-planner.js', 'utf8'), { A });
vm.runInNewContext(fs.readFileSync('src/farm/stone-runner.js', 'utf8'), { A });

function fixture() {
  let clock = 100000, balance = 100, day = { da: 0, tran: 10, ngay: 1 }, selected = null;
  const enemy = { id: 'e', type: 'snake', x: 40, y: 40, hp: 10, def: { name: 'Rắn', hp: 10, contactDmg: 1 } };
  const p = { x: 40, y: 40, hp: 100, hpMax: 100, state: 'idle', realmId: 'luyen_khi_9', setPath() {} };
  const game = { CONFIG: { TILE: 32 }, SceneWorld: { player: p, map: { data: { id: 'field', name: 'Bãi' } }, enemies: [enemy], drops: [], autoOn: false },
    Progress: { get stones() { return balance; } }, Gateway: { connected: true, ready: true, selfId: 'self' }, Pathfinder: { route() {} },
    ENEMY_DEFS: { snake: enemy.def }, Quest: { stage: 15 },
    Loot: { PICK_R: 40, stoneToday: () => day, canPick: d => d.owner !== 'other', quaiBoLinhThach: e => e.type === 'excluded' },
    Targeting: { list: [{ kind: 'enemy', obj: enemy }], manual: false, current: () => selected,
      cycle() { selected = this.list[0]; this.manual = true; }, clear() { selected = null; } }, Inventory: { canFit: () => true },
    MapData: {} };
  A.maps = () => new Map([['field', { name: 'Bãi', scope: 'shared', enemies: [{ type: 'snake' }] }]]);
  A.mapRoute = () => [];
  A.tileCenter = (_, x, y) => ({ x: x * 32 + 16, y: y * 32 + 16 });
  A.makePath = (_, pt) => [pt];
  const nodes = { 'hud-name': { textContent: 'Test' } };
  const doc = { getElementById: id => nodes[id] || null, querySelector: id => nodes[id] || null,
    dispatchEvent(event) { if (event.type === 'keydown' && event.key === 't') game.SceneWorld.autoOn = !game.SceneWorld.autoOn; if (event.type === 'keydown' && event.key === 'f') p.flying = !p.flying; if (event.type === 'keydown' && event.key === 'q') p.state = p.state === 'sit' ? 'idle' : 'sit'; } };
  const host = { KeyboardEvent: class { constructor(type, args) { this.type = type; this.key = args.key; } }, sessionStorage: { setItem() {}, removeItem() {} } };
  let owner = null;
  const controller = { acquire(id) { if (owner && owner !== id) return false; owner = id; return true; }, release(id) { if (owner === id) owner = null; }, owns(id) { return owner === id; }, reset() { owner = null; } };
  const navigation = { start: () => false, stop() {}, status: () => ({}), tick() {} };
  const farm = A.createStoneFarm({ getGame: () => game, doc, host, controller, navigation, now: () => clock, random: () => 0 });
  return { farm, game, enemy, nodes, host, doc, navigation, advance(ms = 1000) { clock += ms; farm.tick(); }, add(n) { balance += n; }, cap() { day = { da: 10, tran: 10, ngay: 1 }; } };
}

test('chỉ chọn quái có dữ liệu an toàn và đủ điều kiện rơi', () => {
  const { game, enemy } = fixture();
  assert.equal(A.stoneFarmEnemy(game, enemy, 'field'), true);
  assert.equal(A.stoneFarmEnemy(game, { ...enemy, type: 'excluded' }, 'field'), false);
  assert.equal(A.stoneFarmEnemy(game, { ...enemy, def: { ...enemy.def, isBoss: true } }, 'field'), false);
  assert.equal(A.stoneFarmEnemy(game, { ...enemy, def: { hp: 10 } }, 'field'), false);
  assert.equal(A.stoneFarmCandidates(game)[0].id, 'field');
});

test('khóa mục tiêu, tiếp tục đánh khi có đá rơi và tính tăng ví', () => {
  const f = fixture(); assert.equal(f.farm.start({ otherScriptsStopped: true }), true);
  f.advance(); f.advance(); assert.equal(f.game.SceneWorld.autoOn, true);
  f.advance(); assert.equal(f.farm.status().state, 'COMBAT');
  f.game.SceneWorld.drops.push({ kind: 'item', itemId: 'linh_thach', lootId: 'd', state: 'ground', x: 40, y: 40, owner: 'self' });
  f.advance(); f.advance(); assert.equal(f.farm.status().state, 'COMBAT');
  assert.equal(f.game.SceneWorld.autoOn, true);
  f.add(3); f.advance();
  assert.equal(f.farm.status().gained, 3);
});

test('dừng khi hết hạn mức và khi có auto khác', () => {
  const f = fixture(); f.farm.start({ otherScriptsStopped: true }); f.cap(); f.advance();
  assert.equal(f.farm.status().state, 'DONE'); assert.equal(f.farm.status().running, false);
  const g = fixture(); g.host.TuTienAuto = { status: () => ({ garden: { running: true } }) };
  assert.equal(g.farm.start({ otherScriptsStopped: true }), false);
});

test('không cần đọc API nhặt đá để tiếp tục đánh', () => {
  const f = fixture(); f.game.SceneWorld.drops.push({ kind: 'item', itemId: 'linh_thach', lootId: 'other', state: 'ground', x: 40, y: 40, owner: 'other' });
  delete f.game.Loot.PICK_R; delete f.game.Loot.canPick;
  f.farm.start({ otherScriptsStopped: true }); f.advance(); f.advance();
  assert.equal(f.farm.status().state, 'COMBAT');
  assert.equal(f.game.SceneWorld.autoOn, true);
});

test('bật phi hành khi đủ điều kiện rồi tiếp tục đánh', () => {
  const f = fixture(); f.game.Player = { canFly: () => true, inNoFlyZone: () => false };
  f.farm.start({ otherScriptsStopped: true }); f.advance();
  assert.equal(f.game.SceneWorld.player.flying, true);
  f.advance(); f.advance();
  assert.equal(f.game.SceneWorld.autoOn, true);
  assert.equal(f.game.SceneWorld.player.flying, true);
});

test('vẫn farm trên mặt đất khi không thể bay', () => {
  const f = fixture(); f.game.Player = { canFly: () => false };
  f.farm.start({ otherScriptsStopped: true }); f.advance(); f.advance();
  assert.equal(f.game.SceneWorld.autoOn, true);
  assert.notEqual(f.game.SceneWorld.player.flying, true);
});

test('ưu tiên khu ít đông hơn và kiểm tra lại sau 3 phút', () => {
  const f = fixture(); let population = [15, 5, 12], opened = 0;
  const ui = f.game.KhuUI = { khu: 1, soKhu: 3, mapId: 'field', onList() {}, open() { opened++; this.onList({ mapId: 'field', dem: population }); }, close() {} };
  f.game.SceneWorld.map.props = [{ type: 'khu_board', x: 40, y: 56, r: 44 }];
  f.doc.querySelectorAll = () => population.map((count, i) => ({ title: `Khu ${i + 1} — ${count}/20 người`, disabled: false,
    classList: { contains: name => name === 'day' ? count >= 20 : name === 'dong' ? count > 10 : name === 'vang' ? count < 20 && count <= 10 : false },
    getAttribute: () => String(i + 1), click() { ui.khu = i + 1; } }));
  f.farm.start({ otherScriptsStopped: true }); f.advance(); f.advance(2000); f.advance();
  assert.equal(ui.khu, 2); assert.equal(opened, 1);
  population = [0, 15, 5]; f.advance(181001); f.advance(1000); f.advance(2000); f.advance();
  assert.equal(ui.khu, 2); assert.equal(opened, 1);
});

test('stays in an under-threshold zone at the next check', () => {
  const f = fixture(); let population = [1, 5, 4, 3, 2], opened = 0;
  const ui = f.game.KhuUI = { khu: 2, soKhu: 5, mapId: 'field', onList() {}, open() { opened++; this.onList({ mapId: 'field', dem: population }); }, close() {} };
  f.game.SceneWorld.map.props = [{ type: 'khu_board', x: 40, y: 56, r: 44 }];
  f.doc.querySelectorAll = () => population.map((count, i) => ({ title: `Khu ${i + 1}`, disabled: false,
    classList: { contains: name => name === 'day' ? count >= 20 : name === 'dong' ? count > 10 : name === 'vang' ? count <= 10 : false },
    getAttribute: () => String(i + 1), click() { ui.khu = i + 1; } }));
  f.farm.start({ otherScriptsStopped: true }); f.advance(); f.advance(2000); f.advance();
  assert.equal(ui.khu, 1); assert.equal(opened, 1);
  population = [0, 0, 0, 6, 2]; f.advance(181001); f.advance(1000); f.advance(2000); f.advance();
  assert.equal(ui.khu, 1); assert.equal(opened, 1);
});

test('từ chối map đã chọn nếu không có trong danh sách phù hợp', () => {
  const f = fixture();
  assert.equal(f.farm.start({ otherScriptsStopped: true, mapId: 'khong_hop_le' }), false);
  assert.match(f.farm.status().message, /Bản đồ đã chọn/);
  assert.equal(f.game.SceneWorld.autoOn, false);
});

test('hồi HP xong quay lại đúng bãi trước khi xử lý đá ở làng', () => {
  const f = fixture(), w = f.game.SceneWorld; let dest = null, nav = { state: 'IDLE', running: false }, routes = [];
  f.navigation.start = ({target}) => { dest = target; routes.push(target); nav = { state: 'TRAVEL', running: true }; return true; };
  f.navigation.status = () => nav;
  f.navigation.tick = () => { w.map.data = { id: dest, name: dest }; w.enemies = dest === 'tan_vien' ? [] : [f.enemy]; nav = { state: 'DONE', running: false }; };
  f.farm.start({ otherScriptsStopped: true, mapId: 'field' }); f.advance(); f.advance();
  w.player.hp = 30; f.advance(); f.advance(); f.advance();
  assert.equal(w.map.data.id, 'tan_vien');
  w.drops = [{ kind:'item', itemId:'linh_thach', lootId:'village', state:'ground', x:40, y:40, owner:'self' }];
  w.player.hp = 75; f.advance(); f.advance(); f.advance();
  assert.equal(w.map.data.id, 'field');
  assert.deepEqual(routes, ['tan_vien', 'field']);
  assert.equal(f.farm.status().preferredMapId, 'field');
});

test('hồi sinh quay về đúng bãi auto đã chọn trước đó', () => {
  const f = fixture(), w = f.game.SceneWorld; let nav = { state:'IDLE', running:false }, routes = [];
  f.navigation.start = ({target}) => { routes.push(target); nav = { state:'TRAVEL', running:true }; return true; };
  f.navigation.status = () => nav;
  f.navigation.tick = () => { w.map.data = { id:'field', name:'Bãi' }; nav = { state:'DONE', running:false }; };
  f.farm.start({ otherScriptsStopped:true }); f.advance(); f.advance();
  w.player.downed = true; w.player.hp = 0; w.autoOn = false; f.advance();
  w.player.downed = false; w.player.hp = 100; w.map.data = { id:'tan_vien', name:'Làng' }; w.enemies = [];
  f.advance(); f.advance();
  assert.deepEqual(routes, ['field']); assert.equal(w.map.data.id, 'field');
});

test('hồi sinh thường tắt auto chiến đấu còn sót rồi quay lại bãi và đánh tiếp', () => {
  const f = fixture(), w = f.game.SceneWorld; let nav = { state:'IDLE', running:false }, routes = [];
  f.navigation.start = ({target}) => { routes.push(target); nav = { state:'TRAVEL', running:true }; return true; };
  f.navigation.status = () => nav;
  f.navigation.tick = () => { w.map.data = { id:'field', name:'Bãi' }; w.enemies = [f.enemy]; nav = { state:'DONE', running:false }; };
  f.farm.start({ otherScriptsStopped:true }); f.advance(); f.advance();
  assert.equal(w.autoOn, true);
  w.player.downed = true; w.player.hp = 0; f.advance();
  w.player.downed = false; w.player.hp = 100; w.map.data = { id:'tan_vien', name:'Làng' }; w.enemies = [];
  f.advance(); assert.equal(w.autoOn, false);
  f.advance(); f.advance();
  assert.deepEqual(routes, ['field']); assert.equal(w.map.data.id, 'field');
  f.advance(); assert.equal(w.autoOn, true); assert.equal(f.farm.status().running, true);
});


test('returns to the saved farm zone after leaving the map to recover HP', () => {
  const f = fixture(), w = f.game.SceneWorld; let dest = null, nav = { state:'IDLE', running:false };
  const counts = [0, 0, 0, 0];
  const ui = f.game.KhuUI = { khu:2, soKhu:4, mapId:'field', onList() {},
    open() { this.onList({ mapId:'field', dem:counts }); }, close() {} };
  f.game.SceneWorld.map.props = [{ type:'khu_board', x:40, y:56, r:44 }];
  f.doc.querySelectorAll = () => counts.map((count, i) => ({ disabled:false,
    classList:{ contains: name => name === 'day' && count >= 20 },
    getAttribute: () => String(i + 1), click() { ui.khu = i + 1; } }));
  f.navigation.start = ({target}) => { dest = target; nav = { state:'TRAVEL', running:true }; return true; };
  f.navigation.status = () => nav;
  f.navigation.tick = () => { w.map.data = { id:dest, name:dest }; if (dest === 'tan_vien') w.enemies = []; else { w.enemies = [f.enemy]; ui.khu = 1; } nav = { state:'DONE', running:false }; };
  f.farm.start({ otherScriptsStopped:true, mapId:'field' });
  for (let i=0; i<6; i++) f.advance(1000);
  assert.equal(ui.khu, 2);
  w.player.hp = 30;
  for (let i=0; i<4 && w.map.data.id !== 'tan_vien'; i++) f.advance(1000);
  assert.equal(w.map.data.id, 'tan_vien');
  w.player.hp = 75; w.player.state = 'idle';
  for (let i=0; i<4 && w.map.data.id !== 'field'; i++) f.advance(1000);
  assert.equal(w.map.data.id, 'field');
  for (let i=0; i<6 && ui.khu !== 2; i++) f.advance(1000);
  assert.equal(ui.khu, 2);
});
