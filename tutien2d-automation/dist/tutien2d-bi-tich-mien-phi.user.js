// ==UserScript==
// @name         TuTien2D - Rút bí tịch miễn phí
// @namespace    local.tutien2d.free-books
// @version      1.0.3
// @description  Kiểm tra và tự rút các lượt bí tịch miễn phí hằng ngày.
// @match        https://tutien2d.com/*
// @match        https://www.tutien2d.com/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @noframes
// ==/UserScript==

(() => {
'use strict';
const A = {};
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



const access = A.createGameAccess(window);
const events = [];
const logger = { add(event, data = {}) { events.push({ at: new Date().toISOString(), event, data }); if (events.length > 100) events.shift(); } };
const controller = A.createController();
const navigation = A.createNavigation({ getGame: () => access.get(), logger, controller });
const pools = [{ id: 'so_cap', label: 'Tàng Kinh Sơ Cấp', tab: 'Sơ Cấp' },
  { id: 'bi_dong', label: 'Tàng Kinh Bị Động', tab: 'Bị Động' }];
let ui = null, running = false, state = 'IDLE', message = 'Chờ vào nhân vật.', started = 0, last = 0, pending = null;
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
function mount() {
  const host = document.createElement('div'); host.id = 'tt-free-books';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>:host{position:fixed;top:120px;left:12px;z-index:2147483647;color-scheme:dark}section{box-sizing:border-box;width:285px;max-width:calc(100vw - 24px);background:#1d2b23;color:#effaf1;border:1px solid #809b85;border-radius:8px;padding:10px;font:13px/1.45 system-ui}header{display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:move;touch-action:none}header button{margin:0;padding:1px 7px}button{margin:4px 5px 0 0;padding:6px;border:1px solid #8ba391;border-radius:4px;background:#315542;color:inherit;cursor:pointer}button:disabled{opacity:.5}p{overflow-wrap:anywhere;margin:7px 0}</style><section><header id="drag" title="Kéo để di chuyển bảng"><strong>TuTien2D · Bí tịch miễn phí</strong><button id="fold" type="button" aria-label="Thu gọn bảng">−</button></header><div id="panel-body"><p id="status" role="status">Đang chờ nhân vật…</p><button id="start">Tự rút lượt miễn phí</button><button id="stop" disabled>Dừng</button><button id="log">Tải log JSON</button></div></section>`;
  document.documentElement.appendChild(host);
  const savedPositionKey = 'tutien2d_free_books_panel_position';
  const position = (left, top) => {
    const rect = host.getBoundingClientRect();
    host.style.left = Math.max(0, Math.min(left, Math.max(0, window.innerWidth - rect.width))) + 'px';
    host.style.top = Math.max(0, Math.min(top, Math.max(0, window.innerHeight - rect.height))) + 'px';
    host.style.right = 'auto';
  };
  try {
    const saved = JSON.parse(localStorage.getItem(savedPositionKey) || 'null');
    if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) position(saved.left, saved.top);
  } catch (_) { /* Keep the default position if storage is unavailable. */ }
  const drag = root.getElementById('drag'), fold = root.getElementById('fold'), body = root.getElementById('panel-body');
  let pointer = null;
  drag.addEventListener('pointerdown', event => {
    if (event.target === fold || event.button !== 0) return;
    const rect = host.getBoundingClientRect();
    pointer = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
    drag.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  drag.addEventListener('pointermove', event => {
    if (pointer?.id === event.pointerId) position(event.clientX - pointer.x, event.clientY - pointer.y);
  });
  const endDrag = event => {
    if (pointer?.id !== event.pointerId) return;
    pointer = null;
    try { localStorage.setItem(savedPositionKey, JSON.stringify({ left: parseFloat(host.style.left), top: parseFloat(host.style.top) })); } catch (_) {}
  };
  drag.addEventListener('pointerup', endDrag);
  drag.addEventListener('pointercancel', endDrag);
  fold.addEventListener('click', () => {
    body.hidden = !body.hidden;
    fold.textContent = body.hidden ? '+' : '−';
    fold.setAttribute('aria-label', body.hidden ? 'Mở bảng' : 'Thu gọn bảng');
  });
  ui = { host, status: root.getElementById('status'), start: root.getElementById('start'), stop: root.getElementById('stop') };
  ui.start.addEventListener('click', start);
  ui.stop.addEventListener('click', () => stop('Đã dừng theo yêu cầu.'));
  root.getElementById('log').addEventListener('click', () => {
    const data = JSON.stringify({ version: '1.0.3', state, message, access: access.diagnostics(), events }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'tu-tien-bi-tich.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.addEventListener('pointerdown', event => { if (running && event.isTrusted && !event.composedPath().includes(host)) stop('Đã dừng vì bạn thao tác trong game.'); }, true);
  window.addEventListener('keydown', event => { if (running && event.isTrusted && /^(Escape|Key[WASDEQTF]|Arrow(Up|Down|Left|Right))$/.test(event.code)) stop('Đã dừng vì bạn thao tác bàn phím.'); }, true);
}
if (document.documentElement) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
setInterval(() => {
  if (!running && ui && state === 'IDLE') {
    const g = access.get(); const signature = g?.SceneWorld?.player && g.SceneWorld.map?.data?.id ? 'ready' : 'waiting';
    if (signature !== lastVersion) { lastVersion = signature; ui.status.textContent = signature === 'ready' ? 'Đã kết nối nhân vật. Bấm nút để tự rút.' : 'Đang chờ nhân vật…'; }
  }
  tick();
}, 250);

})();
