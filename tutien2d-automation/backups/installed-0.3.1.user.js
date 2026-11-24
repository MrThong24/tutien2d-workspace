// ==UserScript==
// @name         TuTien2D Diagnostic + Navigation
// @namespace    local.tutien2d.automation
// @version      0.3.1
// @description  Khao sat chi doc; di den Dai Phu khi bam Start.
// @match        https://tutien2d.com/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// ==/UserScript==

(function () {
"use strict";
const A = {};

// src/core/game-access.js
// Capture the namespace before main.js deletes window.PNTT. No game methods run here.
A.createGameAccess = function (host) {
  let retained = null;
  const keep = value => {
    if (value && typeof value === 'object') retained = value;
    return value;
  };
  try {
    keep(host.gameDebug);
    keep(host.PNTT);
    const previous = Object.getOwnPropertyDescriptor(host, 'PNTT');
    if (!previous || previous.configurable) {
      let current = host.PNTT;
      Object.defineProperty(host, 'PNTT', {
        configurable: true,
        enumerable: previous?.enumerable ?? true,
        get() { return previous?.get ? keep(previous.get.call(host)) : current; },
        set(value) {
          keep(value);
          if (previous?.set) previous.set.call(host, value);
          current = value;
        }
      });
    }
  } catch (_) { /* A pre-existing capture can still supply gameDebug. */ }
  return {
    get() {
      try { keep(host.PNTT); keep(host.gameDebug); } catch (_) {}
      return retained;
    }
  };
};


// src/core/logger.js
A.createLogger = function (limit = 300) {
  const records = [];
  return {
    add(event, data = {}) {
      records.push({ time: new Date().toISOString(), event, data });
      if (records.length > limit) records.splice(0, records.length - limit);
    },
    records() { return JSON.parse(JSON.stringify(records)); },
    size() { return records.length; }
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


// src/navigation/flight.js
// Toggle through the normal F input; all eligibility checks below are read-only.
A.createFlight = function ({ getGame, doc, host, logger, now = Date.now }) {
  let pending = null, blockedUntil = 0;
  function toggle(desired) {
    pending = { desired, since: now() };
    for (const type of ['keydown', 'keyup']) doc.dispatchEvent(new host.KeyboardEvent(type, {
      key: 'f', code: 'KeyF', bubbles: true
    }));
    logger.add('FLIGHT_REQUEST', { flying: desired });
  }
  function update(target, allow = true) {
    const g = getGame(), w = g?.SceneWorld, p = w?.player;
    if (!p) return { waiting: false, changed: false };
    if (pending) {
      if (!!p.flying === pending.desired) {
        logger.add('FLIGHT_CONFIRMED', { flying: !!p.flying });
        pending = null; return { waiting: false, changed: true };
      }
      if (now() - pending.since < 2500) return { waiting: true, changed: false };
      const wanted = pending.desired; pending = null; blockedUntil = now() + 60000;
      logger.add('FLIGHT_DENIED', { flying: wanted });
      if (!wanted && p.flying) throw Error('Chưa hạ được phi hành; dừng trước khi tương tác.');
      return { waiting: false, changed: false };
    }
    const distance = target ? Math.hypot(p.x - target.x, p.y - target.y) : 0;
    const restricted = !allow || p.tieuXa > 0 || g.Quest?.seedTaskInfo?.()?.kind === 'escort';
    const noFly = typeof g.Player?.inNoFlyZone === 'function' && g.Player.inNoFlyZone(p, w.map);
    if (p.flying && (restricted || noFly || distance < 100)) {
      p.setPath?.([]); toggle(false); return { waiting: true, changed: false };
    }
    if (!p.flying && !restricted && !noFly && distance >= 180 && now() >= blockedUntil &&
        typeof g.Player?.canFly === 'function' && g.Player.canFly(p) &&
        !g.HUD?.dialogOpen && !g.HUD?.bagOpen && !w.menuOpen && !w.transitioning &&
        !(g.HacThi?.camBay && g.HacThi.camBay(g, w.map.data.id))) {
      p.setPath?.([]); toggle(true); return { waiting: true, changed: false };
    }
    return { waiting: false, changed: false };
  }
  return {
    update,
    reset() { pending = null; blockedUntil = 0; },
    status() { return { flying: !!getGame()?.SceneWorld?.player?.flying, pending: pending?.desired ?? null }; },
    ground() { blockedUntil = now() + 60000; return update(null, false); },
    pathAllowed(g, path) {
      const p = g.SceneWorld.player, map = g.SceneWorld.map;
      if (!p.flying || !g.Player?.flyOverTerrain?.()) return true;
      if (typeof map.rectFlyBlocked !== 'function') return false;
      const cfg = g.CONFIG.PLAYER;
      let last = p;
      for (const end of path) {
        const steps = Math.max(1, Math.ceil(Math.hypot(end.x - last.x, end.y - last.y) / 4));
        for (let i = 0; i <= steps; i++) {
          const x = last.x + (end.x - last.x) * i / steps, y = last.y + (end.y - last.y) * i / steps;
          if (map.rectFlyBlocked(x - cfg.HITBOX_W / 2, y - cfg.HITBOX_H, x + cfg.HITBOX_W / 2, y)) return false;
        }
        last = end;
      }
      return true;
    }
  };
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


// src/core/state-reader.js
A.pick = function (obj, keys) {
  const result = {};
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string') result[key] = value.slice(0, 180);
    else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || value === null) result[key] = value;
  }
  return result;
};
A.readState = function (game, doc) {
  const w = game?.SceneWorld, map = w?.map, q = game?.Quest;
  const list = (items, keys, max = 200) => Array.isArray(items) ? items.slice(0, max).map(p => A.pick(p, keys)) : [];
  const text = selector => (doc?.querySelector(selector)?.textContent || '').trim().slice(0, 300);
  const dialog = doc?.querySelector('#dialog');
  const dialogOpen = !!game?.HUD?.dialogOpen;
  return {
    available: !!game, ready: !!(w?.player && map?.data?.id),
    map: A.pick(map?.data, ['id', 'name', 'width', 'height']),
    tile: game?.CONFIG?.TILE ?? null,
    player: A.pick(w?.player, ['x', 'y', 'state', 'hp', 'hpMax', 'downed', 'flying', 'sitLocked', 'realmId', 'realm', 'exp', 'expMax', 'meditateBonusExp']),
    controls: { autoOn: w?.autoOn === true, autoDC: !!w?.autoDC, diNV: !!w?.diNV, transitioning: !!w?.transitioning,
      chopping: !!w?.chopping, fishing: !!w?.fishing, brewing: !!w?.brewing,
      brewingState: A.pick(w?.brewing, ['t', 'make']) },
    gardenObjects: map?.data?.id === 'vuon_ca_nhan' ? list([...(map.props || []), ...(map.flatProps || [])], ['id', 'type', 'x', 'y', 'r']) : [],
    materialDrops: list(w?.drops?.filter(d => d.materialId), ['task', 'materialId', 'state', 'x', 'y', 'gy']),
    pickupRadius: Number.isFinite(game?.Loot?.PICK_R) ? game.Loot.PICK_R : null,
    caption: text('#ritual-caption'),
    modules: ['SceneWorld', 'Pathfinder', 'MapData', 'Quest', 'Farm', 'Targeting'].filter(k => !!game?.[k]),
    portals: list(map?.portals, ['tx', 'ty', 'toMap', 'byHand', 'cooldownSec']),
    npc: list(map?.props?.filter(p => p.type === 'npc'), ['id', 'name', 'tx', 'ty', 'x', 'y', 'r', 'hidden']),
    enemies: list(w?.enemies, ['id', 'dead', 'hp', 'x', 'y']),
    quest: { stage: q?.stage ?? null, seed: A.pick(q?.seedQuest, ['active', 'task', 'round']),
      builtInAuto: typeof w?.autoDCStart === 'function' && typeof q?.autoSeedStep === 'function' },
    dialog: { open: dialogOpen, present: !!dialog, title: dialogOpen ? text('#dialog-title') : '',
      buttons: dialogOpen ? Array.from(doc?.querySelectorAll('#dialog button') || []).slice(0, 30).map(b => ({
        id: b.id || '', label: (b.textContent || '').trim().slice(0, 180), disabled: !!b.disabled,
        visible: !!b.getClientRects().length
      })) : [] }
  };
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
  return { available: true, tasks, active: info ? { id: info.id, name: info.shortName || info.name,
    progress: q.seedQuestProgress(), need: info.need ?? null, complete: q.seedQuestComplete(), round: q.seedQuest.round } : null };
};


// src/quests/quest-runner.js
// Uses normal dialog buttons and interaction keys. Never invokes Quest mutation APIs.
A.createQuestRunner = function ({ getGame, doc, host, controller, logger, flight = null, now = Date.now }) {
  let running = false, state = 'IDLE', message = '', started = 0, taskStarted = 0;
  let chosen = null, moving = null, lastAction = 0, lastProgress = 0, signature = '', waiting = null;
  let tracked = null, completed = 0;
  let acceptanceArmed = null, maxCompletions = Infinity, taskIds = null, ownedActivity = false;
  function phase(next, detail) {
    if (state !== next || message !== detail) logger.add('QUEST_STATE', { from: state, to: next, detail });
    state = next; message = detail;
  }
  function clearMovement() {
    if (moving) getGame()?.SceneWorld?.player?.setPath?.([]);
    moving = null;
  }
  function stop(detail = 'Đã dừng Auto Dược Công.', next = 'STOPPED') {
    const w = getGame()?.SceneWorld;
    if (ownedActivity && (w?.fishing || w?.chopping)) {
      doc.dispatchEvent(new host.KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true }));
      host.setTimeout(() => doc.dispatchEvent(new host.KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true })), 80);
    }
    ownedActivity = false;
    clearMovement(); running = false; waiting = null;
    controller.release('quest'); phase(next, detail);
  }
  function press(key) {
    for (const type of ['keydown', 'keyup']) doc.dispatchEvent(new host.KeyboardEvent(type, {
      key, code: 'Key' + key.toUpperCase(), bubbles: true
    }));
    lastAction = now();
  }
  function visible(el) { return !!el && !!el.getClientRects().length && !el.disabled; }
  function click(prefix, title = null) {
    if (title && doc.querySelector('#dialog-title')?.textContent.trim() !== title) return false;
    const matches = Array.from(doc.querySelectorAll('#dialog button')).filter(b => visible(b) &&
      b.textContent.trim().startsWith(prefix));
    if (matches.length !== 1) return false;
    matches[0].click(); lastAction = now();
    logger.add('QUEST_CLICK', { label: prefix }); return true;
  }
  function closeDialog(g) {
    if (!g.HUD?.dialogOpen) return false;
    const b = doc.querySelector('#dialog-close');
    if (b && !b.disabled) { b.click(); lastAction = now(); return true; }
    return false;
  }
  function move(g, target, tolerance = 30, exact = null, expectedMap = null) {
    const w = g.SceneWorld, p = w.player, id = w.map.data.id;
    if (flight) {
      const mode = flight.update(target);
      if (mode.changed) clearMovement();
      if (mode.waiting) return false;
    }
    if (moving && moving.map !== id) {
      if (moving.expected !== id) throw Error('Chuyển map ngoài tuyến Auto Quest.');
      moving = null;
    }
    // The player consumes a waypoint a few pixels before its center. Respect that
    // arrival margin; interact() still verifies the game's actual interaction radius.
    if (Math.hypot(p.x - target.x, p.y - target.y) <= tolerance + (exact ? 0 : 3)) {
      clearMovement(); return true;
    }
    const key = [id, target.x, target.y, expectedMap].join(':');
    if (!moving || moving.key !== key) {
      clearMovement(); moving = { key, map: id, expected: expectedMap, started: now(), progress: now(),
        x: p.x, y: p.y, attempts: 0, issued: false };
    }
    if (now() - moving.started > 65000) throw Error('Hết thời gian đi tới mục tiêu nhiệm vụ.');
    if (Math.hypot(p.x - moving.x, p.y - moving.y) >= 3) {
      moving.x = p.x; moving.y = p.y; moving.progress = now();
    }
    if (!moving.issued || now() - moving.progress > 5000) {
      if (++moving.attempts > 3) throw Error('Kẹt đường nhiệm vụ sau 3 lần thử.');
      const tile = g.CONFIG.TILE, candidates = exact ? [target] : [];
      if (!exact) {
        const tx = Math.floor(target.x / tile), ty = Math.floor(target.y / tile);
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const point = A.tileCenter(g, tx + dx, ty + dy);
          if (Math.hypot(point.x - target.x, point.y - target.y) <= tolerance) candidates.push(point);
        }
        candidates.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
      }
      let path = null;
      for (const c of candidates) {
        path = A.makePath(g, c, exact || { tx: Math.floor(c.x / tile), ty: Math.floor(c.y / tile) });
        if (path) break;
      }
      if (path && flight && !flight.pathAllowed(g, path)) { flight.ground(); return false; }
      if (path) { p.setPath([]); p.setPath(path); moving.issued = true; }
      else moving.issued = true;
      moving.progress = now();
      logger.add(path ? 'QUEST_PATH' : 'QUEST_PATH_FAILED', { map: id,
        target: { id: target.obj?.id || null, x: target.x, y: target.y }, attempt: moving.attempts });
    }
    return false;
  }
  function travel(g, destination) {
    const w = g.SceneWorld, id = w.map.data.id;
    if (waiting?.kind === 'portal' && id !== waiting.map) {
      if (id !== waiting.expected) throw Error('Cổng đưa tới map ngoài tuyến nhiệm vụ.');
      logger.add('QUEST_MAP_ARRIVED', { from: waiting.map, to: id });
      waiting = null; moving = null;
    }
    if (moving && moving.map !== id) {
      if (moving.expected !== id) throw Error('Chuyển map ngoài tuyến Auto Quest.');
      logger.add('QUEST_MAP_ARRIVED', { from: moving.map, to: id }); moving = null;
    }
    if (id === destination) return true;
    const route = A.mapRoute(g.MapData, id, destination);
    if (!route?.length) throw Error('Không có tuyến tới ' + destination);
    const portals = w.map.portals.filter(p => A.automaticPortal(p) && p.toMap === route[0].to);
    const portal = portals.find(p => A.makePath(g, A.tileCenter(g, p.tx, p.ty), p));
    if (!portal) throw Error('Không có đường hợp lệ tới cổng ' + route[0].to);
    // Keep waiting on the portal until the engine actually changes map.
    const target = A.tileCenter(g, portal.tx, portal.ty);
    if (move(g, target, 2, portal, route[0].to)) {
      if (!waiting) waiting = { kind: 'portal', since: now(), map: id, expected: route[0].to };
      if (now() - waiting.since > 10000) throw Error('Cổng chưa chuyển map sau 10 giây.');
    } else waiting = null;
    phase('TRAVEL', id + ' → ' + route[0].to); return false;
  }
  function object(g, ids) {
    const m = g.SceneWorld.map;
    for (const list of [m.props, m.flatProps, m.interactables]) for (const obj of list || []) {
      if (ids.includes(obj.id) && !obj.hidden && !obj.off && Number.isFinite(obj.x) && Number.isFinite(obj.y)) {
        return { obj, x: obj.x, y: obj.y - ((m.interactables || []).includes(obj) ? 0 : g.CONFIG.TILE / 2), r: obj.r || 40 };
      }
    }
    return null;
  }
  function interact(g, target) {
    if (!move(g, target, Math.min(36, target.r - 8))) return false;
    const t = g.Targeting;
    if (typeof t?.cycle !== 'function' || typeof t?.current !== 'function') throw Error('Thiếu bộ chọn mục tiêu đã xác minh.');
    for (let i = 0; i < (t.list?.length || 0) * 2 + 4; i++) {
      const current = t.current();
      if (current?.obj === target.obj && !['enemy', 'player', 'duel', 'dosat'].includes(current.kind)) {
        if (current.dist > current.r) return false;
        ownedActivity = true; press('e'); return true;
      }
      t.cycle();
    }
    return false;
  }
  function npc(g, map, id) {
    if (!travel(g, map)) return false;
    const target = object(g, [id]);
    if (!target) throw Error('Không tìm thấy NPC ' + id);
    return interact(g, target);
  }
  function finishRecord(g, catalog) {
    if (!tracked || catalog.active) return;
    const q = g.Quest;
    if (q.seedQuest.round > tracked.round && tracked.turnIn) {
      completed++; logger.add('QUEST_COMPLETED', { id: tracked.id, round: q.seedQuest.round,
        duocCongDelta: (g.Progress?.duocCong ?? 0) - tracked.duocCong });
      tracked = null; chosen = null; signature = ''; taskStarted = now();
    } else throw Error('Nhiệm vụ biến mất khi chưa xác minh giao việc; dừng để kiểm tra.');
  }
  return {
    status: () => ({ running, state, message, completed, task: chosen?.id || tracked?.id || null }),
    start({ otherScriptsStopped = false, maxRuns = Infinity, only = null } = {}) {
      if (running) return false;
      const g = getGame(), w = g?.SceneWorld;
      if (!otherScriptsStopped || !w?.player || !A.readDuocCong(g).available || w.autoOn || w.autoDC || w.diNV ||
          (!flight && w.player.flying) || w.player.downed || w.player.state === 'sit' || w.fishing || w.chopping) {
        phase('ERROR', 'Cần tắt Auto khác, đứng dậy và có dữ liệu nhiệm vụ trước khi chạy.'); return false;
      }
      controller.reset(); if (!controller.acquire('quest')) { phase('ERROR', 'Module khác đang giữ quyền điều khiển.'); return false; }
      running = true; started = taskStarted = lastProgress = now(); chosen = tracked = null; completed = 0;
      flight?.reset();
      acceptanceArmed = null; maxCompletions = Number.isFinite(maxRuns) ? Math.max(1, maxRuns) : Infinity;
      taskIds = Array.isArray(only) ? only : null; ownedActivity = false;
      waiting = null; signature = ''; phase('SELECT_TASK', 'Đang đọc toàn bộ việc Dược Công.'); return true;
    },
    stop,
    tick() {
      if (!running) return;
      try {
        const g = getGame(), w = g?.SceneWorld, p = w?.player;
        if (!controller.owns('quest')) return stop('Đã mất quyền điều khiển.');
        if (!p || p.downed || p.hp < p.hpMax * .35) return stop('HP thấp hoặc nhân vật không sẵn sàng.', 'ERROR');
        if (w.autoOn || w.autoDC || w.diNV || (!flight && p.flying)) return stop('Có điều khiển khác đang hoạt động.', 'ERROR');
        if (now() - started > 3600000 || now() - taskStarted > 600000) return stop('Đạt giới hạn thời gian Auto Quest.', 'ERROR');
        if (w.transitioning || now() - lastAction < 900) return;
        const catalog = A.readDuocCong(g), active = catalog.active;
        finishRecord(g, catalog);
        if (completed >= maxCompletions) return stop('Đã hoàn thành số lượt yêu cầu.', 'DONE');
        const sig = JSON.stringify([active?.id, active?.progress, active?.round, w.map.data.id]);
        if (sig !== signature) { signature = sig; lastProgress = now(); }
        if (now() - lastProgress > 180000) return stop('Không có tiến độ nhiệm vụ sau 3 phút.', 'ERROR');
        if (!active) {
          chosen ||= catalog.tasks.find(t => t.status === 'READY' && (!taskIds || taskIds.includes(t.id)));
          if (!chosen) {
            const pending = catalog.tasks.filter(t => t.status === 'NEEDS_ADAPTER');
            return stop(pending.length ? 'Còn hoạt động cần bộ thực thi: ' + pending.map(t => t.name).join(', ') : 'Đã hết lượt việc có thể thực hiện.', pending.length ? 'PENDING_ACTIVITIES' : 'DONE');
          }
          phase('ACCEPT_QUEST', 'Nhận: ' + chosen.name);
          if (!g.HUD.dialogOpen) return void npc(g, 'duoc_vien', 'dai_phu');
          if (acceptanceArmed === chosen.id && click('Nhận Việc Này', 'Đại Phu')) { acceptanceArmed = null; return; }
          if (click(chosen.name, 'Đại Phu')) { acceptanceArmed = chosen.id; return; }
          if (click('Nhận Việc Dược Công', 'Đại Phu')) return;
          acceptanceArmed = null; return void closeDialog(g);
        }
        if (!tracked) {
          tracked = { id: active.id, round: active.round, duocCong: g.Progress?.duocCong ?? 0, turnIn: false };
          chosen = catalog.tasks.find(t => t.id === active.id); taskStarted = now();
          logger.add('QUEST_ACCEPTED_OBSERVED', { id: active.id, round: active.round });
        }
        if (active.id !== tracked.id) throw Error('Nhiệm vụ bị thay đổi ngoài bộ điều phối.');
        if (chosen?.status === 'NEEDS_ADAPTER' || chosen?.locked) return stop('Đang giữ việc chưa được hỗ trợ: ' + active.name, 'PENDING_ACTIVITIES');
        if (g.HUD.dialogOpen) {
          const labels = active.complete ? ['Giao Ba Cá', 'Giao Nguyên Liệu'] : active.id === 'ho_tong_chau' ? ['Bẩm Thầy Ông Nội'] : [];
          for (const label of labels) if (click(label, active.id === 'ho_tong_chau' ? 'Thầy Ông Nội' : 'Đại Phu')) { tracked.turnIn = true; return; }
          if (active.id === 'cau_ca' && click('Thả câu')) return;
          return void closeDialog(g);
        }
        if (active.complete) {
          if (!travel(g, 'duoc_vien')) return;
          phase('TURN_IN', 'Đã đủ nguyên liệu, về Đại Phu.');
          return void npc(g, 'duoc_vien', 'dai_phu');
        }
        if (active.id === 'ho_tong_chau') {
          if (!travel(g, 'tan_vien')) return;
          phase('EXECUTE_TASK', 'Dẫn người về Thầy Ông Nội.');
          return void npc(g, 'tan_vien', 'su_phu');
        }
        if (w.fishing) return;
        const step = g.Quest.autoSeedStep(); // Read-only planning function verified in downloaded source.
        if (!step.place || !['hai', 'chat', 'cau'].includes(step.act)) throw Error('Bước nhiệm vụ chưa có bộ xử lý đã xác minh.');
        if (!travel(g, step.place.mapId)) return;
        phase('EXECUTE_TASK', active.name + ' · ' + active.progress + '/' + (active.need ?? '?'));
        if (step.act === 'chat') {
          const drops = (w.drops || []).filter(d => d.materialId && d.state !== 'fly' &&
            (!d.task || d.task === active.id) && Number.isFinite(d.x) &&
            Number.isFinite(d.state === 'fall' ? d.gy : d.y));
          drops.sort((a, b) => Math.hypot(a.x - p.x, (a.state === 'fall' ? a.gy : a.y) - p.y) -
            Math.hypot(b.x - p.x, (b.state === 'fall' ? b.gy : b.y) - p.y));
          if (drops.length) {
            const radius = g.Loot?.PICK_R;
            if (!Number.isFinite(radius) || radius <= 12) throw Error('Chưa xác minh được bán kính nhặt nguyên liệu.');
            const drop = drops[0];
            // Material coordinates are not tile centers. Use the engine's pickup
            // radius with the same 12px safety margin as its native auto worker.
            return void move(g, { x: drop.x, y: drop.state === 'fall' ? drop.gy : drop.y }, radius - 12);
          }
        }
        if (w.chopping) return;
        const target = object(g, step.place.ids);
        if (target) interact(g, target);
      } catch (error) { stop(error.message, 'ERROR'); }
    }
  };
};


// src/farm/garden-reader.js
A.readGarden = function (g) {
  const farm = g?.Farm, inv = g?.Inventory, q = g?.Quest;
  if (!farm || typeof inv?.count !== 'function') return null;
  const count = id => inv.count(id);
  const plots = Array.from({ length: farm.PLOT_COUNT || 10 }, (_, i) => {
    const id = 'plot_' + (i + 1), plot = farm.plot(id);
    return { id, seed: plot?.seed || null, ready: farm.ready(id), dry: farm.canWater(id),
      remaining: plot ? farm.remain(id) : 0, crop: plot ? farm.seedDef(plot.seed)?.crop : null };
  });
  const rule = g.Breakthrough?.ruleOf?.(g.SceneWorld?.player) || {};
  const recipe = q?.brewList?.().find(r => r.id === rule.item);
  const check = g.Breakthrough?.check?.(g.SceneWorld?.player);
  return { plots, water: farm.hasWaterAccess(), duocCong: g.Progress?.duocCong || 0,
    breakthrough: check ? { ready: !!check.ready, blocked: check.blocked || null, next: check.next?.id || null,
      conditions: check.lines.map(line => ({ label: line.label, current: line.current, target: line.target, done: line.done })) } : null,
    seeds: farm.seedsInBag().map(row => ({ id: row.def.seed, crop: row.def.crop, qty: row.qty })),
    goal: recipe ? { id: recipe.id, name: recipe.name, need: rule.qty || 1, have: count(recipe.id),
      materials: recipe.recipe.map(m => ({ id: m.id, qty: m.qty, have: count(m.id) })) } : null };
};


// src/farm/ascension.js
// Conditions come from the game's read-only checker. Payment and ascension use
// only its normal stone dialog, and success requires a real realm change.
A.createAscension = function ({ getGame, doc, logger, now = Date.now }) {
  let pending = null, blockedRealm = null;
  return {
    active: () => !!pending,
    status: () => pending ? { state: 'WAIT_CONFIRMATION', from: pending.from, to: pending.to } : { state: 'CHECK_CONDITIONS' },
    reset() { pending = null; blockedRealm = null; },
    tick(interactWithStone) {
      const g = getGame(), w = g?.SceneWorld, p = w?.player;
      if (!p || typeof g.Breakthrough?.check !== 'function') return false;
      if (pending) {
        if (p.realmId !== pending.from) {
          if (p.realmId !== pending.to) throw Error('Cảnh giới thay đổi ngoài bước đột phá dự kiến.');
          logger.add('ASCENSION_CONFIRMED', { from: pending.from, to: p.realmId });
          pending = null; return false;
        }
        if (now() - pending.at > 120000) throw Error('Chưa xác nhận đột phá sau 2 phút; dừng để tránh dùng đan lặp.');
        return true;
      }
      const check = g.Breakthrough.check(p);
      if (!check.ready || check.blocked || !check.next) return false;
      // Foundation uses its own encounter rather than the ordinary ascension ritual.
      if (p.realmId === 'luyen_khi_13') {
        if (blockedRealm !== p.realmId) logger.add('ASCENSION_SPECIAL_REQUIRED', { realm: p.realmId, next: check.next.id });
        blockedRealm = p.realmId; return false;
      }
      if (g.HUD?.dialogOpen) {
        if (doc.querySelector('#dialog-title')?.textContent.trim() !== 'Đột Phá Cảnh Giới') return false;
        const button = doc.querySelector('#dialog-action');
        if (!button || button.disabled || !button.getClientRects().length || button.textContent.trim() !== 'Bắt Đầu Phá Quan') return false;
        const latest = g.Breakthrough.check(p);
        if (!latest.ready || latest.blocked || latest.next?.id !== check.next.id) return false;
        pending = { from: p.realmId, to: check.next.id, at: now() };
        logger.add('ASCENSION_REQUEST', { from: pending.from, to: pending.to });
        button.click(); return true;
      }
      interactWithStone(); return true;
    }
  };
};


// src/farm/garden-runner.js
A.createGarden = function ({ getGame, doc, host, logger, controller, navigation, flight, ascension = null, now = Date.now }) {
  let running = false, state = 'IDLE', message = '', traveling = false, lastAction = 0, goal = null;
  let move = null, started = 0, expStart = 0, pillStart = 0, craftArmed = false;
  let pendingSow = null, sowFailures = 0;
  let pendingHarvest = null;
  let shop = null, destination = 'vuon_ca_nhan', spent = 0, shopDisabled = false;
  function travelTo(map, npcId = null) {
    clear(); controller.release('garden');
    destination = map;
    if (!navigation.start({ target: map, npcId, otherScriptsStopped: true })) throw Error('Chưa khởi hành được tới ' + map);
    traveling = true;
  }
  const enemies = ['dlt_1', 'dlt_2'];
  function phase(next, detail) {
    if (next !== state || (next !== 'MEDITATE' && message !== detail)) logger.add('GARDEN_STATE', { from: state, to: next, detail });
    state = next; message = detail;
  }
  function press(key) {
    for (const type of ['keydown', 'keyup']) doc.dispatchEvent(new host.KeyboardEvent(type, { key, code: 'Key' + key.toUpperCase(), bubbles: true }));
    lastAction = now();
  }
  function close() { const b = doc.querySelector('#dialog-close'); if (b) b.click(); lastAction = now(); }
  function click(selector, prefix) {
    const matches = Array.from(doc.querySelectorAll(selector)).filter(b => !b.disabled && b.getClientRects().length &&
      (b.textContent.trim().startsWith(prefix) || b.getAttribute('aria-label')?.startsWith(prefix)));
    if (matches.length !== 1) return false;
    matches[0].click(); lastAction = now(); logger.add('GARDEN_CLICK', { label: prefix }); return true;
  }
  function clear() { if (move) getGame()?.SceneWorld?.player?.setPath?.([]); move = null; }
  function go(g, point, tolerance = 28) {
    const p = g.SceneWorld.player;
    if (Math.hypot(p.x - point.x, p.y - point.y) <= tolerance + 3) { clear(); return true; }
    const key = point.x + ':' + point.y;
    if (!move || move.key !== key) { clear(); move = { key, at: now(), progress: now(), x: p.x, y: p.y, tries: 0, issued: false }; }
    if (Math.hypot(p.x - move.x, p.y - move.y) > 3) { move.progress = now(); move.x = p.x; move.y = p.y; }
    if (now() - move.at > 60000) throw Error('Hết thời gian di chuyển trong vườn.');
    if (!move.issued || now() - move.progress > 4000) {
      if (++move.tries > 3) throw Error('Kẹt đường trong vườn.');
      const tile = g.CONFIG.TILE, points = [point];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const candidate = A.tileCenter(g, Math.floor(point.x / tile) + dx, Math.floor(point.y / tile) + dy);
        if (Math.hypot(candidate.x - point.x, candidate.y - point.y) <= tolerance) points.push(candidate);
      }
      let path = null;
      for (const candidate of points) {
        path = A.makePath(g, candidate, { tx: Math.floor(candidate.x / tile), ty: Math.floor(candidate.y / tile) });
        if (path && Math.hypot(path.at(-1).x - point.x, path.at(-1).y - point.y) <= tolerance) break;
        path = null;
      }
      if (path) { p.setPath([]); p.setPath(path); }
      move.issued = true; move.progress = now();
    }
    return false;
  }
  function interact(g, id) {
    const m = g.SceneWorld.map;
    const obj = [...(m.props || []), ...(m.flatProps || []), ...(m.interactables || [])].find(o => o.id === id && !o.hidden);
    if (!obj) throw Error('Không tìm thấy ' + id);
    const target = { x: obj.x, y: obj.y - ((m.interactables || []).includes(obj) ? 0 : g.CONFIG.TILE / 2) };
    if (!go(g, target, obj.type === 'meditate_stone' ? 8 : obj.type === 'herb_plot' ? 20 : 36)) return false;
    const t = g.Targeting;
    for (let i = 0; i < (t.list?.length || 0) * 2 + 4; i++) {
      const selected = t.current();
      if (selected?.obj === obj && selected.dist <= selected.r) { press('e'); return true; }
      t.cycle();
    }
    return false;
  }
  function stop(detail = 'Đã dừng vườn.', next = 'STOPPED') {
    if (traveling) navigation.stop(detail);
    const g = getGame();
    if (running && controller.owns('garden') && g?.SceneWorld?.autoOn) { g.SceneWorld.player?.setPath?.([]); press('t'); g.SceneWorld.player?.setPath?.([]); }
    clear(); running = false; traveling = false; goal = null; shop = null; controller.release('garden'); phase(next, detail);
  }
  return {
    status: () => ({ running, state, message, goal: goal ? { kind: goal.kind, id: goal.id } : null,
      movement: move ? { tries: move.tries, issued: move.issued } : null, seedCost: spent, shopping: shop?.name || null }), stop,
    start({ otherScriptsStopped = false } = {}) {
      const g = getGame(), w = g?.SceneWorld;
      if (running || !otherScriptsStopped || !w?.player || w.autoOn || w.autoDC || w.diNV || w.player.downed || w.player.state === 'sit') return false;
      if (controller.status().owner) return false;
      if (g.HUD?.bagOpen || g.HUD?.dialogOpen) { phase('ERROR', 'Đóng hành trang/hội thoại trước khi vào vườn.'); return false; }
      running = true; started = now(); expStart = w.player.exp || 0;
      spent = 0; shopDisabled = false; shop = null; pendingSow = null; sowFailures = 0; destination = 'vuon_ca_nhan';
      pendingHarvest = null; ascension?.reset();
      pillStart = g.Inventory?.count('pha_canh_dan') || 0;
      if (w.map.data.id !== 'vuon_ca_nhan') {
        if (!navigation.start({ target: 'vuon_ca_nhan', npcId: null, otherScriptsStopped: true })) { running = false; return false; }
        traveling = true; phase('TRAVEL', 'Đang vào Vườn Cá Nhân.');
      } else { controller.reset(); controller.acquire('garden'); phase('CHECK', 'Đang kiểm tra vườn.'); }
      return true;
    },
    tick() {
      if (!running) return;
      try {
        const g = getGame(), w = g?.SceneWorld, p = w?.player;
        if (traveling) {
          const nav = navigation.status(); if (nav.running) return;
          if (nav.state !== 'DONE' || w?.map?.data?.id !== destination) return stop('Chưa tới được ' + destination, 'ERROR');
          traveling = false; controller.acquire('garden');
        }
        if (!controller.owns('garden') || (w?.map?.data?.id !== 'vuon_ca_nhan' && !shop)) return stop('Đã rời vườn hoặc mất quyền điều khiển.');
        if (!p || p.downed || p.hp < p.hpMax * .3) return stop('HP thấp, dừng chăm vườn.', 'ERROR');
        if (now() - started > 3600000) return stop('Đã đạt thời gian một phiên vườn.');
        if (w.autoDC || w.diNV) return stop('Có tác vụ khác đang điều khiển.');
        if (ascension?.active()) { ascension.tick(() => {}); return; }
        if (now() - lastAction < 250 || w.transitioning || w.brewing) return;
        if (p.flying) { if (flight.ground().waiting) return; }
        if (shop) {
          const got = g.Inventory.count(shop.seed) > shop.before;
          if (got) {
            const cost = shop.dc - g.Progress.duocCong;
            if (cost < 0 || cost > shop.cost) throw Error('Chi phí đổi hạt khác dự kiến; dừng kiểm tra.');
            spent += cost; logger.add('GARDEN_SEEDS_CONFIRMED', { pack: shop.id, cost });
            close(); shop = null; travelTo('vuon_ca_nhan'); phase('TRAVEL', 'Mang hạt về vườn.'); return;
          }
          if (shop.issued) {
            if (now() - shop.issued > 7000) {
              logger.add('GARDEN_SEEDS_UNCONFIRMED', { pack: shop.id, caption: (doc.querySelector('#ritual-caption')?.textContent || '').slice(0,300) }); shopDisabled = true; shop = null;
              close(); travelTo('vuon_ca_nhan');
            }
            return;
          }
          if (g.HUD.dialogOpen) {
            if (doc.querySelector('#dialog-title')?.textContent.trim() !== 'Đại Phu') { close(); return; }
            if (now() - lastAction < 1200) return;
            if (g.Progress.duocCong < shop.cost) throw Error('Không còn đủ điểm Dược Công để đổi gói hạt.');
            if (click('#dialog button', 'Vẫn đổi ' + shop.name)) { shop.issued = now(); return; }
            if (click('#dialog button', 'Đổi ' + shop.name)) { shop.issued = g.Inventory.count(shop.seed) > shop.before ? now() : 0; return; }
            if (click('#dialog button', 'Mở Quầy Đổi Hạt')) return;
            close(); return;
          }
          interact(g, 'dai_phu'); return;
        }
        const targets = w.enemies.filter(e => enemies.includes(e.id));
        if (targets.length !== 2) return stop('Chưa xác nhận đủ hai quái vườn.', 'ERROR');
        const alive = targets.filter(e => !e.dead && e.hp > 0);
        if (alive.length) {
          goal = null; craftArmed = false; clear();
          if (g.HUD.dialogOpen) { close(); return; }
          if (p.state === 'sit') { press('q'); return; }
          if (!w.autoOn) { press('t'); return; }
          phase('COMBAT', 'Đánh ' + alive.length + ' quái trong vườn.'); return;
        }
        if (w.autoOn) { p.setPath([]); press('t'); p.setPath([]); move = null; return; }
        if (ascension?.tick(() => interact(g, 'dai_da_duoc'))) { phase('ASCEND', 'Kiểm tra và đột phá theo điều kiện game.'); return; }
        const data = A.readGarden(g), plan = data.goal;
        if (pendingHarvest) {
          if (!g.Farm.plot(pendingHarvest.id) && g.Inventory.count(pendingHarvest.crop) > pendingHarvest.before) {
            logger.add('GARDEN_HARVEST_CONFIRMED', { plot: pendingHarvest.id, crop: pendingHarvest.crop }); pendingHarvest = null;
          } else if (now() - pendingHarvest.at < 3000) return;
          else throw Error('Chưa xác nhận thu hoạch; dừng để kiểm tra luống và túi đồ.');
        }
        if (pendingSow) {
          if (data.plots.find(row => row.id === pendingSow.id)?.seed === pendingSow.seed) {
            logger.add('GARDEN_SOW_CONFIRMED', { plot: pendingSow.id, seed: pendingSow.seed }); pendingSow = null;
          } else if (now() - pendingSow.at < 3000) return;
          else { logger.add('GARDEN_SOW_UNCONFIRMED', { plot: pendingSow.id }); pendingSow = null; sowFailures++; }
        }
        if (goal) {
          if (p.state === 'sit') { press('q'); return; }
          if (goal.kind === 'waterAccess' && g.HUD.dialogOpen) {
            if (!click('#dialog button', 'Múc nước')) close();
            goal = null; return;
          }
          if (goal.kind === 'sow' && g.HUD.dialogOpen) {
            if (doc.querySelector('#dialog-title')?.textContent.trim() === goal.name && click('#dialog button', 'Gieo ' + g.ITEMS[goal.seed].name)) {
              logger.add('GARDEN_SOW_REQUEST', { plot: goal.id, seed: goal.seed });
              pendingSow = { id: goal.id, seed: goal.seed, at: now() }; goal = null; return;
            }
            close(); goal = null; return;
          }
          if (goal.kind === 'brew' && g.HUD.dialogOpen) {
            const detail = doc.querySelector('#dialog .forge-detail h3');
            if (detail?.textContent.trim() === goal.name && craftArmed && click('#dialog .forge-detail .bag-detail-actions button', 'Luyện')) {
              logger.add('GARDEN_BREW_REQUEST', { id: goal.recipe }); goal = null; craftArmed = false; return;
            }
            if (click('#dialog .forge-slot', goal.name + ',')) { craftArmed = true; return; }
            close(); goal = null; craftArmed = false; return;
          }
          if (g.HUD.dialogOpen) { close(); return; }
          if (interact(g, goal.id) && !['sow', 'brew', 'waterAccess'].includes(goal.kind)) {
            if (goal.kind === 'harvest') pendingHarvest = { id: goal.id, crop: goal.crop, before: goal.before, at: now() };
            goal = null;
          }
          return;
        }
        if (g.HUD.dialogOpen) { close(); return; }
        const mature = data.plots.find(row => row.ready);
        const dry = data.water && data.plots.find(row => row.dry);
        if (mature || dry) {
          const row = mature || dry;
          goal = { kind: mature ? 'harvest' : 'water', id: row.id, crop: row.crop, before: row.crop ? g.Inventory.count(row.crop) : 0 };
          phase('GARDEN_WORK', mature ? 'Thu hoạch cây đã chín.' : 'Tưới cây.'); return;
        }
        if (!data.water && data.plots.some(row => row.dry)) {
          goal = { kind: 'waterAccess', id: 'ho_bich_thuy' };
          return;
        }
        if (plan && plan.have < plan.need) {
          if (plan.materials.every(m => m.have >= m.qty) && g.Game.time >= w.brewCooldownUntil) {
            goal = { kind: 'brew', id: 'dan_lo_vuon', recipe: plan.id, name: plan.name };
            phase('BREW', 'Luyện ' + plan.name + ' theo nhu cầu đột phá.'); return;
          }
          const empty = data.plots.find(row => !row.seed);
          if (empty && sowFailures < 2) for (const seed of data.seeds) {
            const material = plan.materials.find(m => m.id === seed.crop);
            const growing = data.plots.filter(row => row.crop === seed.crop).length;
            if (material && material.have + growing < material.qty * (plan.need - plan.have)) {
              const obj = w.map.props.find(o => o.id === empty.id);
              goal = { kind: 'sow', id: empty.id, name: obj.name, seed: seed.id };
              phase('SOW', 'Gieo nguyên liệu cho ' + plan.name + '.'); return;
            }
          }
          if (!shopDisabled && typeof g.Quest.packUnlocked === 'function') {
            const wanted = new Set();
            for (const material of plan.materials) {
              const def = g.Farm.SEEDS.find(seed => seed.crop === material.id);
              if (!def) continue;
              const stock = material.have + data.plots.filter(row => row.crop === material.id).length +
                (data.seeds.find(seed => seed.id === def.seed)?.qty || 0);
              if (stock < material.qty * (plan.need - plan.have)) wanted.add(def.seed);
            }
            const packs = (g.Quest.SEED_PACKS || []).filter(pack => g.Quest.packUnlocked(pack) &&
              pack.cost <= data.duocCong && spent + pack.cost <= 30 && pack.give.some(([id]) => wanted.has(id)));
            packs.sort((a,b) => a.cost-b.cost);
            if (packs.length) {
              if (p.state === 'sit') { press('q'); return; }
              const pack = packs[0], seed = pack.give.find(([id]) => wanted.has(id))[0];
              shop = { id: pack.id, name: pack.name, cost: pack.cost, seed, before: g.Inventory.count(seed), dc: data.duocCong, issued: 0 };
              travelTo('duoc_vien', 'dai_phu'); phase('BUY_SEEDS', 'Đổi ' + pack.name + ' · ' + pack.cost + ' Dược Công.'); return;
            }
          }
        }
        // Use the actual meditation-stone interaction, which enables bonus EXP.
        if (p.state !== 'sit') {
          phase('RETURN_TO_STONE', 'Về đài đá tăng Đạo Hạnh.'); interact(g, 'dai_da_duoc'); return;
        }
        const gain = (p.exp || 0) - expStart;
        phase('MEDITATE', 'Tọa thiền tại đài đá · Đạo Hạnh +' + Math.floor(gain));
        if ((g.Inventory?.count('pha_canh_dan') || 0) > pillStart) {
          logger.add('GARDEN_PILLS_OBSERVED', { count: g.Inventory.count('pha_canh_dan') }); pillStart = g.Inventory.count('pha_canh_dan');
        }
      } catch (error) { stop(error.message, 'ERROR'); }
    }
  };
};


// src/ui/overlay.js
A.createOverlay = function ({ doc, getStatus, start, startQuests, startGarden, stop, exportLog, copyLog, debugToggle }) {
  const host = doc.createElement('div');
  host.id = 'tutien-auto-panel';
  Object.assign(host.style, { position: 'fixed', right: '12px', top: '12px', zIndex: '2147483647', maxWidth: 'calc(100vw - 24px)' });
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { color-scheme: dark; }
      section { width: 310px; max-width: calc(100vw - 28px); box-sizing: border-box; background: #152020f2; color: #eaf4ee; border: 1px solid #5b7869; border-radius: 10px; padding: 12px; font: 13px/1.5 system-ui,sans-serif; box-shadow: 0 5px 25px #0007; }
      header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      button { cursor: pointer; background: #304c40; color: white; border: 1px solid #648673; border-radius: 5px; padding: 6px 9px; margin: 3px 3px 3px 0; font: inherit; }
      button:disabled { opacity: .45; cursor: default; } button.stop { background: #923c3c; }
      p { margin: 7px 0; overflow-wrap: anywhere; } .muted { color: #b6c9bc; font-size: 12px; }
      label { display: block; margin: 8px 0; } input { vertical-align: middle; }
      textarea { box-sizing: border-box; width: 100%; height: 150px; font: 11px monospace; }
      [hidden] { display: none !important; }
    </style>
    <section aria-label="TuTien2D Automation">
      <header><strong>TuTien2D · Khảo sát & di chuyển</strong><button id="fold" title="Thu gọn">−</button></header>
      <div id="body">
        <p id="status" aria-live="polite"></p>
        <p id="details" class="muted"></p>
        <label><input id="ready" type="checkbox"> Tôi đã tắt các script Auto khác.</label>
        <button id="start">Start · Tới Đại Phu</button><button id="stop" class="stop">Stop</button>
        <button id="quests">Chạy việc Dược Công</button><p id="quest-status" class="muted"></p>
        <label><input id="one-run" type="checkbox"> Dừng sau một lượt hoàn thành</label>
        <button id="garden">Vào vườn · Đánh quái & trồng cây</button><p id="garden-status" class="muted"></p>
        <p class="muted">Đứng dậy, tắt Auto game và đóng menu trước khi Start. Esc hoặc di chuyển bằng tay sẽ dừng điều hướng.</p>
        <button id="copy">Copy Log</button><button id="export">Export JSON</button><button id="debug">Dừng khảo sát</button>
        <p id="feedback" class="muted" aria-live="polite"></p>
        <textarea id="fallback" hidden readonly aria-label="Log để sao chép"></textarea>
      </div>
    </section>`;
  const $ = id => root.getElementById(id);
  let folded = false;
  $('fold').addEventListener('click', () => { folded = !folded; $('body').hidden = folded; $('fold').textContent = folded ? '+' : '−'; });
  $('start').addEventListener('click', () => start($('ready').checked));
  $('quests').addEventListener('click', () => startQuests($('ready').checked, $('one-run').checked));
  $('garden').addEventListener('click', () => startGarden($('ready').checked));
  $('stop').addEventListener('click', () => stop());
  $('export').addEventListener('click', () => exportLog());
  $('copy').addEventListener('click', async () => {
    try { await copyLog(); $('feedback').textContent = 'Đã sao chép log.'; }
    catch (_) {
      $('fallback').value = exportLog(true); $('fallback').hidden = false;
      $('fallback').focus(); $('fallback').select();
      $('feedback').textContent = 'Chrome chưa cho phép clipboard. Nhấn Ctrl+C trong ô log.';
    }
  });
  $('debug').addEventListener('click', () => debugToggle());
  function render() {
    const s = getStatus();
    $('status').textContent = s.navigation.state + ' · ' + (s.navigation.message || (s.snapshot.ready ? 'Sẵn sàng khảo sát.' : 'Chờ gameDebug. Nếu chờ lâu, reload trang.'));
    const p = s.snapshot.player;
    $('details').textContent = `${s.snapshot.map.name || 'Chưa có map'} · (${Math.round(p.x || 0)}, ${Math.round(p.y || 0)}) · ${s.logs} log · ${s.debug ? 'Đang khảo sát' : 'Đã dừng khảo sát'}`;
    $('quest-status').textContent = s.quests.state + ' · ' + s.quests.message + ' · Đã xong ' + s.quests.completed + ' lượt';
    $('garden-status').textContent = s.garden.state + ' · ' + s.garden.message;
    $('start').disabled = s.navigation.running || s.quests.running || s.garden.running || !s.snapshot.ready || !$('ready').checked;
    $('quests').disabled = $('start').disabled;
    $('garden').disabled = $('start').disabled;
    $('debug').textContent = s.debug ? 'Dừng khảo sát' : 'Bật khảo sát';
  }
  $('ready').addEventListener('change', render);
  doc.documentElement.appendChild(host);
  render();
  return { host, render, remove() { host.remove(); } };
};


// src/main.js
if (window.TuTienAuto) return;
const access = A.createGameAccess(window);
const logger = A.createLogger(300);
const controller = A.createController();
const flight = A.createFlight({ getGame: () => access.get(), doc: document, host: window, logger });
const navigation = A.createNavigation({ getGame: () => access.get(), logger, controller, flight });
const quests = A.createQuestRunner({ getGame: () => access.get(), doc: document, host: window, controller, logger, flight });
const ascension = A.createAscension({ getGame: () => access.get(), doc: document, logger });
const garden = A.createGarden({ getGame: () => access.get(), doc: document, host: window, logger, controller, navigation, flight, ascension });
let debug = true, ui = null, lastSignature = '', lastSample = 0, disposed = false;
let snapshot = A.readState(access.get(), document);
logger.add('LOADED', { version: '0.3.1', mode: 'read-only-until-start' });

function sample(force = false) {
  snapshot = A.readState(access.get(), document);
  // Position is exported, but walking alone does not generate a record each tick.
  const signature = JSON.stringify({ ...snapshot, player: A.pick(snapshot.player, ['state', 'downed', 'flying']),
    enemies: snapshot.enemies.map(e => A.pick(e, ['id', 'dead'])) });
  if (debug && (force || signature !== lastSignature)) {
    logger.add('STATE_CHANGED', snapshot); lastSignature = signature;
  }
  lastSample = Date.now();
}
function status() {
  return { version: '0.3.1', debug, disposed, logs: logger.size(), snapshot, navigation: navigation.status(), quests: quests.status(), garden: garden.status(), controller: controller.status(),
    oldFarmStatusFunctionPresent: typeof window.getFarmStatus === 'function' };
}
function report() {
  sample();
  const g = access.get();
  return { schema: 'tutien2d-diagnostic-v1', version: '0.3.1', exportedAt: new Date().toISOString(),
    snapshot, navigation: navigation.status(),
    quests: quests.status(), duocCong: A.readDuocCong(g),
    flight: flight.status(),
    garden: garden.status(), gardenData: A.readGarden(g),
    ascension: ascension.status(),
    oldFarmStatusFunctionPresent: typeof window.getFarmStatus === 'function',
    route: A.mapRoute(g?.MapData, snapshot.map.id, 'duoc_vien'),
    maps: Array.from(A.maps(g?.MapData).values()).slice(0, 500).map(m => ({ ...A.pick(m, ['id', 'name', 'width', 'height']),
      portals: m.portals.slice(0, 200).map(p => A.pick(p, ['tx', 'ty', 'toMap', 'byHand', 'cooldownSec'])) })),
    records: logger.records() };
}
function exportLog(textOnly = false) {
  const text = JSON.stringify(report(), null, 2);
  if (textOnly) return text;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'tutien2d-log-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  document.documentElement.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return text;
}
function stopAll(reason = 'Đã dừng và trả quyền điều khiển.') {
  garden.stop(reason); quests.stop(reason); navigation.stop(reason); controller.stop(); ui?.render();
}
const listeners = [];
function listen(target, event, handler, capture = false) {
  target.addEventListener(event, handler, capture);
  listeners.push(() => target.removeEventListener(event, handler, capture));
}
listen(window, 'keydown', e => {
  if (!e.isTrusted || !(navigation.status().running || quests.status().running || garden.status().running)) return;
  if (['Escape', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyT', 'KeyR', 'KeyQ', 'KeyE', 'Enter', 'Space', 'KeyB', 'KeyI', 'KeyF'].includes(e.code)) stopAll('Đã dừng vì bạn thao tác bàn phím.');
}, true);
listen(document, 'pointerdown', e => {
  if (e.isTrusted && (navigation.status().running || quests.status().running || garden.status().running) && !e.composedPath().includes(ui?.host)) stopAll('Đã dừng vì bạn chạm màn hình game.');
}, true);
listen(document, 'visibilitychange', () => { if (document.hidden && (navigation.status().running || quests.status().running || garden.status().running)) stopAll('Đã dừng vì tab bị ẩn.'); });
listen(window, 'pagehide', () => stopAll('Đã rời trang.'));

const timer = setInterval(() => {
  navigation.tick();
  quests.tick();
  garden.tick();
  if (debug && Date.now() - lastSample >= 1000) {
    try { sample(); } catch (error) { logger.add('DIAGNOSTIC_ERROR', { message: error.message }); }
  }
  ui?.render();
}, 250);
function mount() {
  if (disposed || ui || !document.documentElement) return;
  ui = A.createOverlay({ doc: document, getStatus: status,
    start: checked => { navigation.start({ otherScriptsStopped: checked }); ui.render(); },
    startQuests: (checked, oneRun) => { quests.start({ otherScriptsStopped: checked, maxRuns: oneRun ? 1 : Infinity }); ui.render(); },
    startGarden: checked => { garden.start({ otherScriptsStopped: checked }); ui.render(); },
    stop: stopAll, exportLog, copyLog: () => navigator.clipboard.writeText(exportLog(true)),
    debugToggle: () => { debug = !debug; if (debug) sample(true); ui.render(); } });
}
const api = Object.freeze({
  version: '0.3.1',
  status: () => JSON.parse(JSON.stringify(status())),
  report,
  start: options => { if (disposed) return false; return navigation.start(options); },
  startQuests: options => { if (disposed) return false; return quests.start(options); },
  startGarden: options => { if (disposed) return false; return garden.start(options); },
  stop: stopAll,
  exportLog,
  stopAutoDebug: () => { debug = false; },
  startAutoDebug: () => { debug = true; sample(true); },
  getAutoDebugStatus: () => ({ running: debug && !disposed, records: logger.size(), ready: snapshot.ready }),
  dispose() {
    stopAll('Đã tắt công cụ. Reload để bật lại.'); debug = false; disposed = true;
    clearInterval(timer); listeners.splice(0).forEach(remove => remove()); ui?.remove();
  }
});
window.TuTienAuto = api;
// Do not overwrite commands supplied by an older diagnostic userscript.
for (const name of ['stopAutoDebug', 'getAutoDebugStatus']) {
  if (typeof window[name] === 'undefined') window[name] = api[name];
}
if (document.documentElement) mount();
else listen(document, 'DOMContentLoaded', mount);

})();
