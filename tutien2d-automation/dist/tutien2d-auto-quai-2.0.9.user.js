// ==UserScript==
// @name         TuTien2D - Auto quai, duoc cong va linh thach
// @namespace    local.tutien2d.stone-farm
// @version      2.0.9
// @match        https://tutien2d.com/*
// @match        https://www.tutien2d.com/*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(() => {
'use strict';
const A = {};
// src/core/controller.js
A.createController = function () {
  let owner = null;
  let blocked = false;
  return {
    acquire(who) {
      if (blocked || (owner && owner !== who)) return false;
      owner = who;
      return true;
    },
    release(who) { if (owner === who) owner = null; },
    owns(who) { return !blocked && owner === who; },
    stop() { blocked = true; owner = null; },
    reset() { blocked = false; },
    status() { return { owner, blocked }; }
  };
};



// src/navigation/map-graph.js
A.maps = function (mapData) {
  const result = new Map();
  for (const value of Object.values(mapData || {})) {
    if (value && typeof value === 'object' && typeof value.id === 'string' && Array.isArray(value.portals)) {
      result.set(value.id, value);
    }
  }
  return result;
};
A.automaticPortal = p => p && !p.byHand && !p.cooldownSec &&
  typeof p.toMap === 'string' && Number.isInteger(p.tx) && Number.isInteger(p.ty);
A.mapRoute = function (mapData, from, to, excluded = new Set()) {
  const maps = A.maps(mapData);
  if (!maps.has(from) || !maps.has(to)) return null;
  const queue = [from], previous = new Map([[from, null]]);
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (current === to) {
      const route = [];
      for (let id = to; previous.get(id); id = previous.get(id).from) route.unshift(previous.get(id));
      return route;
    }
    for (const p of maps.get(current).portals) {
      if (!A.automaticPortal(p) || excluded.has(current + '>' + p.toMap) || !maps.has(p.toMap) || previous.has(p.toMap)) continue;
      previous.set(p.toMap, { from: current, to: p.toMap });
      queue.push(p.toMap);
    }
  }
  return null;
};


// src/navigation/pathfinder.js
A.tileCenter = function (game, tx, ty) {
  const tile = game?.CONFIG?.TILE;
  if (!Number.isFinite(tile) || tile <= 0 || !Number.isInteger(tx) || !Number.isInteger(ty)) throw Error('INVALID_TILE_CONFIG');
  return { x: tx * tile + tile / 2, y: ty * tile + tile / 2 };
};
A.makePath = function (game, target, exactTile = null) {
  const world = game?.SceneWorld, player = world?.player, map = world?.map;
  const cfg = game?.CONFIG?.PLAYER;
  if (!player || !map || typeof player.setPath !== 'function' || typeof game?.Pathfinder?.route !== 'function') throw Error('PATHFINDER_UNAVAILABLE');
  if (!Number.isFinite(cfg?.HITBOX_W) || !Number.isFinite(cfg?.HITBOX_H) || cfg.HITBOX_W <= 0 || cfg.HITBOX_H <= 0) throw Error('HITBOX_UNVERIFIED');
  const path = game.Pathfinder.route(map, player.x, player.y, target.x, target.y, cfg.HITBOX_W / 2, cfg.HITBOX_H);
  if (!Array.isArray(path) || !path.length || path.length > 2000 || path.some(p => !Number.isFinite(p?.x) || !Number.isFinite(p?.y))) return null;
  if (exactTile) {
    const end = path[path.length - 1], tile = game.CONFIG.TILE;
    // route() uses nearestWalkable(). Reject silent snapping to another portal tile.
    if (Math.floor(end.x / tile) !== exactTile.tx || Math.floor(end.y / tile) !== exactTile.ty) return null;
  }
  // Never allow an earlier waypoint/segment to activate an unrelated automatic portal.
  let last = player;
  const tile = game.CONFIG.TILE;
  for (const point of path) {
    const length = Math.hypot(point.x - last.x, point.y - last.y);
    const steps = Math.max(1, Math.ceil(length / (tile / 8)));
    for (let i = 1; i <= steps; i++) {
      const tx = Math.floor((last.x + (point.x - last.x) * i / steps) / tile);
      const ty = Math.floor((last.y + (point.y - last.y) * i / steps) / tile);
      const portal = map.portals?.find(p => !p.byHand && p.tx === tx && p.ty === ty);
      if (portal && (!exactTile || portal.tx !== exactTile.tx || portal.ty !== exactTile.ty)) return null;
    }
    last = point;
  }
  return path;
};



// src/npc/npc-finder.js
A.findNpc = function (game, id) {
  const props = game?.SceneWorld?.map?.props;
  const prop = Array.isArray(props) && props.find(p => p.id === id && p.type === 'npc' && !p.hidden);
  if (!prop || !Number.isFinite(prop.x) || !Number.isFinite(prop.y)) return null;
  const tile = game?.CONFIG?.TILE;
  if (!Number.isFinite(tile) || tile <= 0) return null;
  // Targeting and SceneWorld's own autoDC both interact at prop.y - TILE/2.
  return { id: prop.id, x: prop.x, y: prop.y - tile / 2, r: Number.isFinite(prop.r) ? prop.r : 40 };
};



// src/navigation/portal-travel.js
A.createNavigation = function ({ getGame, logger, controller, flight = null, now = Date.now }) {
  const LIMIT = { total: 240000, leg: 65000, stuck: 5000, retries: 3, hop: 16 };
  let state = 'IDLE', message = '', job = null, leg = null, ownsPath = false;
  const status = () => ({ state, message, running: !!job, target: job?.target || null, attempts: leg?.attempts || 0 });
  function phase(next, detail) {
    if (state !== next || message !== detail) logger.add('NAV_STATE', { from: state, to: next, detail });
    state = next; message = detail;
  }
  function clearPath() {
    if (!ownsPath) return;
    try { getGame()?.SceneWorld?.player?.setPath?.([]); } catch (_) {}
    ownsPath = false;
  }
  function end(next, detail) {
    clearPath(); job = null; leg = null;
    controller.release('navigation'); phase(next, detail);
  }
  function preflight(g) {
    const w = g?.SceneWorld, p = w?.player;
    if (!p || !w.map?.data?.id) return 'Chưa lấy được nhân vật/map. Cần reload sau khi cài script.';
    if (w.autoOn || w.autoDC || w.diNV || w.approach || w.fishing || w.fishingAuto || w.chopping) return 'Tắt Auto chiến đấu, tự làm việc và các thao tác đang chạy trước.';
    if (p.downed || p.hp <= 0) return 'Nhân vật đang gục.';
    if ((!flight && p.flying) || p.sitLocked || ['sit', 'pose'].includes(p.state)) return 'Hạ phi hành và đứng dậy trước khi Start.';
    if (g.HUD?.dialogOpen || g.HUD?.bagOpen || w.menuOpen) return 'Đóng hội thoại, hành trang và menu trước.';
    return null;
  }
  function assign(path) {
    if (!controller.owns('navigation') || !job) throw Error('CONTROL_LOST');
    const player = getGame().SceneWorld.player;
    if (flight && !flight.pathAllowed(getGame(), path)) { flight.ground(); lastFlightRoute = true; return; }
    ownsPath = true;
    player.setPath([]); player.setPath(path);
  }
  let lastFlightRoute = false;
  function plan(g) {
    const w = g.SceneWorld, id = w.map.data.id;
    if (id === job.target) {
      if (!job.npcId) return end('DONE', 'Đã tới map mục tiêu.');
      const npc = A.findNpc(g, job.npcId);
      if (!npc) return end('ERROR', 'Không tìm thấy NPC với tọa độ runtime hợp lệ.');
      if (flight && w.player.flying && Math.hypot(w.player.x - npc.x, w.player.y - npc.y) < 100) {
        if (flight.update(npc, false).waiting) return;
      }
      const tolerance = Math.min(36, Math.max(20, npc.r - 12));
      if (Math.hypot(w.player.x - npc.x, w.player.y - npc.y) <= tolerance) return end('DONE', 'Đã tới gần Đại Phu. Nhấn E trong game để mở thoại.');
      leg = { map: id, target: npc, tolerance, attempts: 0, started: now(), progress: now(), anchor: { x: w.player.x, y: w.player.y } };
      phase('MOVE_TO_NPC', 'Đang tiếp cận Đại Phu.');
    } else {
      const route = A.mapRoute(g.MapData, id, job.target);
      if (!route?.length) return end('ERROR', 'Không tìm thấy tuyến cổng tự động hợp lệ từ map hiện tại.');
      if (job.hops >= LIMIT.hop) return end('ERROR', 'Đã đạt giới hạn số lần chuyển map.');
      const candidates = w.map.portals.filter(p => A.automaticPortal(p) && p.toMap === route[0].to);
      if (!candidates.length) return end('ERROR', 'Cổng trong map runtime không khớp dữ liệu tuyến.');
      candidates.sort((a, b) => Math.hypot(w.player.x - A.tileCenter(g, a.tx, a.ty).x, w.player.y - A.tileCenter(g, a.tx, a.ty).y) - Math.hypot(w.player.x - A.tileCenter(g, b.tx, b.ty).x, w.player.y - A.tileCenter(g, b.tx, b.ty).y));
      leg = { map: id, next: route[0].to, candidates, attempts: 0, started: now(), progress: now(), anchor: { x: w.player.x, y: w.player.y } };
      phase('TRAVEL_TO_MAP', id + ' → ' + leg.next);
    }
    replan(g);
  }
  function replan(g) {
    if (!leg || !job) return;
    if (leg.attempts >= LIMIT.retries) return end('ERROR', 'Không đi được sau 3 lần thử. Đã trả quyền điều khiển.');
    leg.attempts++;
    let path = null;
    if (leg.next) {
      const ordered = [...leg.candidates];
      const offset = (leg.attempts - 1) % ordered.length;
      for (let i = 0; i < ordered.length; i++) {
        const portal = ordered[(i + offset) % ordered.length];
        const target = A.tileCenter(g, portal.tx, portal.ty);
        path = A.makePath(g, target, portal);
        if (path) { leg.portal = portal; leg.target = target; break; }
      }
    } else {
      // NPC occupies a blocked tile. Route to nearby walkable tile centers instead.
      const tile = g.CONFIG.TILE, npc = leg.target, candidates = [];
      const tx = Math.floor(npc.x / tile), ty = Math.floor(npc.y / tile);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const p = A.tileCenter(g, tx + dx, ty + dy);
        if (Math.hypot(p.x - npc.x, p.y - npc.y) <= leg.tolerance) candidates.push(p);
      }
      candidates.sort((a, b) => Math.hypot(a.x - g.SceneWorld.player.x, a.y - g.SceneWorld.player.y) - Math.hypot(b.x - g.SceneWorld.player.x, b.y - g.SceneWorld.player.y));
      for (const p of candidates) {
        const attempt = A.makePath(g, p, { tx: Math.floor(p.x / tile), ty: Math.floor(p.y / tile) });
        if (attempt && Math.hypot(attempt.at(-1).x - npc.x, attempt.at(-1).y - npc.y) <= leg.tolerance) { path = attempt; break; }
      }
    }
    leg.progress = now(); leg.anchor = { x: g.SceneWorld.player.x, y: g.SceneWorld.player.y };
    logger.add(path ? 'PATH_ASSIGNED' : 'PATH_FAILED', { map: leg.map, next: leg.next || null, attempts: leg.attempts, target: leg.target || null });
    if (path) assign(path);
    else clearPath();
  }
  return {
    status,
    start({ target = 'duoc_vien', npcId = 'dai_phu', otherScriptsStopped = false } = {}) {
      if (job) return false;
      if (!otherScriptsStopped) { phase('ERROR', 'Xác nhận đã tắt các script Auto khác trước khi Start.'); return false; }
      const g = getGame(), error = preflight(g);
      if (error) { phase('ERROR', error); return false; }
      controller.reset();
      if (!controller.acquire('navigation')) { phase('ERROR', 'Quyền điều khiển đang được module khác giữ.'); return false; }
      job = { target, npcId, started: now(), hops: 0 }; leg = null;
      flight?.reset();
      phase('FIND_ROUTE', 'Đang lập tuyến.');
      try { plan(g); } catch (error) { end('ERROR', error.message); }
      return !!job || state === 'DONE';
    },
    stop(reason = 'Đã dừng theo yêu cầu.') { end('STOPPED', reason); },
    tick() {
      if (!job) return;
      try {
        if (!controller.owns('navigation')) return end('STOPPED', 'Đã mất quyền điều khiển.');
        if (now() - job.started > LIMIT.total) return end('ERROR', 'Hết thời gian điều hướng toàn tuyến.');
        const g = getGame(), w = g?.SceneWorld, id = w?.map?.data?.id;
        if (w?.transitioning) return;
        const error = preflight(g);
        if (error) return end('ERROR', error);
        if (!leg) return plan(g);
        if (id !== leg.map) {
          if (id !== leg.next) return end('ERROR', 'Chuyển tới map ngoài tuyến dự kiến: ' + id);
          logger.add('MAP_ARRIVED', { from: leg.map, to: id });
          ownsPath = false; leg = null; job.hops++;
          phase('WAIT_MAP', 'Chờ map sẵn sàng.');
          return;
        }
        if (now() - leg.started > LIMIT.leg) return end('ERROR', 'Hết thời gian đi qua một chặng.');
        if (flight && leg.target) {
          const mode = flight.update(leg.target);
          if (mode.waiting) { lastFlightRoute = true; return; }
          if (mode.changed || lastFlightRoute) {
            lastFlightRoute = false; leg.attempts = Math.max(0, leg.attempts - 1); replan(g); return;
          }
        }
        const p = w.player;
        if (!leg.next && Math.hypot(p.x - leg.target.x, p.y - leg.target.y) <= leg.tolerance) return end('DONE', 'Đã tới gần Đại Phu. Nhấn E trong game để mở thoại.');
        if (Math.hypot(p.x - leg.anchor.x, p.y - leg.anchor.y) >= 3) {
          leg.progress = now(); leg.anchor = { x: p.x, y: p.y };
        }
        if (now() - leg.progress > LIMIT.stuck) {
          logger.add('STUCK_OR_PORTAL_WAIT', { map: id, attempts: leg.attempts });
          replan(g);
        }
      } catch (error) { end('ERROR', error.message); }
    }
  };
};



// src/quests/quest-reader.js
A.readDuocCong = function (game) {
  const q = game?.Quest;
  if (typeof q?.seedTaskList !== 'function') return { available: false, tasks: [], active: null };
  const handlers = new Set(['linh_chi', 'cau_ca', 'ho_tong_chau', 'truc_gia', 'duoc_moc']);
  const tasks = q.seedTaskList().map(row => ({
    id: row.def.id, name: row.def.shortName || row.def.name,
    kind: row.def.kind, runsLeft: row.runsLeft, locked: !!row.locked,
    status: row.locked ? 'LOCKED' : row.exhausted ? 'EXHAUSTED' : handlers.has(row.def.id) ? 'READY' : 'NEEDS_ADAPTER',
    reason: row.locked ? 'Chưa đủ điều kiện nhân vật' : row.exhausted ? 'Hết lượt hôm nay' :
      handlers.has(row.def.id) ? '' : 'Chưa có bộ thực thi đã kiểm chứng cho hoạt động này'
  }));
  const info = q.seedTaskInfo();
  return { available: true, tasks, active: info ? { id: info.id, name: info.shortName || info.name, supported: handlers.has(info.id),
    progress: q.seedQuestProgress(), need: info.need ?? null, complete: q.seedQuestComplete(), round: q.seedQuest.round } : null };
};



// Cooperate with the CONFIG hook used by TuTien2D Auto 0.9.7.
A.createGameAccess = function (host) {
  const candidates = [];
  let configHook = 'unavailable', hook = 'not-installed';
  const keep = value => {
    if (value && typeof value === 'object' && !candidates.includes(value)) candidates.push(value);
    return value;
  };
  try {
    keep(host.gameDebug); keep(host.PNTT);
    const proto = host.Object.prototype;
    const previous = Object.getOwnPropertyDescriptor(proto, 'CONFIG');
    const compatible = !previous || (previous.configurable && typeof previous.set === 'function' &&
      /HITBOX_W/.test(Function.prototype.toString.call(previous.set)) &&
      /\.NAME/.test(Function.prototype.toString.call(previous.set)));
    if (compatible) {
      let active = true;
      const restore = () => {
        if (Object.getOwnPropertyDescriptor(proto, 'CONFIG')?.set !== setter) return;
        if (previous) Object.defineProperty(proto, 'CONFIG', previous);
        else delete proto.CONFIG;
      };
      const setter = function (value) {
        // Restore first so the earlier hook can clean itself up normally.
        restore();
        if (previous?.set) previous.set.call(this, value);
        else Object.defineProperty(this, 'CONFIG', { value, writable: true, enumerable: true, configurable: true });
        const match = value && value.NAME === 'Tu Tiên 2D' && value.TILE === 32 &&
          value.PLAYER && Number.isFinite(value.PLAYER.HITBOX_W);
        if (match) {
          keep(this); active = false; configHook = 'captured';
          // 0.9.7 already looks for gameDebug; publish only if the name is unused.
          if (typeof host.gameDebug === 'undefined') {
            try { Object.defineProperty(host, 'gameDebug', { value: this, writable: true, configurable: true }); }
            catch (_) { /* The standalone script has its own reference. */ }
          }
        } else if (active && (!previous || Object.getOwnPropertyDescriptor(proto, 'CONFIG')?.set === previous.set)) {
          Object.defineProperty(proto, 'CONFIG', { configurable: true, enumerable: false, get: previous?.get, set: setter });
        }
      };
      Object.defineProperty(proto, 'CONFIG', { configurable: true, enumerable: false, get: previous?.get, set: setter });
      configHook = previous ? 'chained' : 'installed';
      host.setTimeout(() => { active = false; restore(); if (configHook !== 'captured') configHook = 'expired'; }, 30000);
    } else configHook = 'occupied';
    hook = 'available';
  } catch (_) { configHook = 'error'; }
  return {
    get() {
      try { keep(host.PNTT); keep(host.gameDebug); } catch (_) {}
      const list = [...candidates].reverse();
      return list.find(value => value?.SceneWorld?.player && value?.SceneWorld?.map?.data?.id) ||
        list.find(value => value?.SceneWorld) || list[0] || null;
    },
    diagnostics() {
      try { keep(host.PNTT); keep(host.gameDebug); } catch (_) {}
      return { hook, configHook, candidates: candidates.map(value => ({ player: !!value?.SceneWorld?.player,
        map: !!value?.SceneWorld?.map?.data?.id, farm: !!value?.Farm, quest: !!value?.Quest })) };
    }
  };
};

// Read game-provided drop exclusions and map data; do not infer guaranteed drops.
A.stoneFarmEnemy = function (game, enemy, mapId) {
  const def = enemy?.def || game?.ENEMY_DEFS?.[enemy?.type];
  const player = game?.SceneWorld?.player;
  if (!enemy?.type || !def || !player || def.isBoss || def.human || def.tieuXa || def.khongNhan) return false;
  if (enemy.requireStage && (!Number.isInteger(game?.Quest?.stage) || game.Quest.stage < enemy.requireStage)) return false;
  const hp = Number(def.hp ?? enemy.hpMax), damage = Number(def.contactDmg);
  if (!Number.isFinite(hp) || hp <= 0 || !Number.isFinite(damage) || damage < 0 || !Number.isFinite(player.hpMax) || player.hpMax <= 0) return false;
  if (hp > player.hpMax * 4 || damage > player.hpMax * .22) return false;
  if (typeof game?.Loot?.quaiBoLinhThach !== 'function') return false;
  try {
    // Fixed stone drops are a separate branch in Loot; the exclusion applies to random drops.
    const excluded = game.Loot.quaiBoLinhThach({ type: enemy.type, mapId: mapId || enemy.mapId, def }, game);
    if (excluded !== true && excluded !== false) return false;
    const fixed = Number(def.stones || 0) > 0 && !Number.isFinite(enemy.stoneChance) && !enemy.stoneRate;
    return !excluded || fixed;
  } catch (_) { return false; }
};

A.stoneFarmCandidates = function (game, excluded = new Set()) {
  const current = game?.SceneWorld?.map?.data?.id;
  if (!current) return [];
  const maps = A.maps(game.MapData), result = [];
  for (const [id, map] of maps) {
    if (excluded.has(id) || map.scope !== 'shared' || !Array.isArray(map.enemies)) continue;
    const route = A.mapRoute(game.MapData, current, id);
    if (!Array.isArray(route)) continue;
    const spawns = map.enemies.filter(e => !e.requireStage || (Number.isInteger(game.Quest?.stage) && game.Quest.stage >= e.requireStage));
    // The built-in combat engine may switch targets between ticks. Avoid maps with active bosses.
    if (spawns.some(e => game.ENEMY_DEFS?.[e.type]?.isBoss)) continue;
    const eligible = spawns.filter(e => A.stoneFarmEnemy(game, { ...e, stoneRate: e.stoneRate || map.stoneRate }, id));
    if (!eligible.length) continue;
    const hp = Math.min(...eligible.map(e => Number(game.ENEMY_DEFS[e.type].hp)));
    result.push({ id, name: map.name || id, hops: route.length, types: [...new Set(eligible.map(e => e.type))], hp });
  }
  result.sort((a, b) => a.hops - b.hops || a.hp - b.hp || a.id.localeCompare(b.id));
  return result;
};

A.createStoneFarm = function ({ getGame, doc, host, controller, navigation, logger, now = Date.now }) {
  let running = false, state = 'IDLE', message = 'Chưa chạy.', started = 0, lastInput = 0;
  let startBalance = null, lastBalance = null, gained = 0, spent = 0, farmMap = null, travel = null;
  let move = null, targetId = null, ownsCombat = false;
  let resumeCombatAfterRevive = false;
  let lastGain = 0, observedDeaths = 0, enemyStates = new Map(), excludedMaps = new Set();
  let recovering = false, healStarted = 0, lastHp = 0, hpProgress = 0, reviveAt = 0, downSince = 0, deathTimes = [];
  let disconnectedAt = 0, lastSnapshot = null, startedName = null, initialRealm = null;
  let zoneMap = null, zoneStep = null, zoneNextCheck = 0;
  let flightPending = null, flightBlockedUntil = 0;
  let preferredMapId = null;
  const log = (event, data = {}) => logger?.add?.(event, data);
  function phase(next, detail) { if (state !== next || message !== detail) log('STONE_STATE', { from: state, to: next, detail }); state = next; message = detail; }
  function press(key, force = false) {
    if (!force && now() - lastInput < 700) return false;
    for (const type of ['keydown', 'keyup']) doc.dispatchEvent(new host.KeyboardEvent(type, { key, code: 'Key' + key.toUpperCase(), bubbles: true }));
    lastInput = now(); return true;
  }
  function clearPath() { if (move) { try { getGame()?.SceneWorld?.player?.setPath?.([]); } catch (_) {} } move = null; }
  function autoOff(g) {
    if (!g?.SceneWorld?.autoOn) { ownsCombat = false; return true; }
    if (!ownsCombat) return false;
    try { g.SceneWorld.player?.setPath?.([]); } catch (_) {}
    press('t'); return false;
  }
  function otherRunning() {
    try {
      const other = host.TuTienAuto?.status?.();
      if (['automation', 'intro', 'quests', 'garden', 'navigation'].some(k => other?.[k]?.running)) return 'Auto TuTien2D';
      const button = doc.getElementById('tt-free-books')?.shadowRoot?.getElementById('stop');
      if (button && !button.disabled) return 'Bí tịch miễn phí';
    } catch (_) { return 'script khác chưa xác định'; }
    return null;
  }
  function capture(g) {
    const w = g?.SceneWorld, p = w?.player;
    if (!p || !w?.map?.data?.id || !Number.isFinite(g?.Progress?.stones)) return null;
    let daily;
    try { daily = g.Loot?.stoneToday?.(g); } catch (_) { return null; }
    if (!daily || !Number.isFinite(daily.da) || !Number.isFinite(daily.tran) || daily.tran <= 0) return null;
    return { map: w.map.data.id, mapName: w.map.data.name || w.map.data.id, realm: p.realmId || g.Progress.realmId || null,
      hp: p.hp, hpMax: p.hpMax, balance: g.Progress.stones, day: { earned: daily.da, limit: daily.tran, day: daily.ngay } };
  }
  function updateBalance(snap) {
    if (lastBalance != null) {
      const delta = snap.balance - lastBalance;
      if (delta > 0) { gained += delta; lastGain = now(); log('STONE_WALLET_INCREASE', { amount: delta, balance: snap.balance }); }
      else if (delta < 0) { spent += -delta; log('STONE_WALLET_DECREASE', { amount: -delta, balance: snap.balance }); }
    }
    lastBalance = snap.balance; lastSnapshot = snap;
  }
  function targetDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function go(g, point, tolerance, kind) {
    const p = g.SceneWorld.player, tile = g.CONFIG?.TILE;
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) || !Number.isFinite(tile)) throw Error('Không xác minh được vị trí cần tới.');
    if (targetDistance(p, point) <= tolerance) { clearPath(); return true; }
    const key = kind + ':' + Math.round(point.x / 16) + ':' + Math.round(point.y / 16);
    if (!move || move.key !== key) { clearPath(); move = { key, started: now(), progress: now(), x: p.x, y: p.y, tries: 0, issued: false }; }
    if (targetDistance(p, move) >= 4) { move.x = p.x; move.y = p.y; move.progress = now(); }
    if (now() - move.started > 45000) throw Error('Hết thời gian đi tới ' + kind + '.');
    if (!move.issued || now() - move.progress > 5000) {
      if (++move.tries > 3) throw Error('Kẹt đường khi đi tới ' + kind + ' sau 3 lần.');
      const positions = [];
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const candidate = A.tileCenter(g, Math.floor(point.x / tile) + dx, Math.floor(point.y / tile) + dy);
        if (targetDistance(candidate, point) <= tolerance - 2) positions.push(candidate);
      }
      positions.sort((a, b) => targetDistance(p, a) - targetDistance(p, b));
      let path = null;
      for (const candidate of positions) {
        path = A.makePath(g, candidate, { tx: Math.floor(candidate.x / tile), ty: Math.floor(candidate.y / tile) });
        if (path && targetDistance(path[path.length - 1], point) <= tolerance - 2) break;
        path = null;
      }
      if (path) { p.setPath([]); p.setPath(path); }
      move.issued = true; move.progress = now();
      log(path ? 'STONE_PATH' : 'STONE_PATH_FAILED', { kind, attempts: move.tries });
    }
    return false;
  }
  function observeEnemies(w) {
    for (const e of w.enemies || []) {
      if (!e?.id || !A.stoneFarmEnemy(getGame(), e, w.map.data.id)) continue;
      const dead = !!e.dead || (Number.isFinite(e.hp) && e.hp <= 0);
      if (enemyStates.get(e.id) === false && dead) observedDeaths++;
      enemyStates.set(e.id, dead);
    }
  }
  function chooseZone(g) {
    const map = g.SceneWorld.map.data.id, ui = g.KhuUI;
    const done = () => { zoneMap = map; zoneNextCheck = now() + 600000; zoneStep = null; };
    if (!ui || !Number.isInteger(ui.soKhu) || ui.soKhu <= 1) { done(); return false; }
    if (zoneMap === map && now() < zoneNextCheck) return false;
    if (!zoneStep) {
      if (!autoOff(g)) return true;
      if (!ensureGround(g)) return true;
      if (typeof ui.open !== 'function' || typeof ui.close !== 'function') throw Error('Không đọc được bảng đổi khu.');
      const p = g.SceneWorld.player;
      const boards = (g.SceneWorld.map.props || []).filter(o => o.type === 'khu_board' && !o.hidden && Number.isFinite(o.x) && Number.isFinite(o.y));
      boards.sort((a, b) => targetDistance(p, a) - targetDistance(p, b));
      if (!boards.length) throw Error('Không tìm thấy Bảng Khu để đổi khu.');
      const board = boards[0], point = { x: board.x, y: board.y - (g.CONFIG.TILE / 2) };
      phase('ZONE', 'Đang tới Bảng Khu để chọn khu ít người.');
      if (!go(g, point, Math.max(20, (board.r || 44) - 8), 'Bảng Khu')) return true;
      ui.open(); zoneStep = { map, started: now(), from: ui.khu, target: null };
      phase('ZONE', 'Đang kiểm tra số người ở các khu.'); return true;
    }
    if (zoneStep.map !== map) { ui.close(); zoneStep = null; return true; }
    if (zoneStep.target) {
      if (ui.khu === zoneStep.target) { ui.close(); log('STONE_ZONE_CHANGED', { from: zoneStep.from, to: ui.khu }); done(); return false; }
      if (now() - zoneStep.changedAt > 15000) throw Error('Không xác nhận được game đã chuyển khu.');
      phase('ZONE', 'Đang chờ game chuyển sang khu ' + zoneStep.target + '.'); return true;
    }
    if (now() - zoneStep.started < 1800) return true;
    const buttons = [...doc.querySelectorAll('#khu-panel .khu-o[data-khu]')].map(button => {
      const match = (button.title || '').match(/(\d+)\s*\/\s*(\d+)/);
      return { button, id: Number(button.getAttribute('data-khu')), count: match ? Number(match[1]) : null, cap: match ? Number(match[2]) : null };
    }).filter(z => Number.isInteger(z.id) && z.count != null && z.cap > z.count && !z.button.disabled && !z.button.classList.contains('day'));
    if (!buttons.length) { if (now() - zoneStep.started < 8000) return true; throw Error('Không đọc được danh sách khu còn chỗ.'); }
    buttons.sort((a, b) => a.count - b.count || a.id - b.id);
    const least = buttons[0].count, current = buttons.find(z => z.id === ui.khu);
    if (current && current.count === least) { ui.close(); done(); return false; }
    const choices = buttons.filter(z => z.id !== ui.khu && z.count === least);
    if (!choices.length) { ui.close(); done(); return false; }
    const chosen = choices[Math.floor(Math.random() * choices.length)];
    zoneStep.target = chosen.id; zoneStep.changedAt = now(); chosen.button.click();
    phase('ZONE', 'Đang đổi sang khu ' + chosen.id + ' (' + chosen.count + '/' + chosen.cap + ' người).'); return true;
  }
  function closeDialog(g) {
    if (g.HUD?.bagOpen) { press('b'); return true; }
    if (g.HUD?.dialogOpen) { const button = doc.querySelector('#dialog-close'); if (button && !button.disabled) button.click(); return true; }
    return false;
  }
  function prepareStanding(g) {
    if (closeDialog(g)) return false;
    const p = g.SceneWorld.player;
    if (p.state === 'sit') { if (!autoOff(g)) return false; press('q'); return false; }
    if (p.sitLocked || ['pose', 'attack'].includes(p.state)) return false;
    return true;
  }
  function ensureGround(g) {
    const p = g.SceneWorld.player;
    if (!p.flying) { flightPending = null; return true; }
    if (flightPending?.desired === false) {
      if (now() - flightPending.at > 3500) throw Error('Không hạ được phi hành để tương tác hoặc chuyển bản đồ.');
      return false;
    }
    if (press('f')) { flightPending = { desired: false, at: now() }; phase('LAND', 'Đang hạ cánh để tương tác hoặc chuyển bản đồ.'); }
    return false;
  }
  function preferFlight(g) {
    const w = g.SceneWorld, p = w.player;
    if (p.flying) { flightPending = null; return true; }
    if (flightPending?.desired === true) {
      if (now() - flightPending.at < 3500) return false;
      flightPending = null; flightBlockedUntil = now() + 60000;
      log('STONE_FLIGHT_UNAVAILABLE', {}); return true;
    }
    if (now() < flightBlockedUntil || typeof g.Player?.canFly !== 'function' || !g.Player.canFly(p) ||
        (typeof g.Player.inNoFlyZone === 'function' && g.Player.inNoFlyZone(p, w.map)) ||
        (g.HacThi?.camBay && g.HacThi.camBay(g, w.map.data.id))) return true;
    if (press('f')) { flightPending = { desired: true, at: now() }; phase('FLY', 'Đang bật phi hành để đánh quái.'); }
    return false;
  }
  function beginTravel(g, id, reason) {
    clearPath(); controller.release('stone');
    if (!navigation.start({ target: id, npcId: null, otherScriptsStopped: true })) {
      controller.acquire('stone'); throw Error(navigation.status().message || 'Không mở được tuyến tới ' + id + '.');
    }
    if (reason === 'Rời bãi để hồi HP') { zoneMap = null; zoneNextCheck = 0; targetId = null; }
    travel = { id, reason }; phase('TRAVEL', reason + ' · ' + id);
  }
  function finishTravel(g) {
    if (!travel) return false;
    navigation.tick();
    const result = navigation.status();
    if (result.running) return true;
    const old = travel; travel = null;
    if (!controller.acquire('stone')) throw Error('Không lấy lại được quyền điều khiển sau khi di chuyển.');
    if (result.state !== 'DONE' || g.SceneWorld.map?.data?.id !== old.id) {
      if (old.reason === 'Đi tới bãi farm') { if (preferredMapId) throw Error('Không đi được tới bản đồ đã chọn: ' + (result.message || old.id)); excludedMaps.add(old.id); farmMap = null; phase('SELECT_MAP', 'Không đi được bãi vừa chọn; đang tìm bãi khác.'); return true; }
      throw Error(result.message || 'Không tới được nơi hồi máu.');
    }
    phase('CHECK', old.reason === 'Đi tới bãi farm' ? 'Đã tới bãi; đang kiểm tra quái và đá.' : 'Đã tới nơi hồi phục.');
    return false;
  }
  function revive(g) {
    const p = g.SceneWorld.player;
    if (!p.downed && p.hp > 0) {
      if (downSince && resumeCombatAfterRevive && g.SceneWorld.autoOn) {
        phase('REVIVE_RESET', 'Đã hồi sinh; đang khởi tạo lại chiến đấu trước khi về bãi.');
        if (now() - lastInput >= 700) press('t');
        return true;
      }
      if (downSince) { downSince = 0; reviveAt = 0; resumeCombatAfterRevive = false; recovering = false; zoneMap = null; zoneNextCheck = 0; targetId = null; enemyStates.clear(); clearPath(); phase('CHECK', farmMap ? 'Đã hồi sinh; quay lại bãi farm ' + farmMap.name + '.' : 'Đã hồi sinh; tìm lại bãi farm.'); }
      return false;
    }
    if (!downSince) resumeCombatAfterRevive = ownsCombat;
    clearPath(); ownsCombat = false;
    if (travel) { navigation.stop('Nhân vật bị gục.'); travel = null; controller.reset(); controller.acquire('stone'); }
    if (!downSince) { downSince = now(); deathTimes = deathTimes.filter(t => now() - t < 600000); deathTimes.push(now()); if (deathTimes.length > 3) throw Error('Nhân vật gục quá nhiều lần; dừng để kiểm tra bãi.'); }
    if (now() - downSince > 60000) throw Error('Không xác nhận được hồi sinh miễn phí sau 60 giây.');
    phase('REVIVE', 'Nhân vật gục; đang chờ hồi sinh miễn phí về làng.');
    const panel = doc.querySelector('#downed'), button = doc.querySelector('#downed-home');
    if (panel && !panel.classList.contains('hidden') && button && !button.disabled && now() - reviveAt >= 4000) {
      if (!/miễn phí/i.test(button.textContent || '')) throw Error('Không xác nhận được lựa chọn hồi sinh miễn phí.');
      button.click(); reviveAt = now();
    }
    return true;
  }
  function heal(g) {
    const w = g.SceneWorld, p = w.player;
    if (!Number.isFinite(p.hp) || !Number.isFinite(p.hpMax) || p.hpMax <= 0) throw Error('Không đọc được HP.');
    if (!recovering && p.hp / p.hpMax >= .4) return false;
    if (!recovering) { recovering = true; healStarted = hpProgress = now(); lastHp = p.hp; log('STONE_HEAL_BEGIN', { hp: p.hp, hpMax: p.hpMax }); }
    if (p.hp > lastHp) { lastHp = p.hp; hpProgress = now(); }
    if (now() - healStarted > 180000 || now() - hpProgress > 60000) throw Error('HP không hồi phục; dừng để kiểm tra nhân vật.');
    if (!autoOff(g)) { phase('HEAL', 'Đang dừng chiến đấu để hồi HP.'); return true; }
    if (closeDialog(g)) return true;
    if (p.flying) { press('f'); return true; }
    if (p.hp / p.hpMax >= .7) {
      if (p.state === 'sit') { press('q'); return true; }
      if (p.sitLocked) return true;
      recovering = false; healStarted = 0; lastGain = now(); phase('CHECK', farmMap && w.map.data.id !== farmMap.id ? 'Đã hồi HP; quay lại bãi farm ' + farmMap.name + '.' : 'Đã hồi HP; tiếp tục farm.'); return false;
    }
    const dangerous = (w.enemies || []).some(e => !e.dead && e.hp > 0 && !e.def?.human && Number.isFinite(e.x) && Number.isFinite(e.y) && targetDistance(p, e) < 150);
    if (dangerous && w.map.data.id !== 'tan_vien') {
      if (p.state === 'sit') { press('q'); return true; }
      beginTravel(g, 'tan_vien', 'Rời bãi để hồi HP'); return true;
    }
    if (dangerous) throw Error('Có quái gần nơi hồi máu; dừng để tránh nhân vật tiếp tục gục.');
    phase('HEAL', 'Đang tọa thiền hồi HP tới 70%.');
    if (p.state !== 'sit' && !p.sitLocked) press('q');
    return true;
  }
  function stop(detail = 'Đã dừng farm Linh Thạch.', next = 'STOPPED', preserve = false) {
    const g = getGame();
    if (zoneStep) { try { g?.KhuUI?.close?.(); } catch (_) {} zoneStep = null; }
    if (travel) { navigation.stop(detail); travel = null; }
    if (running && ownsCombat && g?.SceneWorld?.autoOn) { try { g.SceneWorld.player?.setPath?.([]); press('t', true); } catch (_) {} }
    if (running && lastSnapshot) lastSnapshot.stoppedAt = now();
    clearPath(); try { if (running) g?.Targeting?.clear?.(); } catch (_) {}
    controller.release('stone'); running = false; ownsCombat = false; targetId = null;
    if (!preserve) { try { host.sessionStorage?.removeItem('tutien_stone_farm_resume'); } catch (_) {} }
    phase(next, detail); return false;
  }
  function status() {
    const elapsed = !started ? 0 : running ? Math.max(0, now() - started) : Math.max(0, (lastSnapshot?.stoppedAt || now()) - started);
    return { running, state, message, map: lastSnapshot?.mapName || null, targetMap: farmMap?.name || null,
      realm: lastSnapshot?.realm || initialRealm, hp: lastSnapshot?.hp ?? null, hpMax: lastSnapshot?.hpMax ?? null,
      balance: lastSnapshot?.balance ?? null, startBalance, gained, spent, preferredMapId, perHour: elapsed >= 30000 ? Math.round(gained * 3600000 / elapsed) : null,
      elapsedMs: elapsed, day: lastSnapshot?.day || null, observedDeaths };
  }
  return {
    status,
    start(options = {}) {
      if (running) return false;
      const g = getGame(), conflict = otherRunning();
      if (!options.otherScriptsStopped || conflict) return stop(conflict ? 'Dừng ' + conflict + ' trước khi farm.' : 'Cần xác nhận đã tắt auto khác.', 'ERROR');
      const snap = capture(g);
      const characterName = (doc.getElementById('hud-name')?.textContent || '').trim();
      if (!characterName) return stop('Chưa đọc được tên nhân vật; chờ vào game.', 'ERROR');
      if (!snap || !g?.Gateway?.connected || !g?.Gateway?.ready || typeof g?.Targeting?.cycle !== 'function' || typeof g?.Pathfinder?.route !== 'function')
        return stop('Chưa đọc đủ nhân vật, hạn mức hoặc kết nối game.', 'ERROR');
      if (g.SceneWorld.autoOn || g.SceneWorld.autoDC || g.SceneWorld.diNV) return stop('Tắt auto hoặc tác vụ game đang chạy trước khi farm.', 'ERROR');
      const candidates = A.stoneFarmCandidates(g);
      if (options.mapId && !candidates.some(m => m.id === options.mapId)) return stop('Bản đồ đã chọn không có quái phù hợp hoặc chưa có đường đi hợp lệ.', 'ERROR');
      if (!candidates.length) return stop('Chưa tìm được bãi có quái phù hợp và đường đi hợp lệ.', 'ERROR');
      controller.reset(); if (!controller.acquire('stone')) return stop('Không lấy được quyền điều khiển.', 'ERROR');
      preferredMapId = options.mapId || null;
      running = true; started = lastGain = now(); startBalance = lastBalance = snap.balance; lastSnapshot = snap; initialRealm = snap.realm;
      gained = spent = observedDeaths = 0; excludedMaps = new Set(); enemyStates = new Map(); deathTimes = [];
      farmMap = travel = move = null; zoneMap = zoneStep = flightPending = null; zoneNextCheck = flightBlockedUntil = 0; ownsCombat = recovering = resumeCombatAfterRevive = false; downSince = disconnectedAt = 0;
      startedName = characterName;
      try { host.sessionStorage?.setItem('tutien_stone_farm_resume', '1'); } catch (_) {}
      phase('CHECK', 'Đang kiểm tra bãi farm và hạn mức Linh Thạch.'); return true;
    },
    stop,
    tick() {
      if (!running) return;
      try {
        const conflict = otherRunning();
        if (conflict) return stop('Phát hiện ' + conflict + ' đang chạy; đã dừng farm.', 'ERROR');
        const g = getGame(), w = g?.SceneWorld, p = w?.player, snap = capture(g);
        if (!g?.Gateway?.connected || !g?.Gateway?.ready || !snap || !p) {
          if (!disconnectedAt) disconnectedAt = now();
          phase('WAIT_CONNECTION', 'Mất dữ liệu hoặc kết nối game; đang chờ kết nối lại.');
          if (now() - disconnectedAt > 60000) return stop('Mất kết nối quá 60 giây; chưa thể tiếp tục farm.', 'ERROR');
          return;
        }
        disconnectedAt = 0;
        const currentName = (doc.getElementById('hud-name')?.textContent || '').trim() || null;
        if (startedName && currentName && startedName !== currentName) return stop('Nhân vật đã thay đổi; đã dừng farm.', 'ERROR');
        updateBalance(snap);
        if (revive(g)) return;
        if (w.transitioning) return;
        if (travel && finishTravel(g)) return;
        if (!controller.owns('stone')) return stop('Mất quyền điều khiển nhân vật.', 'ERROR');
        if (w.autoDC || w.diNV || w.fishing || w.chopping || w.brewing) return stop('Có tác vụ khác đang điều khiển nhân vật.', 'ERROR');
        if (w.autoOn && !ownsCombat) return stop('Auto chiến đấu đã bật ngoài phiên farm.', 'ERROR');
        if (heal(g)) return;
        if (recovering) return;
        if (snap.realm !== initialRealm) { initialRealm = snap.realm; farmMap = null; excludedMaps.clear(); }
        if (!prepareStanding(g)) return;
        // Return to the chosen farm before considering drops or enemies at the healing map.
        if (farmMap && farmMap.id !== w.map.data.id) {
          if (!autoOff(g) || !ensureGround(g)) return;
          beginTravel(g, farmMap.id, 'Đi tới bãi farm'); return;
        }
        observeEnemies(w);
        if (snap.day.earned >= snap.day.limit) return stop('Đã đạt hạn mức Linh Thạch hôm nay: ' + snap.day.earned + '/' + snap.day.limit + '.', 'DONE');
        if (!farmMap || farmMap.id !== w.map.data.id) {
          if (!farmMap) {
            const candidates = A.stoneFarmCandidates(g, excludedMaps);
            if (!candidates.length) return stop('Không tìm được bãi quái phù hợp, có đường đi và chưa bị loại.', 'ERROR');
            farmMap = preferredMapId ? candidates.find(m => m.id === preferredMapId) : candidates[0];
            if (!farmMap) return stop('Bản đồ đã chọn không còn phù hợp hoặc không còn đường đi.', 'ERROR');
            log('STONE_MAP_SELECTED', { id: farmMap.id, name: farmMap.name, types: farmMap.types });
          }
          if (farmMap.id !== w.map.data.id) { if (!autoOff(g) || !prepareStanding(g) || !ensureGround(g)) return; beginTravel(g, farmMap.id, 'Đi tới bãi farm'); return; }
        }
        if (chooseZone(g)) return;
        if (!preferFlight(g)) return;
        if (now() - lastGain > 300000 && observedDeaths >= 20) {
          if (preferredMapId) return stop('Bản đồ đã chọn không thấy tăng ví sau nhiều quái; kiểm tra lại bãi.', 'ERROR');
          excludedMaps.add(farmMap.id); farmMap = null; observedDeaths = 0; enemyStates.clear(); lastGain = now();
          if (!autoOff(g)) return;
          phase('SELECT_MAP', 'Chưa thấy ví tăng sau nhiều quái; thử bãi phù hợp khác.'); return;
        }
        const eligible = (w.enemies || []).filter(e => !e.dead && e.hp > 0 && Number.isFinite(e.x) && Number.isFinite(e.y) && A.stoneFarmEnemy(g, e, w.map.data.id));
        eligible.sort((a, b) => targetDistance(p, a) - targetDistance(p, b));
        const target = eligible.find(e => e.id === targetId) || eligible[0];
        if (!target) { targetId = null; if (!autoOff(g)) return; clearPath(); phase('WAIT_RESPAWN', 'Chưa có quái phù hợp; chờ hồi sinh.'); return; }
        targetId = target.id;
        const selected = g.Targeting.current?.();
        const locked = selected?.kind === 'enemy' && selected.obj?.id === target.id && g.Targeting.manual === true;
        if (!locked) {
          if (!autoOff(g)) return;
          const list = g.Targeting.list || [];
          const listed = list.some(x => x.kind === 'enemy' && x.obj?.id === target.id);
          if (!listed) { phase('APPROACH', 'Đang tới gần ' + (target.def?.name || target.type) + '.'); go(g, target, 100, 'quái'); return; }
          clearPath();
          for (let i = 0; i < list.length * 2 + 4; i++) { const current = g.Targeting.current?.(); if (current?.kind === 'enemy' && current.obj?.id === target.id && g.Targeting.manual === true) break; g.Targeting.cycle(); }
          const current = g.Targeting.current?.();
          if (current?.kind !== 'enemy' || current.obj?.id !== target.id || g.Targeting.manual !== true) throw Error('Không khóa được đúng quái phù hợp.');
        }
        if (!w.autoOn) { if (press('t')) ownsCombat = true; return; }
        if (!ownsCombat) return stop('Auto chiến đấu đã bật ngoài phiên farm.', 'ERROR');
        phase('COMBAT', 'Fighting ' + (target.def?.name || target.type) + '.');
      } catch (error) { stop(error?.message || String(error), 'ERROR'); }
    }
  };
};

A.createIntegratedBooks = function () {
const access = A.createGameAccess(window);
const events = [];
const logger = { add(event, data = {}) { events.push({ at: new Date().toISOString(), event, data }); if (events.length > 100) events.shift(); } };
const controller = A.createController();
const navigation = A.createNavigation({ getGame: () => access.get(), logger, controller });
const pools = [{ id: 'so_cap', label: 'Tàng Kinh Sơ Cấp', tab: 'Sơ Cấp' },
  { id: 'bi_dong', label: 'Tàng Kinh Bị Động', tab: 'Bị Động' }];
// Read-only status for the local profile monitor; never starts a draw.
window.TuTienFreeBooks = Object.freeze({ status() {
  const g = access.get();
  if (!g?.SceneWorld?.player || typeof g?.Gacha?.freeToday !== 'function' || typeof g?.Gacha?.soldOut !== 'function')
    return { ready: false, pools: [] };
  try {
    return { ready: true, pools: pools.map(pool => ({ id: pool.id,
      free: g.Gacha.freeToday(g, pool.id) === true, soldOut: g.Gacha.soldOut(g, pool.id) === true })) };
  } catch (_) { return { ready: false, pools: [] }; }
} });
let ui = { status: {}, start: {}, stop: {} }, running = false, state = 'IDLE', message = 'Chờ vào nhân vật.', started = 0, last = 0, pending = null;
let targetPool = null, lastVersion = '';
const now = () => Date.now();
function visible(node) { return !!node && !node.disabled && !!node.getClientRects().length; }
function phase(next, detail) {
  if (state !== next || message !== detail) logger.add('STATE', { state: next, message: detail });
  state = next; message = detail;
  if (ui) ui.status.textContent = detail;
}
function press(key) {
  for (const type of ['keydown', 'keyup']) document.dispatchEvent(new KeyboardEvent(type, { key, code: 'Key' + key.toUpperCase(), bubbles: true }));
  last = now();
}
function otherAutoRunning() {
  try {
    const s = window.TuTienAuto?.status?.();
    return !!(s?.automation?.running || s?.navigation?.running || s?.quests?.running || s?.intro?.running || s?.garden?.running);
  } catch (_) { return true; }
}
function stop(detail, result = 'STOPPED') {
  if (navigation.status().running) navigation.stop(detail);
  running = false; pending = null; targetPool = null; controller.reset();
  phase(result, detail);
  if (ui) { ui.start.disabled = false; ui.stop.disabled = true; }
}
function start() {
  if (running) return;
  const g = access.get(), w = g?.SceneWorld;
  if (!w?.player || !w.map?.data?.id) return phase('ERROR', 'Chưa đọc được nhân vật. Tắt script auto khác rồi tải lại trang.');
  if (otherAutoRunning() || w.autoDC || w.diNV) return phase('ERROR', 'Hãy dừng các chức năng auto khác trước.');
  if (!g.Gacha || typeof g.Gacha.freeToday !== 'function' || typeof g.Gacha.soldOut !== 'function' ||
      typeof g.Gacha.open !== 'function' || !g.GachaUI) return phase('ERROR', 'Chưa đọc được quầy bí tịch.');
  if (!g.Gacha.open(g)) return phase('ERROR', 'Game chưa mở quầy bí tịch; cần hoàn thành nhiệm vụ mở quầy.');
  running = true; state = 'PREPARE'; started = now(); last = 0; pending = null; targetPool = null;
  ui.start.disabled = true; ui.stop.disabled = false;
  phase('PREPARE', 'Đang kiểm tra lượt rút miễn phí.');
}
function available(g, pool) {
  return g.Gacha.freeToday(g, pool.id) === true && g.Gacha.soldOut(g, pool.id) === false;
}
function tick() {
  if (!running) return;
  try {
    const g = access.get(), w = g?.SceneWorld, p = w?.player;
    if (!p || p.downed || p.hp <= 0) return stop('Không đọc được nhân vật hoặc nhân vật đã gục.', 'ERROR');
    if (otherAutoRunning() || w.autoDC || w.diNV) return stop('Có chức năng auto khác đang chạy.', 'ERROR');
    if (now() - started > 300000) return stop('Chưa hoàn tất trong 5 phút.', 'ERROR');
    if (w.transitioning) return;
    if (pending) {
      if (!g.Gacha.freeToday(g, pending.id) && !g.GachaUI.rolling) {
        logger.add('DRAW_CONFIRMED', { pool: pending.id }); pending = null; targetPool = null; last = now();
      } else if (now() - pending.at > 30000) return stop('Chưa xác nhận lượt rút; đã dừng, không thử lại.', 'ERROR');
      return;
    }
    if (state === 'PREPARE') {
      if (w.autoOn) { if (now() - last >= 1500) press('t'); return; }
      if (p.flying) { if (now() - last >= 1500) press('f'); return; }
      if (p.state === 'sit') { if (now() - last >= 1500) press('q'); return; }
      if (g.HUD?.bagOpen) { if (now() - last >= 1500) press('b'); return; }
      if (g.HUD?.dialogOpen) { document.querySelector('#dialog-close')?.click(); return; }
      if (!p.hpMax || p.hp < p.hpMax * .35) return stop('HP thấp; hãy hồi máu trước khi đi.', 'ERROR');
      const pool = pools.find(item => available(g, item));
      if (!pool) return stop('Hai tủ không còn lượt miễn phí khả dụng hôm nay.', 'DONE');
      if (!navigation.start({ target: 'tan_vien', npcId: 'tang_kinh_lao_nhan', otherScriptsStopped: true })) {
        return stop(navigation.status().message || 'Không bắt đầu được đường tới Tàng Kinh Lão Nhân.', 'ERROR');
      }
      phase('TRAVEL', 'Đang tới Tàng Kinh Lão Nhân.'); return;
    }
    if (state === 'TRAVEL') {
      navigation.tick();
      if (navigation.status().running) return;
      if (navigation.status().state !== 'DONE') return stop(navigation.status().message || 'Không tới được Tàng Kinh Lão Nhân.', 'ERROR');
      phase('NPC', 'Đã tới gần Tàng Kinh Lão Nhân.'); last = 0; return;
    }
    const next = pools.find(item => available(g, item));
    if (!next) {
      if (g.GachaUI.open) { document.querySelector('#gacha-close')?.click(); return; }
      if (g.HUD?.dialogOpen) { document.querySelector('#dialog-close')?.click(); return; }
      return stop('Đã kiểm tra và rút các lượt miễn phí có thể dùng hôm nay.', 'DONE');
    }
    if (now() - last < 1200) return;
    if (g.GachaUI.open) {
      if (g.GachaUI.rolling) return;
      if (g.Gacha.activePoolId !== next.id) {
        const tab = [...document.querySelectorAll('#gacha-pools button')].find(b => visible(b) && b.textContent.trim() === next.tab);
        if (!tab) return stop('Không tìm được thẻ ' + next.label + '.', 'ERROR');
        tab.click(); last = now(); phase('POOL', 'Đã chọn ' + next.label + '.'); return;
      }
      const button = document.querySelector('#gacha-one');
      if (!visible(button) || !/^Rút 1\s*·\s*Miễn phí hôm nay$/i.test(button.textContent.trim()) || !available(g, next)) {
        return stop('Không xác nhận được lượt miễn phí; chưa bấm rút.', 'ERROR');
      }
      pending = { id: next.id, at: now() }; last = now();
      button.click(); phase('WAIT_DRAW', 'Đã yêu cầu lượt miễn phí ' + next.label + '; đang chờ game xác nhận.'); return;
    }
    if (g.HUD?.dialogOpen) {
      if (document.querySelector('#dialog-title')?.textContent.trim() !== 'Tàng Kinh Lão Nhân') return stop('Game mở hội thoại khác tại NPC.', 'ERROR');
      const button = [...document.querySelectorAll('#dialog-choices button')].find(b => visible(b) && b.textContent.trim().startsWith(next.label));
      if (!button) return stop('Không thấy tủ ' + next.label + ' trong hội thoại.', 'ERROR');
      button.click(); last = now(); targetPool = next.id; phase('OPEN_POOL', 'Đang mở ' + next.label + '.'); return;
    }
    if (state !== 'NPC' && state !== 'OPEN_POOL' && state !== 'WAIT_DRAW') return stop('Trạng thái rút bí tịch chưa xác định.', 'ERROR');
    const npc = w.map?.props?.find(o => o.id === 'tang_kinh_lao_nhan' && !o.hidden);
    if (!npc || w.map?.data?.id !== 'tan_vien') return stop('Không tìm thấy Tàng Kinh Lão Nhân.', 'ERROR');
    if (g.Quest?.stage === 15) {
      // The stage-15 NPC dialog is reserved for Yêu Cốt, even when the book
      // shop is already unlocked. Open the game's own UI only at the NPC.
      const target = A.findNpc(g, 'tang_kinh_lao_nhan');
      if (!target || Math.hypot(p.x - target.x, p.y - target.y) > Math.min(36, Math.max(20, target.r - 12)) + 3) {
        return stop('Chưa xác nhận nhân vật đã tới gần Tàng Kinh Lão Nhân.', 'ERROR');
      }
      if (!g.Gacha.open(g) || typeof g.GachaUI.show !== 'function') return stop('Quầy bí tịch chưa sẵn sàng.', 'ERROR');
      g.GachaUI.show(next.id);
      if (!g.GachaUI.open) return stop('Game chưa mở quầy bí tịch ở Giai đoạn 15.', 'ERROR');
      last = now(); phase('OPEN_POOL', 'Đã mở quầy bí tịch tại Lão Nhân.'); return;
    }
    const targeting = g.Targeting;
    if (!targeting || typeof targeting.current !== 'function' || typeof targeting.cycle !== 'function') return stop('Không đọc được mục tiêu tương tác.', 'ERROR');
    for (let i = 0; i < (targeting.list?.length || 0) * 2 + 4; i++) {
      const selected = targeting.current();
      if (selected?.obj === npc && selected.dist <= selected.r) { press('e'); phase('NPC', 'Đang mở hội thoại Tàng Kinh Lão Nhân.'); return; }
      targeting.cycle();
    }
    if (now() - last > 20000) return stop('Chưa tương tác được với Tàng Kinh Lão Nhân.', 'ERROR');
  } catch (error) { stop(String(error?.message || error), 'ERROR'); }
}

return { start, tick, stop, status: () => ({ running, state, message }) };
};
if (window.TuTienStoneFarm) return;
const access = A.createGameAccess(window);
const entries = [];
const logger = { add(event, data = {}) { entries.push({ at: new Date().toISOString(), event, data }); if (entries.length > 400) entries.shift(); } };
const controller = A.createController();
const navigation = A.createNavigation({ getGame: () => access.get(), logger, controller });
const farm = A.createStoneFarm({ getGame: () => access.get(), doc: document, host: window, controller, navigation, logger });
const books = A.createIntegratedBooks();
const resumeKey = 'tutien_combat_pipeline_resume';
let running = false, state = 'IDLE', message = 'Chưa chạy.', startedName = '', ownsQuest = false, startedAt = 0;
let resumePending = false, resumeAt = Date.now();
let disconnectedAt = 0, resumeState = null;
let skippedTasks = [];
let preferredMapId = null;
try { resumePending = sessionStorage.getItem(resumeKey) === '1'; } catch (_) {}
function phase(next, detail) { if (state !== next || message !== detail) logger.add('PIPELINE_STATE', { from: state, to: next, detail }); state = next; message = detail; }
function stop(reason = 'Đã dừng theo yêu cầu.', result = 'STOPPED', preserve = false) {
  resumePending = false;
  if (books.status().running) books.stop(reason);
  if (farm.status().running) farm.stop(reason, 'STOPPED', preserve);
  if (ownsQuest && window.TuTienAuto?.status?.()?.quests?.running) window.TuTienAuto.stop();
  ownsQuest = false; running = false; disconnectedAt = 0; resumeState = null;
  if (!preserve) { try { sessionStorage.removeItem(resumeKey); } catch (_) {} }
  phase(result, reason); return false;
}
function status() {
  const f = farm.status();
  return { ...f, running, state, phase: state, preferredMapId, message: message + (skippedTasks.length ? ' · Việc chưa hỗ trợ: ' + skippedTasks.join(', ') : ''), skippedTasks: [...skippedTasks], books: books.status(), quest: ownsQuest ? window.TuTienAuto?.status?.()?.quests : null };
}
function availableMaps() { try { return A.stoneFarmCandidates(access.get()).map(({id,name}) => ({id,name})); } catch (_) { return []; } }
function start(options = {}) {
  if (running) return false;
  const g = access.get(), name = (document.getElementById('hud-name')?.textContent || '').trim();
  const s = window.TuTienAuto?.status?.();
  if (!g?.SceneWorld?.player || !g?.Gateway?.ready || !name) return stop('Chưa đọc được nhân vật hoặc kết nối game.', 'ERROR');
  const requestedMap = options.mapId || null;
  if (requestedMap && (typeof requestedMap !== 'string' || !availableMaps().some(m => m.id === requestedMap))) return stop('Bản đồ đã chọn không có quái phù hợp hoặc chưa có đường đi hợp lệ.', 'ERROR');
  if (!window.TuTienAuto?.startQuests || !s) return stop('Chưa thấy Auto tổng phiên bản hỗ trợ Dược Công.', 'ERROR');
  if (['automation','intro','quests','garden','navigation'].some(k => s[k]?.running) || g.SceneWorld.autoOn || g.SceneWorld.autoDC || g.SceneWorld.diNV)
    return stop('Hãy dừng auto khác trước khi chạy.', 'ERROR');
  const legacy = document.getElementById('tt-free-books')?.shadowRoot?.getElementById('stop');
  if (legacy && !legacy.disabled) return stop('Script Bí tịch cũ đang chạy; hãy dừng và tắt script cũ.', 'ERROR');
  running = true; startedName = name; startedAt = Date.now(); ownsQuest = false; resumePending = false; disconnectedAt = 0; resumeState = null; skippedTasks = []; preferredMapId = requestedMap;
  try { sessionStorage.setItem(resumeKey, '1'); sessionStorage.setItem('tutien_combat_pipeline_map', preferredMapId || ''); } catch (_) {}
  phase('CHECK_BOOKS', 'Đang kiểm tra bí tịch miễn phí.'); return true;
}
function tick() {
  if (!running) return;
  try {
    const g = access.get(), p = g?.SceneWorld?.player;
    if (!p || !g?.Gateway?.connected || !g?.Gateway?.ready) {
      if (!disconnectedAt) { disconnectedAt = Date.now(); resumeState = state; }
      phase('WAIT_CONNECTION', 'Mất dữ liệu hoặc kết nối game; đang chờ game kết nối lại.');
      if (Date.now() - disconnectedAt > 120000) return stop('Mất kết nối quá 120 giây; chưa thể tiếp tục farm.', 'ERROR');
      return;
    }
    if (disconnectedAt) {
      const previous = resumeState || 'CHECK_BOOKS';
      disconnectedAt = 0; resumeState = null;
      if (previous === 'QUESTS' && !window.TuTienAuto?.status?.()?.quests?.running) {
        ownsQuest = false;
        phase('CHECK_QUESTS', 'Kết nối game đã phục hồi; kiểm tra lại tiến độ Dược Công.');
      } else phase(previous, 'Kết nối game đã phục hồi; tiếp tục luồng auto.');
    }
    const name = (document.getElementById('hud-name')?.textContent || '').trim();
    if (name && name !== startedName) return stop('Nhân vật đã thay đổi.', 'ERROR');
    const s = window.TuTienAuto?.status?.();
    if (['automation','intro','garden','navigation'].some(k => s?.[k]?.running) || (!ownsQuest && s?.quests?.running)) return stop('Có auto khác đang chạy.', 'ERROR');
    if (state === 'CHECK_BOOKS') {
      if (typeof g?.Gacha?.open !== 'function' || typeof g?.Gacha?.freeToday !== 'function' || typeof g?.Gacha?.soldOut !== 'function') return stop('Chưa đọc được dữ liệu bí tịch.', 'ERROR');
      if (!g.Gacha.open(g)) { phase('CHECK_QUESTS', 'Chưa mở quầy bí tịch; kiểm tra Dược Công.'); return; }
      const pools = ['so_cap','bi_dong'].map(id => ({ free: g.Gacha.freeToday(g, id), soldOut: g.Gacha.soldOut(g, id) }));
      if (pools.some(pool => typeof pool.free !== 'boolean' || typeof pool.soldOut !== 'boolean')) return stop('Không xác minh được lượt bí tịch miễn phí.', 'ERROR');
      const available = pools.some(pool => pool.free && !pool.soldOut);
      if (!available) { phase('CHECK_QUESTS', 'Không còn lượt bí tịch miễn phí khả dụng; kiểm tra Dược Công.'); return; }
      books.start(); const b = books.status();
      if (!b.running) return stop(b.message || 'Không bắt đầu được rút bí tịch.', 'ERROR');
      phase('BOOKS', 'Đang rút bí tịch miễn phí.'); return;
    }
    if (state === 'BOOKS') {
      books.tick(); const b = books.status();
      if (b.running) { phase('BOOKS', b.message); return; }
      if (b.state !== 'DONE') return stop(b.message || 'Rút bí tịch chưa hoàn tất.', 'ERROR');
      phase('CHECK_QUESTS', 'Đã kiểm tra bí tịch; đang kiểm tra Dược Công.'); return;
    }
    if (state === 'CHECK_QUESTS') {
      if (typeof g?.Quest?.canOpenSeedMenu === 'function' && !g.Quest.canOpenSeedMenu()) { phase('START_FARM', 'Dược Công chưa mở; bắt đầu farm.'); return; }
      const c = A.readDuocCong(g);
      if (!c.available) return stop('Chưa đọc được danh sách Dược Công.', 'ERROR');
      const unsupported = c.tasks.filter(t => t.status === 'NEEDS_ADAPTER');
      skippedTasks = unsupported.map(t => t.name);
      if (c.active && !c.active.supported) return stop('Đang giữ Dược Công chưa hỗ trợ: ' + c.active.name, 'ERROR');
      if (!c.active && !c.tasks.some(t => t.status === 'READY')) {
        phase('START_FARM', 'Đã hết lượt Dược Công có thể làm; bắt đầu farm.'); return;
      }
      if (!window.TuTienAuto.startQuests({ otherScriptsStopped: true })) return stop(window.TuTienAuto.status()?.quests?.message || 'Không bắt đầu được Dược Công.', 'ERROR');
      ownsQuest = true; phase('QUESTS', 'Đang làm Dược Công.'); return;
    }
    if (state === 'QUESTS') {
      const q = s?.quests;
      if (q?.running) { phase('QUESTS', q.message || 'Đang làm Dược Công.'); return; }
      ownsQuest = false;
      if (!['DONE', 'PENDING_ACTIVITIES'].includes(q?.state)) return stop(q?.message || 'Dược Công dừng trước khi hoàn tất.', 'ERROR');
      phase('CHECK_QUESTS', 'Kiểm tra lại các lượt Dược Công.'); return;
    }
    if (state === 'START_FARM') {
      if (!farm.start({ otherScriptsStopped: true, mapId: preferredMapId })) return stop(farm.status().message || 'Không bắt đầu được farm.', 'ERROR');
      phase('FARM', 'Đang farm Linh Thạch.'); return;
    }
    if (state === 'FARM') {
      farm.tick(); const f = farm.status();
      if (!f.running) return stop(f.message, f.state);
      phase('FARM', f.message);
    }
  } catch (error) { stop(error?.message || String(error), 'ERROR'); }
}
window.TuTienStoneFarm = Object.freeze({ version: '2.0.9', start, stop, status, maps: availableMaps,
  report: () => ({ schema: 'tutien2d-combat-pipeline-v1', version: '2.0.9', status: status(), access: access.diagnostics(), events: entries.slice() }) });
function manual(event) { if (running && event.isTrusted) stop('Đã dừng vì bạn thao tác trong game.'); }
document.addEventListener('pointerdown', manual, true);
window.addEventListener('keydown', event => { if (/^(Escape|Key[WASDEQTF]|Arrow(Up|Down|Left|Right))$/.test(event.code)) manual(event); }, true);
window.addEventListener('pagehide', () => { if (running) stop('Trang tải lại; chờ tiếp tục.', 'STOPPED', true); });
setInterval(() => {
  if (resumePending && Date.now() - resumeAt < 120000 && access.get()?.Gateway?.ready && window.TuTienAuto?.status?.()?.snapshot?.ready) { let mapId = ''; try { mapId = sessionStorage.getItem('tutien_combat_pipeline_map') || ''; } catch (_) {} start({ mapId }); }
  else if (resumePending && Date.now() - resumeAt >= 120000) stop('Không thể tiếp tục sau khi tải trang quá 120 giây.', 'ERROR');
  tick();
}, 250);

})();
