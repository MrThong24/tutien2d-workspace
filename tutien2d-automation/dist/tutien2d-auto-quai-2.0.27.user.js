// ==UserScript==
// @name         TuTien2D - Auto quai, duoc cong va linh thach
// @namespace    local.tutien2d.stone-farm
// @version      2.0.27
// @updateURL    http://127.0.0.1:19444/auto-quai.user.js
// @downloadURL  http://127.0.0.1:19444/auto-quai.user.js
// @match        https://tutien2d.com/*
// @match        https://www.tutien2d.com/*
// @match        https://tutienpixel.online/*
// @match        https://www.tutienpixel.online/*
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
    // The Linh Thạch mine contains a boss and its guards, but this farm mode
    // must only target Thạch Ma. Filter the spawn table before the boss check.
    const spawns = map.enemies.filter(e =>
      (id !== 'mo_linh_thach' || e.type === 'thach_ma') &&
      (!e.requireStage || (Number.isInteger(game.Quest?.stage) && game.Quest.stage >= e.requireStage)));
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

A.createStoneFarm = function ({ getGame, doc, host, controller, navigation, logger, now = Date.now, random = Math.random }) {
  let running = false, state = 'IDLE', message = 'Chưa chạy.', started = 0, lastInput = 0;
  let startBalance = null, lastBalance = null, gained = 0, spent = 0, farmMap = null, travel = null;
  let move = null, targetId = null, ownsCombat = false;
  let resumeCombatAfterRevive = false;
  let lastGain = 0, observedDeaths = 0, enemyStates = new Map(), excludedMaps = new Set();
  let deathsSinceMine = 0, minePending = null, mineSkippedUntil = new Map();
  let recovering = false, reviveAt = 0, reviveDelayUntil = 0, downSince = 0;
  let restSpot = null, restSearchAt = 0, recentRestKeys = [];
  let disconnectedAt = 0, lastSnapshot = null, startedName = null, initialRealm = null;
  let zoneMap = null, zoneStep = null;
  let zonePopulation = null;
  let farmZoneId = null, returnZoneId = null, zoneReturnPending = false;
  let flightPending = null, flightBlockedUntil = 0;
  let preferredMapId = null;
  let preferredZoneId = null;
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
  function restSpotSafe(g, point) {
    const tile = g.CONFIG?.TILE || 48;
    const radius = Math.max(160, tile * 3.5);
    return !(g.SceneWorld.enemies || []).some(e => !e.dead && e.hp > 0 && !e.def?.human &&
      Number.isFinite(e.x) && Number.isFinite(e.y) && targetDistance(point, e) < radius);
  }
  function findRestSpot(g) {
    const map = g.SceneWorld.map, tile = g.CONFIG?.TILE;
    const width = Number(map?.width || map?.data?.width), height = Number(map?.height || map?.data?.height);
    if (!Number.isFinite(tile) || tile <= 0 || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
    const portals = new Set((map.portals || []).map(p => p.tx + ':' + p.ty));
    const tried = new Set();
    for (let i = 0; i < 32; i++) {
      const tx = Math.floor(random() * width), ty = Math.floor(random() * height), key = map.data.id + ':' + tx + ':' + ty;
      if (tried.has(key) || portals.has(tx + ':' + ty) || recentRestKeys.includes(key)) continue;
      tried.add(key);
      const point = A.tileCenter(g, tx, ty);
      if (!restSpotSafe(g, point)) continue;
      const path = A.makePath(g, point, { tx, ty });
      if (!path) continue;
      recentRestKeys.push(key);
      if (recentRestKeys.length > 12) recentRestKeys.shift();
      return point;
    }
    return null;
  }
  function observeEnemies(w) {
    for (const e of w.enemies || []) {
      if (!e?.id || !eligibleEnemy(getGame(), e, w.map.data.id)) continue;
      const dead = !!e.dead || (Number.isFinite(e.hp) && e.hp <= 0);
      if (enemyStates.get(e.id) === false && dead) {
        observedDeaths++; deathsSinceMine++;
        if (targetId === e.id) targetId = null;
      }
      enemyStates.set(e.id, dead);
    }
    if (w.map?.data?.id === 'mo_linh_thach' && targetId && w.autoOn) {
      const target = (w.enemies || []).find(e => e.id === targetId);
      if (!target || target.dead || target.hp <= 0) { observedDeaths++; deathsSinceMine++; targetId = null; }
    }
  }
  function eligibleEnemy(g, enemy, mapId) {
    if (mapId === 'mo_linh_thach' && enemy?.type !== 'thach_ma') return false;
    return A.stoneFarmEnemy(g, enemy, mapId);
  }
  function mineNodes(g) {
    const w = g.SceneWorld, map = w.map;
    return [...(map.props || []), ...(map.flatProps || [])].filter(obj =>
      obj && ['mach_han_tinh', 'mach_tu_tinh', 'mach_luc_tinh', 'phong_tinh_mach'].includes(obj.type) &&
      !obj.hidden && !obj.off && !obj.harvestPending && Number.isFinite(obj.x) && Number.isFinite(obj.y) &&
      (mineSkippedUntil.get(obj.id) || 0) <= now());
  }
  function mineOne(g) {
    const w = g.SceneWorld, p = w.player, nodes = mineNodes(g);
    if (minePending) {
      const { obj, before, at } = minePending;
      const after = ['han_tinh_thach', 'tu_tinh_thach', 'luc_tinh_thach', 'phong_tinh_thach']
        .reduce((sum, id) => sum + (g.Inventory?.count?.(id) || 0), 0);
      if (obj.hidden || after > before) {
        mineSkippedUntil.set(obj.id, now() + 30000);
        minePending = null; deathsSinceMine = 0;
        phase('MINE', 'Đã đào một mạch tinh thạch; quay lại đánh Thạch Ma.'); return true;
      }
      if (now() - at < 15000) { phase('MINE', 'Đang chờ game xác nhận đào tinh thạch.'); return true; }
      mineSkippedUntil.set(obj.id, now() + 60000); minePending = null; deathsSinceMine = 0;
      phase('MINE', 'Game chưa xác nhận mạch vừa đào; bỏ qua tạm thời và tiếp tục đánh Thạch Ma.'); return true;
    }
    if (!nodes.length) { deathsSinceMine = 0; return false; }
    const obj = nodes.sort((a, b) => targetDistance(p, a) - targetDistance(p, b))[0];
    const point = { x: obj.x, y: obj.y - (g.CONFIG?.TILE || 48) / 2 };
    if (!go(g, point, Math.max(20, (obj.r || 40) - 8), 'mạch tinh thạch')) return true;
    clearPath();
    const targeting = g.Targeting, list = targeting?.list || [];
    if (typeof targeting?.cycle !== 'function' || typeof targeting?.current !== 'function')
      throw Error('Thiếu bộ chọn mục tiêu để đào tinh thạch.');
    let selected = false;
    for (let i = 0; i < list.length * 2 + 4; i++) {
      const current = targeting.current();
      if (current?.obj === obj && !['enemy', 'player', 'duel', 'dosat'].includes(current.kind)) {
        if (current.dist > current.r) return true;
        selected = true; break;
      }
      targeting.cycle();
    }
    if (!selected) { phase('MINE', 'Đang chọn mạch tinh thạch để đào.'); return true; }
    const before = ['han_tinh_thach', 'tu_tinh_thach', 'luc_tinh_thach', 'phong_tinh_thach']
      .reduce((sum, id) => sum + (g.Inventory?.count?.(id) || 0), 0);
    if (press('e')) {
      minePending = { obj, before, at: now() };
      phase('MINE', 'Đang đào ' + (obj.name || obj.type) + '.');
    }
    return true;
  }
  function chooseZone(g) {
    const map = g.SceneWorld.map.data.id, ui = g.KhuUI;
    const done = () => {
      const confirmedZone = zoneStep?.confirmedZone || zoneStep?.target || ui?.khu;
      zoneMap = map; zoneStep = null;
      farmZoneId = Number.isInteger(confirmedZone) && confirmedZone > 0 ? confirmedZone : farmZoneId;
      if (zoneReturnPending) { zoneReturnPending = false; returnZoneId = null; }
    };
    if (preferredZoneId && (!ui || !Number.isInteger(ui.soKhu) || preferredZoneId > ui.soKhu))
      throw Error('Khu ' + preferredZoneId + ' không có trên bản đồ farm này.');
    if (!ui || !Number.isInteger(ui.soKhu) || ui.soKhu <= 1) { done(); return false; }
    // Check once when entering a farm map; do not poll an acceptable zone on a timer.
    if (zoneMap === map && !zoneReturnPending) return false;
    if (zoneReturnPending && returnZoneId === ui.khu && (!preferredZoneId || preferredZoneId === ui.khu)) {
      zoneMap = map; zoneReturnPending = false; returnZoneId = null;
      return false;
    }
    if (!zoneStep) {
      if (typeof ui.open !== 'function' || typeof ui.close !== 'function') throw Error('Cannot read the zone list.');
      zonePopulation = null;
      if (typeof ui.onList === 'function' && !ui.__stoneFarmZoneListHook) {
        const onList = ui.onList;
        ui.onList = function (data) {
          if (data?.mapId === ui.mapId && Array.isArray(data.dem)) {
            zonePopulation = { mapId: data.mapId, counts: data.dem.map(value => Math.max(0, Number(value) || 0)), at: now() };
          }
          return onList.call(this, data);
        };
        ui.__stoneFarmZoneListHook = true;
      }
      const p = g.SceneWorld.player;
      zoneStep = { map, started: now(), from: ui.khu, target: null, stage: 'TO_BOARD', returnPoint: { x: p.x, y: p.y }, captionBefore: (doc.querySelector('#ritual-caption')?.textContent || '').trim() };
      phase('ZONE', 'Đang tới Bảng Khu để kiểm tra khu một lần.'); return true;
    }
    if (zoneStep.map !== map) { ui.close(); zoneStep = null; return true; }
    if (zoneStep.target) {
      if (ui.khu === zoneStep.target) {
        zoneStep.confirmedZone = zoneStep.target; zoneStep.target = null; zoneStep.stage = 'RETURN_TO_FARM'; ui.close();
        log('STONE_ZONE_CHANGED', { from: zoneStep.from, to: zoneStep.confirmedZone, confirmedBy: 'khu' });
        phase('ZONE', 'Đã đổi khu; quay lại vị trí farm.'); return true;
      }
      const caption = (doc.querySelector('#ritual-caption')?.textContent || '').trim();
      if (caption && caption !== zoneStep.captionBefore && /không được|không còn nằm đó|không thể|đã đầy|từ chối/i.test(caption)) {
        log('STONE_ZONE_REJECTED', { from: zoneStep.from, target: zoneStep.target, actual: ui.khu, caption });
        throw Error('Game từ chối đổi khu ' + zoneStep.target + ': ' + caption);
      }
      if (now() - zoneStep.changedAt > 15000) throw Error('Không xác nhận được game đã chuyển khu ' + zoneStep.target + '; hiện vẫn báo khu ' + ui.khu + '.');
      phase('ZONE', 'Đang chờ game chuyển sang khu ' + zoneStep.target + '.'); return true;
    }
    if (zoneStep.stage === 'RETURN_TO_FARM') {
      if (!autoOff(g) || !ensureGround(g)) return true;
      if (!go(g, zoneStep.returnPoint, 28, 'vị trí farm')) return true;
      clearPath(); ui.close(); done(); return false;
    }
    if (zoneStep.stage === 'TO_BOARD') {
      if (!autoOff(g) || !ensureGround(g)) return true;
      const boards = (g.SceneWorld.map.props || []).filter(o => o.type === 'khu_board' && !o.hidden && Number.isFinite(o.x) && Number.isFinite(o.y));
      boards.sort((a, b) => targetDistance(g.SceneWorld.player, a) - targetDistance(g.SceneWorld.player, b));
      if (!boards.length) throw Error('Không tìm thấy Bảng Khu để đổi khu.');
      const board = boards[0], point = { x: board.x, y: board.y - (g.CONFIG.TILE / 2) };
      phase('ZONE', 'Đang tới Bảng Khu để kiểm tra và đổi khu.');
      if (!go(g, point, Math.max(20, (board.r || 44) - 8), 'Bảng Khu')) return true;
      clearPath(); ui.close(); zoneStep.stage = 'QUERY_BOARD'; zoneStep.started = now(); zoneStep.from = ui.khu; zonePopulation = null;
      zoneStep.captionBefore = (doc.querySelector('#ritual-caption')?.textContent || '').trim(); ui.open();
      phase('ZONE', 'Đang kiểm tra tình trạng các khu tại Bảng Khu.'); return true;
    }
    if (now() - zoneStep.started < 1800) return true;
    if (!zonePopulation || zonePopulation.mapId !== ui.mapId || zonePopulation.at < zoneStep.started || zonePopulation.counts.length < ui.soKhu) {
      if (now() - zoneStep.started < 8000) return true;
      throw Error('Game chưa gửi số người trong từng khu; không thể áp dụng ngưỡng 3 người.');
    }
    const buttons = [...doc.querySelectorAll('#khu-panel .khu-o[data-khu]')].map(button => ({
      button,
      id: Number(button.getAttribute('data-khu')),
      people: zonePopulation.counts[Number(button.getAttribute('data-khu')) - 1] ?? null
    })).filter(z => Number.isInteger(z.id) && !z.button.disabled && !z.button.classList.contains('day'));
    if (!buttons.length) { if (now() - zoneStep.started < 8000) return true; throw Error('Không đọc được danh sách khu còn chỗ.'); }
    const currentPeople = zonePopulation.counts[ui.khu - 1];
    if (preferredZoneId) {
      if (preferredZoneId > ui.soKhu) throw Error('Khu ' + preferredZoneId + ' không có trên bản đồ farm này.');
      if (preferredZoneId === ui.khu) {
        zoneStep.confirmedZone = ui.khu; zoneStep.stage = 'RETURN_TO_FARM'; ui.close();
        phase('ZONE', 'Đang ở khu đã chọn; quay lại vị trí farm.'); return true;
      }
      const preferred = buttons.find(z => z.id === preferredZoneId);
      if (!preferred) throw Error('Khu ' + preferredZoneId + ' đã đầy hoặc không thể vào.');
      zoneStep.captionBefore = (doc.querySelector('#ritual-caption')?.textContent || '').trim();
      zoneStep.target = preferred.id; zoneStep.changedAt = now(); preferred.button.click();
      phase('ZONE', 'Đang đổi sang khu đã chọn: ' + preferred.id + '.'); return true;
    }
    if (zoneReturnPending && returnZoneId && returnZoneId !== ui.khu) {
      const returnTarget = buttons.find(z => z.id === returnZoneId);
      if (returnTarget && returnTarget.people < 3) {
        if (zoneStep.stage !== 'QUERY_BOARD') {
          ui.close(); zoneStep.pendingTarget = returnTarget.id; zoneStep.stage = 'TO_BOARD';
          phase('ZONE', 'Cần quay lại khu farm; đang tới Bảng Khu.'); return true;
        }
        zoneStep.captionBefore = (doc.querySelector('#ritual-caption')?.textContent || '').trim();
        zoneStep.target = returnTarget.id; zoneStep.changedAt = now(); returnTarget.button.click();
        phase('ZONE', 'Đang quay lại khu farm ' + returnTarget.id + ' sau khi hồi HP.'); return true;
      }
    }
    if (currentPeople < 3) {
      if (zoneStep.stage === 'QUERY_BOARD') { zoneStep.confirmedZone = ui.khu; zoneStep.stage = 'RETURN_TO_FARM'; ui.close(); return true; }
      ui.close(); done(); return false;
    }
    const choices = buttons.filter(z => z.id !== ui.khu);
    if (!choices.length) {
      if (zoneStep.stage === 'QUERY_BOARD') { zoneStep.confirmedZone = ui.khu; zoneStep.stage = 'RETURN_TO_FARM'; ui.close(); return true; }
      ui.close(); done(); return false;
    }
    const underThreshold = choices.filter(z => z.people < 3);
    const pool = underThreshold.length ? underThreshold : choices;
    const leastCrowded = Math.min(...pool.map(z => z.people));
    if (currentPeople <= leastCrowded) {
      if (zoneStep.stage === 'QUERY_BOARD') { zoneStep.confirmedZone = ui.khu; zoneStep.stage = 'RETURN_TO_FARM'; ui.close(); return true; }
      ui.close(); done(); return false;
    }
    const eligible = pool.filter(z => z.people === leastCrowded);
    const chosen = eligible[Math.floor(Math.random() * eligible.length)];
    if (zoneStep.stage !== 'QUERY_BOARD') {
      ui.close(); zoneStep.pendingTarget = chosen.id; zoneStep.stage = 'TO_BOARD';
      phase('ZONE', 'Khu hiện tại đông; đang tới Bảng Khu để đổi sang khu ' + chosen.id + '.'); return true;
    }
    if (!autoOff(g) || !ensureGround(g)) return true;
    zoneStep.captionBefore = (doc.querySelector('#ritual-caption')?.textContent || '').trim();
    zoneStep.target = chosen.id; zoneStep.changedAt = now(); chosen.button.click();
    phase('ZONE', 'Đang đổi sang khu ' + chosen.id + ' (' + chosen.people + ' người).'); return true;
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
    if (reason === 'Rời bãi để hồi HP') {
      const currentZone = g.KhuUI?.khu;
      returnZoneId = Number.isInteger(currentZone) && currentZone > 0 ? currentZone : farmZoneId;
      zoneReturnPending = Number.isInteger(returnZoneId) && returnZoneId > 0;
      zoneMap = null; targetId = null;
    }
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
      if (downSince && g.SceneWorld.autoOn) {
        phase('REVIVE_RESET', 'Đã hồi sinh; đang tắt chiến đấu trước khi quay lại bãi.');
        if (now() - lastInput >= 700) press('t');
        return true;
      }
      if (downSince && !reviveDelayUntil) {
        reviveDelayUntil = now() + 1000 + Math.floor(random() * 9001);
        phase('REVIVE_DELAY', 'Đã hồi sinh; chờ ngẫu nhiên trước khi quay lại bãi farm.');
        return true;
      }
      if (downSince && now() < reviveDelayUntil) return true;
      if (downSince) { downSince = 0; reviveAt = 0; reviveDelayUntil = 0; resumeCombatAfterRevive = false; recovering = false; restSpot = null; returnZoneId = farmZoneId; zoneReturnPending = Number.isInteger(returnZoneId) && returnZoneId > 0; zoneMap = null; targetId = null; enemyStates.clear(); clearPath(); phase('CHECK', farmMap ? 'Đã hồi sinh; quay lại bãi farm ' + farmMap.name + '.' : 'Đã hồi sinh; tìm lại bãi farm.'); }
      return false;
    }
    if (!downSince) resumeCombatAfterRevive = ownsCombat;
    clearPath(); ownsCombat = false;
    if (travel) { navigation.stop('Nhân vật bị gục.'); travel = null; controller.reset(); controller.acquire('stone'); }
    if (!downSince) { downSince = now(); reviveDelayUntil = 0; }
    phase('REVIVE', 'Nhân vật gục; tiếp tục chờ hồi sinh miễn phí, không giới hạn thời gian.');
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
    if (!recovering) { recovering = true; restSpot = null; restSearchAt = 0; log('STONE_HEAL_BEGIN', { hp: p.hp, hpMax: p.hpMax, map: w.map.data.id, zone: g.KhuUI?.khu ?? null }); }
    if (!autoOff(g)) { phase('HEAL', 'Đang dừng chiến đấu để hồi HP.'); return true; }
    if (closeDialog(g)) return true;
    if (p.flying) { press('f'); return true; }
    if (p.hp >= p.hpMax) {
      if (p.state === 'sit') { press('q'); return true; }
      if (p.sitLocked) return true;
      recovering = false; restSpot = null; restSearchAt = 0; lastGain = now(); phase('CHECK', 'Đã hồi đầy HP ngay tại map farm; tiếp tục farm.'); return false;
    }
    if (!restSpot || !restSpotSafe(g, restSpot)) {
      if (p.state === 'sit') { press('q'); return true; }
      if (now() - restSearchAt < 1200) return true;
      restSearchAt = now(); restSpot = findRestSpot(g);
      if (!restSpot) { phase('HEAL_FIND_SPOT', 'Đang tìm vị trí trống, không có quái trong map để hồi HP.'); return true; }
      clearPath(); phase('HEAL_MOVE', 'Đang tới một vị trí trống khác trong map để hồi HP.');
    }
    if (!go(g, restSpot, 10, 'vị trí hồi HP an toàn')) return true;
    clearPath();
    phase('HEAL', 'Đang tọa thiền tại vị trí không có quái để hồi đầy HP trong map farm.');
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
      preferredZoneId,
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
      if (!snap || !g?.Gateway?.connected || !g?.Gateway?.ready || typeof g?.Pathfinder?.route !== 'function')
        return stop('Chưa đọc đủ nhân vật, hạn mức hoặc kết nối game.', 'ERROR');
      if (g.SceneWorld.autoDC || g.SceneWorld.diNV) return stop('Tắt auto Dược Công hoặc nhiệm vụ game trước khi farm.', 'ERROR');
      const candidates = A.stoneFarmCandidates(g);
      if (options.mapId && !candidates.some(m => m.id === options.mapId)) return stop('Bản đồ đã chọn không có quái phù hợp hoặc chưa có đường đi hợp lệ.', 'ERROR');
      if (!candidates.length) return stop('Chưa tìm được bãi có quái phù hợp và đường đi hợp lệ.', 'ERROR');
      controller.reset(); if (!controller.acquire('stone')) return stop('Không lấy được quyền điều khiển.', 'ERROR');
      preferredMapId = options.mapId || null;
      const requestedZone = options.zoneId == null || options.zoneId === 0 ? null : Number(options.zoneId);
      if (requestedZone != null && (!Number.isInteger(requestedZone) || requestedZone < 1 || requestedZone > 30)) return stop('Khu farm phải từ 1 đến 30.', 'ERROR');
      preferredZoneId = requestedZone;
      running = true; started = lastGain = now(); startBalance = lastBalance = snap.balance; lastSnapshot = snap; initialRealm = snap.realm;
      gained = spent = observedDeaths = deathsSinceMine = 0; minePending = null; mineSkippedUntil = new Map(); excludedMaps = new Set(); enemyStates = new Map(); recentRestKeys = [];
      farmMap = travel = move = null; targetId = restSpot = null; restSearchAt = reviveDelayUntil = 0; zoneMap = zoneStep = flightPending = null; farmZoneId = returnZoneId = null; zoneReturnPending = false; flightBlockedUntil = 0; ownsCombat = recovering = resumeCombatAfterRevive = false; downSince = disconnectedAt = 0;
      startedName = characterName; ownsCombat = !!g.SceneWorld.autoOn;
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
        if (w.map.data.id === 'mo_linh_thach' && deathsSinceMine > 0) {
          if (!autoOff(g) || !ensureGround(g)) return;
          if (mineOne(g)) return;
        }
        if (!preferFlight(g)) return;
        if (now() - lastGain > 300000 && observedDeaths >= 20) {
          if (preferredMapId) return stop('Bản đồ đã chọn không thấy tăng ví sau nhiều quái; kiểm tra lại bãi.', 'ERROR');
          excludedMaps.add(farmMap.id); farmMap = null; observedDeaths = 0; enemyStates.clear(); lastGain = now();
          if (!autoOff(g)) return;
          phase('SELECT_MAP', 'Chưa thấy ví tăng sau nhiều quái; thử bãi phù hợp khác.'); return;
        }
        // The game auto combat acquires and attacks targets itself. Keep it on
        // between fights; turn it off only for navigation, interactions, and recovery.
        if (!w.autoOn) {
          if (press('t')) { ownsCombat = true; phase('COMBAT', '?? b?t Auto chi?n ??u; game t? t?m v? ??nh qu?i.'); }
          return;
        }
        if (!ownsCombat) return stop('Auto chi?n ??u ???c b?t ngo?i phi?n farm.', 'ERROR');
        phase('COMBAT', 'Auto chi?n ??u ?ang t? t?m v? ??nh qu?i.');
      } catch (error) { stop(error?.message || String(error), 'ERROR'); }
    }
  };
};

if (window.TuTienStoneFarm) return;
const access = A.createGameAccess(window);
const entries = [];
const logger = { add(event, data = {}) { entries.push({ at: new Date().toISOString(), event, data }); if (entries.length > 400) entries.shift(); } };
const controller = A.createController();
const navigation = A.createNavigation({ getGame: () => access.get(), logger, controller });
const farm = A.createStoneFarm({ getGame: () => access.get(), doc: document, host: window, controller, navigation, logger });
const resumeKey = 'tutien_combat_pipeline_resume';
const mapKey = 'tutien_combat_pipeline_map', zoneKey = 'tutien_combat_pipeline_zone';
let startedName = '', resumePending = false, resumeAt = Date.now();
try { resumePending = sessionStorage.getItem(resumeKey) === '1'; } catch (_) {}
function stop(reason = 'Đã dừng Auto farm.', result = 'STOPPED', preserve = false) {
  resumePending = false;
  farm.stop(reason, result, preserve);
  if (!preserve) { try { sessionStorage.removeItem(resumeKey); sessionStorage.removeItem(mapKey); sessionStorage.removeItem(zoneKey); } catch (_) {} }
  return false;
}
function status() {
  const f = farm.status();
  return { ...f, phase: f.state, preferredMapId: f.preferredMapId || null, preferredZoneId: f.preferredZoneId || null,
    skippedTasks: [], books: null, quest: null };
}
function availableMaps() { try { return A.stoneFarmCandidates(access.get()).map(({id,name}) => ({id,name})); } catch (_) { return []; } }
function start(options = {}) {
  if (farm.status().running) return false;
  const g = access.get(), name = (document.getElementById('hud-name')?.textContent || '').trim();
  if (!g?.SceneWorld?.player || !g?.Gateway?.ready || !name) return stop('Chưa đọc được nhân vật hoặc kết nối game.', 'ERROR');
  const mapId = options.mapId || '', zoneId = options.zoneId == null ? 0 : Number(options.zoneId);
  if (!farm.start({ otherScriptsStopped: true, mapId, zoneId })) return false;
  startedName = name;
  try { sessionStorage.setItem(resumeKey, '1'); sessionStorage.setItem(mapKey, mapId); sessionStorage.setItem(zoneKey, String(zoneId || 0)); } catch (_) {}
  return true;
}
function tick() {
  if (resumePending) {
    if (Date.now() - resumeAt >= 120000) { resumePending = false; stop('Không thể tiếp tục Auto farm sau khi tải lại trang quá 120 giây.', 'ERROR'); return; }
    const game = access.get();
    const character = (document.getElementById('hud-name')?.textContent || '').trim();
    if (!game?.SceneWorld?.player || !game?.Gateway?.connected || !game?.Gateway?.ready || !character) return;
    let mapId = '', zoneId = 0;
    try { mapId = sessionStorage.getItem(mapKey) || ''; zoneId = Number(sessionStorage.getItem(zoneKey)) || 0; } catch (_) {}
    resumePending = false;
    start({ mapId, zoneId });
  }
  if (!farm.status().running) return;
  const name = (document.getElementById('hud-name')?.textContent || '').trim();
  if (name && startedName && name !== startedName) { stop('Nhân vật đã thay đổi.', 'ERROR'); return; }
  farm.tick();
  if (!farm.status().running) {
    try { sessionStorage.removeItem(resumeKey); sessionStorage.removeItem(mapKey); sessionStorage.removeItem(zoneKey); } catch (_) {}
  }
}
window.TuTienStoneFarm = Object.freeze({ version: '2.0.27', start, stop, status, maps: availableMaps,
  report: () => ({ schema: 'tutien2d-combat-pipeline-v1', version: '2.0.27', status: status(), access: access.diagnostics(), events: entries.slice() }) });
function manual(event) { if (farm.status().running && event.isTrusted) stop('Đã dừng vì bạn thao tác trong game.'); }
document.addEventListener('pointerdown', manual, true);
window.addEventListener('keydown', event => { if (/^(Escape|Key[WASDEQTF]|Arrow(Up|Down|Left|Right))$/.test(event.code)) manual(event); }, true);
window.addEventListener('pagehide', () => { if (farm.status().running) stop('Trang tải lại; chờ tiếp tục.', 'STOPPED', true); });
setInterval(tick, 250);

})();
