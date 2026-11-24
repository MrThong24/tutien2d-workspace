// ==UserScript==
// @name         TuTien2D - Farm Linh Thach
// @namespace    local.tutien2d.stone-farm
// @version      1.0.0
// @description  Tu dong danh quai va nhat Linh Thach
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
  let move = null, targetId = null, ownsCombat = false, picked = null, failures = 0;
  let lastGain = 0, observedDeaths = 0, enemyStates = new Map(), excludedMaps = new Set();
  let recovering = false, healStarted = 0, lastHp = 0, hpProgress = 0, reviveAt = 0, downSince = 0, deathTimes = [];
  let disconnectedAt = 0, lastSnapshot = null, startedName = null, initialRealm = null;
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
      if (delta > 0) { gained += delta; lastGain = now(); failures = 0; log('STONE_WALLET_INCREASE', { amount: delta, balance: snap.balance }); }
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
  function stoneDrops(g) {
    const w = g.SceneWorld, p = w.player;
    if (typeof g.Loot?.canPick !== 'function' || !Number.isFinite(g.Loot?.PICK_R)) throw Error('Chưa đọc được quy tắc nhặt Linh Thạch.');
    return (w.drops || []).filter(d => {
      if (d.itemId !== 'linh_thach' || d.kind !== 'item' || !['ground', 'fall'].includes(d.state) || !d.lootId || !Number.isFinite(d.x)) return false;
      const y = d.state === 'fall' ? d.gy : d.y;
      if (!Number.isFinite(y)) return false;
      try { return g.Loot.canPick(d, g.Gateway?.selfId, d.age) === true; } catch (_) { return false; }
    }).sort((a, b) => targetDistance(p, { x: a.x, y: a.state === 'fall' ? a.gy : a.y }) - targetDistance(p, { x: b.x, y: b.state === 'fall' ? b.gy : b.y }));
  }
  function observeEnemies(w) {
    for (const e of w.enemies || []) {
      if (!e?.id || !A.stoneFarmEnemy(getGame(), e, w.map.data.id)) continue;
      const dead = !!e.dead || (Number.isFinite(e.hp) && e.hp <= 0);
      if (enemyStates.get(e.id) === false && dead) observedDeaths++;
      enemyStates.set(e.id, dead);
    }
  }
  function closeDialog(g) {
    if (g.HUD?.bagOpen) { press('b'); return true; }
    if (g.HUD?.dialogOpen) { const button = doc.querySelector('#dialog-close'); if (button && !button.disabled) button.click(); return true; }
    return false;
  }
  function prepareStanding(g) {
    if (closeDialog(g)) return false;
    const p = g.SceneWorld.player;
    if (p.flying) { if (!autoOff(g)) return false; press('f'); return false; }
    if (p.state === 'sit') { if (!autoOff(g)) return false; press('q'); return false; }
    if (p.sitLocked || ['pose', 'attack'].includes(p.state)) return false;
    return true;
  }
  function beginTravel(g, id, reason) {
    clearPath(); controller.release('stone');
    if (!navigation.start({ target: id, npcId: null, otherScriptsStopped: true })) {
      controller.acquire('stone'); throw Error(navigation.status().message || 'Không mở được tuyến tới ' + id + '.');
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
      if (old.reason === 'Đi tới bãi farm') { excludedMaps.add(old.id); farmMap = null; phase('SELECT_MAP', 'Không đi được bãi vừa chọn; đang tìm bãi khác.'); return true; }
      throw Error(result.message || 'Không tới được nơi hồi máu.');
    }
    phase('CHECK', old.reason === 'Đi tới bãi farm' ? 'Đã tới bãi; đang kiểm tra quái và đá.' : 'Đã tới nơi hồi phục.');
    return false;
  }
  function revive(g) {
    const p = g.SceneWorld.player;
    if (!p.downed && p.hp > 0) { if (downSince) { downSince = 0; reviveAt = 0; farmMap = null; enemyStates.clear(); phase('CHECK', 'Đã hồi sinh; tìm lại bãi farm.'); } return false; }
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
    if (!recovering) { recovering = true; healStarted = hpProgress = now(); lastHp = p.hp; picked = null; log('STONE_HEAL_BEGIN', { hp: p.hp, hpMax: p.hpMax }); }
    if (p.hp > lastHp) { lastHp = p.hp; hpProgress = now(); }
    if (now() - healStarted > 180000 || now() - hpProgress > 60000) throw Error('HP không hồi phục; dừng để kiểm tra nhân vật.');
    if (!autoOff(g)) { phase('HEAL', 'Đang dừng chiến đấu để hồi HP.'); return true; }
    if (closeDialog(g)) return true;
    if (p.flying) { press('f'); return true; }
    if (p.hp / p.hpMax >= .7) {
      if (p.state === 'sit') { press('q'); return true; }
      if (p.sitLocked) return true;
      recovering = false; healStarted = 0; lastGain = now(); phase('CHECK', 'Đã hồi HP; tiếp tục farm.'); return false;
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
    if (travel) { navigation.stop(detail); travel = null; }
    if (running && ownsCombat && g?.SceneWorld?.autoOn) { try { g.SceneWorld.player?.setPath?.([]); press('t', true); } catch (_) {} }
    if (running && lastSnapshot) lastSnapshot.stoppedAt = now();
    clearPath(); try { if (running) g?.Targeting?.clear?.(); } catch (_) {}
    controller.release('stone'); running = false; ownsCombat = false; picked = null; targetId = null;
    if (!preserve) { try { host.sessionStorage?.removeItem('tutien_stone_farm_resume'); } catch (_) {} }
    phase(next, detail); return false;
  }
  function status() {
    const elapsed = !started ? 0 : running ? Math.max(0, now() - started) : Math.max(0, (lastSnapshot?.stoppedAt || now()) - started);
    return { running, state, message, map: lastSnapshot?.mapName || null, targetMap: farmMap?.name || null,
      realm: lastSnapshot?.realm || initialRealm, hp: lastSnapshot?.hp ?? null, hpMax: lastSnapshot?.hpMax ?? null,
      balance: lastSnapshot?.balance ?? null, startBalance, gained, spent, perHour: elapsed >= 30000 ? Math.round(gained * 3600000 / elapsed) : null,
      elapsedMs: elapsed, day: lastSnapshot?.day || null, observedDeaths, pickupFailures: failures };
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
      if (!A.stoneFarmCandidates(g).length) return stop('Chưa tìm được bãi có quái phù hợp và đường đi hợp lệ.', 'ERROR');
      controller.reset(); if (!controller.acquire('stone')) return stop('Không lấy được quyền điều khiển.', 'ERROR');
      running = true; started = lastGain = now(); startBalance = lastBalance = snap.balance; lastSnapshot = snap; initialRealm = snap.realm;
      gained = spent = failures = observedDeaths = 0; excludedMaps = new Set(); enemyStates = new Map(); deathTimes = [];
      farmMap = travel = move = picked = null; ownsCombat = recovering = false; downSince = disconnectedAt = 0;
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
        observeEnemies(w);
        const drops = stoneDrops(g);
        if (picked && snap.balance > picked.balance) { log('STONE_PICKUP_CONFIRMED', { amount: snap.balance - picked.balance }); picked = null; failures = 0; }
        if (picked && now() - picked.at > 15000) {
          const stillThere = drops.some(d => d.lootId === picked.id);
          picked = null;
          if (++failures >= 3) throw Error('Không xác nhận được nhặt Linh Thạch sau 3 lần.');
          phase('PICKUP_RETRY', stillThere ? 'Chưa xác nhận nhặt đá; thử lại.' : 'Đá biến mất nhưng ví chưa tăng; kiểm tra lượt tiếp theo.');
        }
        if (drops.length && !picked) {
          if (typeof g.Inventory?.canFit === 'function' && !g.Inventory.canFit('linh_thach')) throw Error('Túi đầy; game không cho nhặt Linh Thạch.');
          const d = drops[0], point = { x: d.x, y: d.state === 'fall' ? d.gy : d.y };
          if (!autoOff(g)) return;
          phase('PICKUP', 'Đang tới nhặt Linh Thạch có thể nhặt.');
          if (go(g, point, Math.max(13, g.Loot.PICK_R - 8), 'đá')) { picked = { id: d.lootId, balance: snap.balance, at: now() }; phase('WAIT_PICKUP', 'Chờ game xác nhận nhặt đá.'); }
          return;
        }
        if (picked) { phase('WAIT_PICKUP', 'Chờ game xác nhận nhặt đá.'); return; }
        if (snap.day.earned >= snap.day.limit) return stop('Đã đạt hạn mức Linh Thạch hôm nay: ' + snap.day.earned + '/' + snap.day.limit + '.', 'DONE');
        if (!farmMap || farmMap.id !== w.map.data.id) {
          if (!farmMap) {
            const candidates = A.stoneFarmCandidates(g, excludedMaps);
            if (!candidates.length) return stop('Không tìm được bãi quái phù hợp, có đường đi và chưa bị loại.', 'ERROR');
            farmMap = candidates[0]; log('STONE_MAP_SELECTED', { id: farmMap.id, name: farmMap.name, types: farmMap.types });
          }
          if (farmMap.id !== w.map.data.id) { if (!autoOff(g) || !prepareStanding(g)) return; beginTravel(g, farmMap.id, 'Đi tới bãi farm'); return; }
        }
        if (now() - lastGain > 300000 && observedDeaths >= 20) {
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
        phase('COMBAT', 'Đang đánh ' + (target.def?.name || target.type) + ' và chờ Linh Thạch.');
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
const stoneFarm = A.createStoneFarm({ getGame: () => access.get(), doc: document, host: window, controller, navigation, logger });
let ui = null, disposed = false, resumeStarted = Date.now(), lastResumeAttempt = 0;
let resumePending = false;
try { resumePending = sessionStorage.getItem('tutien_stone_farm_resume') === '1'; } catch (_) {}
function render() {
  if (!ui) return;
  const s = stoneFarm.status();
  ui.status.textContent = s.state + ' · ' + s.message;
  ui.data.textContent = 'Ví: ' + (s.balance ?? '—') + ' · Tăng trong phiên: ' + s.gained + ' · Tốc độ: ' + (s.perHour == null ? 'chờ đo' : s.perHour + '/giờ') +
    ' · Hôm nay: ' + (s.day ? s.day.earned + '/' + s.day.limit : '—') + ' · Bãi: ' + (s.targetMap || s.map || '—');
  ui.start.disabled = s.running; ui.stop.disabled = !s.running;
}
function start() { resumePending = false; const ok = stoneFarm.start({ otherScriptsStopped: true }); render(); return ok; }
function stop(reason) { resumePending = false; const result = stoneFarm.stop(reason || 'Đã dừng theo yêu cầu.'); render(); return result; }
function report() { return { schema: 'tutien2d-stone-farm-v1', version: '1.0.0', exportedAt: new Date().toISOString(), farm: stoneFarm.status(), access: access.diagnostics(), events: entries.slice() }; }
const api = Object.freeze({ version: '1.0.0', status: () => stoneFarm.status(), start, stop, report });
window.TuTienStoneFarm = api;
function mount() {
  if (disposed || ui || !document.documentElement) return;
  const host = document.createElement('div'); host.id = 'tt-stone-farm';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>:host{position:fixed;right:12px;top:260px;z-index:2147483647;color-scheme:dark;font:12px/1.4 system-ui;color:#eef7ef}section{box-sizing:border-box;width:310px;max-width:calc(100vw - 24px);padding:10px;background:#1a2b22;border:1px solid #7d9c82;border-radius:7px;box-shadow:0 3px 12px #0008}header{display:flex;justify-content:space-between;align-items:center;gap:5px}p{margin:6px 0;overflow-wrap:anywhere}button{padding:6px 8px;margin:3px 3px 0 0;background:#315a40;color:#fff;border:1px solid #87a991;border-radius:4px;cursor:pointer}button:disabled{opacity:.45}#fold{margin:0;padding:2px 8px}</style><section><header><strong>TuTien2D · Farm Linh Thạch</strong><button id="fold" aria-label="Thu gọn">−</button></header><div id="body"><p id="status">Đang chờ game…</p><p id="data"></p><button id="start">Bắt đầu farm</button><button id="stop">Dừng</button><button id="log">Tải log JSON</button></div></section>`;
  document.documentElement.appendChild(host);
  ui = { host, status: root.getElementById('status'), data: root.getElementById('data'), start: root.getElementById('start'), stop: root.getElementById('stop') };
  ui.start.addEventListener('click', start); ui.stop.addEventListener('click', () => stop());
  root.getElementById('fold').addEventListener('click', () => { const body = root.getElementById('body'); body.hidden = !body.hidden; root.getElementById('fold').textContent = body.hidden ? '+' : '−'; });
  root.getElementById('log').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify(report(), null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'tutien-farm-linh-thach.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  render();
}
function manualKey(event) { if (event.isTrusted && stoneFarm.status().running && ['Escape','KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyT','KeyR','KeyQ','KeyE','Enter','Space','KeyB','KeyI','KeyF'].includes(event.code)) stop('Đã dừng vì bạn thao tác bàn phím.'); }
function manualPointer(event) { if (event.isTrusted && stoneFarm.status().running && !event.composedPath().includes(ui?.host)) stop('Đã dừng vì bạn thao tác trong game.'); }
function pageHide() { if (stoneFarm.status().running) stoneFarm.stop('Trang tải lại; chờ tiếp tục.', 'STOPPED', true); }
window.addEventListener('keydown', manualKey, true); document.addEventListener('pointerdown', manualPointer, true); window.addEventListener('pagehide', pageHide);
if (document.documentElement) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
const timer = setInterval(() => {
  if (disposed) return;
  if (resumePending && Date.now() - lastResumeAttempt >= 2000) {
    lastResumeAttempt = Date.now();
    if (Date.now() - resumeStarted > 60000) { resumePending = false; stop('Không thể tiếp tục farm sau 60 giây; hãy kiểm tra game.'); }
    else if (access.get()?.SceneWorld?.player && access.get()?.Gateway?.ready && stoneFarm.start({ otherScriptsStopped: true })) resumePending = false;
  }
  stoneFarm.tick(); render();
}, 250);

})();
