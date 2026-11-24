// ==UserScript==
// @name         TuTien2D Diagnostic + Navigation
// @namespace    local.tutien2d.automation
// @version      0.1.0
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
    player: A.pick(w?.player, ['x', 'y', 'state', 'hp', 'hpMax', 'downed', 'flying', 'sitLocked']),
    controls: { autoOn: w?.autoOn === true, autoDC: !!w?.autoDC, diNV: !!w?.diNV, transitioning: !!w?.transitioning },
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
A.createNavigation = function ({ getGame, logger, controller, now = Date.now }) {
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
    if (p.flying || p.sitLocked || ['sit', 'pose'].includes(p.state)) return 'Hạ phi hành và đứng dậy trước khi Start.';
    if (g.HUD?.dialogOpen || g.HUD?.bagOpen || w.menuOpen) return 'Đóng hội thoại, hành trang và menu trước.';
    return null;
  }
  function assign(path) {
    if (!controller.owns('navigation') || !job) throw Error('CONTROL_LOST');
    const player = getGame().SceneWorld.player;
    ownsPath = true;
    player.setPath([]); player.setPath(path);
  }
  function plan(g) {
    const w = g.SceneWorld, id = w.map.data.id;
    if (id === job.target) {
      if (!job.npcId) return end('DONE', 'Đã tới map mục tiêu.');
      const npc = A.findNpc(g, job.npcId);
      if (!npc) return end('ERROR', 'Không tìm thấy NPC với tọa độ runtime hợp lệ.');
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


// src/ui/overlay.js
A.createOverlay = function ({ doc, getStatus, start, stop, exportLog, copyLog, debugToggle }) {
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
    $('start').disabled = s.navigation.running || !s.snapshot.ready || !$('ready').checked;
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
const navigation = A.createNavigation({ getGame: () => access.get(), logger, controller });
let debug = true, ui = null, lastSignature = '', lastSample = 0, disposed = false;
let snapshot = A.readState(access.get(), document);
logger.add('LOADED', { version: '0.1.0', mode: 'read-only-until-start' });

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
  return { version: '0.1.0', debug, disposed, logs: logger.size(), snapshot, navigation: navigation.status(), controller: controller.status(),
    oldFarmStatusFunctionPresent: typeof window.getFarmStatus === 'function' };
}
function report() {
  sample();
  const g = access.get();
  return { schema: 'tutien2d-diagnostic-v1', version: '0.1.0', exportedAt: new Date().toISOString(),
    snapshot, navigation: navigation.status(),
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
  navigation.stop(reason); controller.stop(); ui?.render();
}
const listeners = [];
function listen(target, event, handler, capture = false) {
  target.addEventListener(event, handler, capture);
  listeners.push(() => target.removeEventListener(event, handler, capture));
}
listen(window, 'keydown', e => {
  if (!e.isTrusted || !navigation.status().running) return;
  if (['Escape', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyT', 'KeyR', 'KeyQ', 'KeyE', 'Enter', 'Space', 'KeyB', 'KeyI', 'KeyF'].includes(e.code)) stopAll('Đã dừng vì bạn thao tác bàn phím.');
}, true);
listen(document, 'pointerdown', e => {
  if (e.isTrusted && navigation.status().running && !e.composedPath().includes(ui?.host)) stopAll('Đã dừng vì bạn chạm màn hình game.');
}, true);
listen(document, 'visibilitychange', () => { if (document.hidden && navigation.status().running) stopAll('Đã dừng vì tab bị ẩn.'); });
listen(window, 'pagehide', () => stopAll('Đã rời trang.'));

const timer = setInterval(() => {
  navigation.tick();
  if (debug && Date.now() - lastSample >= 1000) {
    try { sample(); } catch (error) { logger.add('DIAGNOSTIC_ERROR', { message: error.message }); }
  }
  ui?.render();
}, 250);
function mount() {
  if (disposed || ui || !document.documentElement) return;
  ui = A.createOverlay({ doc: document, getStatus: status,
    start: checked => { navigation.start({ otherScriptsStopped: checked }); ui.render(); },
    stop: stopAll, exportLog, copyLog: () => navigator.clipboard.writeText(exportLog(true)),
    debugToggle: () => { debug = !debug; if (debug) sample(true); ui.render(); } });
}
const api = Object.freeze({
  version: '0.1.0',
  status: () => JSON.parse(JSON.stringify(status())),
  report,
  start: options => { if (disposed) return false; return navigation.start(options); },
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

