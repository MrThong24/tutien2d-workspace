// ==UserScript==
// @name         TuTien2D Diagnostic + Navigation
// @namespace    local.tutien2d.automation
// @version      0.9.7
// @description  Khao sat chi doc; di den Dai Phu khi bam Start.
// @match        https://tutien2d.com/*
// @match        https://www.tutien2d.com/*
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
  const candidates = [];
  let hook = 'unavailable';
  let configHook = 'not-installed';
  const keep = value => {
    if (value && typeof value === 'object' && !candidates.includes(value)) {
      candidates.push(value);
      if (candidates.length > 20) candidates.shift();
    }
    return value;
  };
  // The current game keeps its namespace in a closure, then initializes it
  // with `namespace.CONFIG = ...`. Capture that receiver once, before the
  // game finishes loading, without modifying game scripts or making a copy.
  try {
    const proto = host.Object.prototype;
    if (!Object.getOwnPropertyDescriptor(proto, 'CONFIG')) {
      const setter = function (value) {
        Object.defineProperty(this, 'CONFIG', { value, writable: true, enumerable: true, configurable: true });
        if (value && value.NAME === 'Tu Tiên 2D' && value.TILE === 32 &&
            value.PLAYER && Number.isFinite(value.PLAYER.HITBOX_W)) {
          keep(this);
          configHook = 'captured';
          cleanup();
        }
      };
      const cleanup = () => {
        if (Object.getOwnPropertyDescriptor(proto, 'CONFIG')?.set === setter) delete proto.CONFIG;
      };
      Object.defineProperty(proto, 'CONFIG', { configurable: true, enumerable: false, set: setter });
      configHook = 'installed';
      host.setTimeout(() => { cleanup(); if (configHook === 'installed') configHook = 'expired'; }, 30000);
    } else configHook = 'occupied';
  } catch (_) { configHook = 'error'; }
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
      hook = 'installed';
    }
  } catch (_) { /* A pre-existing capture can still supply gameDebug. */ }
  return {
    get() {
      try { keep(host.PNTT); keep(host.gameDebug); } catch (_) {}
      const values = [...candidates].reverse();
      return values.find(value => value?.SceneWorld?.player && value?.SceneWorld?.map?.data?.id) ||
        values.find(value => value?.SceneWorld) || values[0] || null;
    },
    diagnostics() {
      try { keep(host.PNTT); keep(host.gameDebug); } catch (_) {}
      return { hook, configHook, candidates: candidates.map(value => ({ player: !!value?.SceneWorld?.player,
        map: !!value?.SceneWorld?.map?.data?.id, farm: !!value?.Farm, quest: !!value?.Quest })) };
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


// src/core/combat-skills.js
// Configure native Auto through its normal inventory UI. The game remains
// responsible for cooldowns, mana, weapon restrictions and target validation.
A.readCombatSkills = function (g) {
  const s=g?.Skills,p=g?.SceneWorld?.player;
  if (!s?.learnedSlots || !s.slotDef) return [];
  return s.learnedSlots().slice(0,64).map((slot,index)=>{
    const d=s.slotDef(slot);
    return d?{id:d.id,name:d.name||d.short,index,visible:!!s.onBar?.(d.id),
      enabled:!!s.autoUses?.(d.id),playerOnly:!!d.playerTargetOnly,
      cooldown:s.coolLeft?.(p,d)||0}:null;
  }).filter(Boolean);
};
A.createCombatSkills = function ({getGame,doc,host,logger,now=Date.now}) {
  let configuring=false,opened=false,last=0,started=0,pending=null;
  function reset(){configuring=false;opened=false;last=0;started=0;pending=null;}
  function buttonClick(selector) {
    const b=doc.querySelector(selector);
    if (!b || b.disabled || !b.getClientRects().length) throw Error('Không thấy nút thiết lập kỹ năng: '+selector);
    b.click();last=now();
  }
  return {
    reset,
    status:()=>({configuring,skills:A.readCombatSkills(getGame())}),
    prepare(){
      const g=getGame(),s=g?.Skills;
      if (!s?.learnedSlots || !s.onBar || !s.autoUses) return true;
      if (now()-last<300) return false;
      const skills=A.readCombatSkills(g);
      if (pending) {
        if (skills.some(r=>r.id===pending.id && r.enabled)) {
          logger.add('COMBAT_SKILL_ENABLED',{id:pending.id,name:pending.name});pending=null;
        } else if (now()-pending.at>3000) throw Error('Game chưa xác nhận bật kỹ năng cho Auto.');
        else return false;
      }
      const missing=skills.find(r=>r.visible && !r.enabled && !r.playerOnly);
      if (!missing) {
        if (opened && g.HUD.bagOpen) {buttonClick('#bag-close');return false;}
        reset();return true;
      }
      if (!configuring){configuring=true;started=now();}
      if (now()-started>15000) throw Error('Chưa thiết lập xong kỹ năng Auto sau 15 giây.');
      if (!g.HUD.bagOpen) {opened=true;buttonClick('#hud-left');return false;}
      const pane=doc.querySelector('#ht-tu-dong');
      if (!pane || pane.classList.contains('hidden')) {buttonClick('#bag [data-tab="tu-dong"]');return false;}
      const selector='#td-list [data-td="'+missing.index+'"]';
      const row=doc.querySelector(selector);
      if (!row || row.getAttribute('aria-pressed')!=='false') throw Error('Không xác minh được ô kỹ năng '+missing.name+'.');
      pending={id:missing.id,name:missing.name,at:now()};buttonClick(selector);return false;
    }
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
A.readHudConnection = function (doc) {
  const node = id => doc.getElementById(id);
  const text = id => (node(id)?.textContent || '').trim();
  const hud = node('hud'), map = text('hud-map');
  const pos = text('hud-pos').match(/\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/);
  const hp = text('value-hp').match(/(\d+)\s*\/\s*(\d+)/);
  const visible = el => !!el && !el.hidden && !el.classList.contains('hidden') && !!el.getClientRects().length;
  const ready = visible(hud) && !!map && !!pos && !visible(node('auth-gate')) && !visible(node('loading'));
  const breakthrough = [...doc.querySelectorAll('#breakthrough-requirements .breakthrough-requirement')].map(row => {
    const bar = row.querySelector('[role="progressbar"]');
    return { label: bar?.getAttribute('aria-label') || null,
      current: bar?.getAttribute('aria-valuenow') || null, need: bar?.getAttribute('aria-valuemax') || null,
      done: row.classList.contains('done') };
  });
  return { ready, map: map || null, x: pos ? Number(pos[1]) : null, y: pos ? Number(pos[2]) : null,
    hp: hp ? Number(hp[1]) : null, hpMax: hp ? Number(hp[2]) : null,
    realm: text('hud-realm') || null, breakthroughRoute: text('breakthrough-route') || null,
    breakthrough, target: node('btn-attack')?.getAttribute('aria-label') || null,
    enemy: visible(node('hud-target')) ? text('target-name') : null,
    experienceFull: node('row-xp')?.classList.contains('full') ?? null };
};
A.readState = function (game, doc) {
  const w = game?.SceneWorld, map = w?.map, q = game?.Quest;
  const list = (items, keys, max = 200) => Array.isArray(items) ? items.slice(0, max).map(p => A.pick(p, keys)) : [];
  const text = selector => (doc?.querySelector(selector)?.textContent || '').trim().slice(0, 300);
  const dialog = doc?.querySelector('#dialog');
  const dialogOpen = !!game?.HUD?.dialogOpen;
  return {
    available: !!game, ready: !!(w?.player && map?.data?.id), hud: A.readHudConnection(doc),
    map: A.pick(map?.data, ['id', 'name', 'width', 'height']),
    tile: game?.CONFIG?.TILE ?? null,
    player: A.pick(w?.player, ['x', 'y', 'state', 'hp', 'hpMax', 'mp', 'mpMax', 'downed', 'flying', 'sitLocked', 'realmId', 'realm', 'exp', 'expMax', 'meditateBonusExp']),
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
    questDrops: list(w?.drops?.filter(d=>['yeu_cot','doc_dang_doc_dich','manh_bi_tich_ha'].includes(d.itemId)), ['itemId','state','x','y','gy','asked']),
    quest: { stage: q?.stage ?? null, objectives: list(q?.objectives?.(), ['text','cur','max','done']), seed: A.pick(q?.seedQuest, ['active', 'task', 'round']),
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
  return { available: true, tasks, active: info ? { id: info.id, name: info.shortName || info.name, supported: handlers.has(info.id),
    progress: q.seedQuestProgress(), need: info.need ?? null, complete: q.seedQuestComplete(), round: q.seedQuest.round } : null };
};


// src/quests/quest-runner.js
// Uses normal dialog buttons and interaction keys. Never invokes Quest mutation APIs.
A.createQuestRunner = function ({ getGame, doc, host, controller, logger, flight = null, now = Date.now }) {
  let running = false, state = 'IDLE', message = '', started = 0, taskStarted = 0;
  let chosen = null, moving = null, lastAction = 0, lastProgress = 0, signature = '', waiting = null;
  let tracked = null, completed = 0;
  let acceptanceArmed = null, maxCompletions = Infinity, taskIds = null, ownedActivity = false;
  let linhBatchTarget = 0, linhBatchCollecting = false, linhBatchPlace = null;
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
      if (tracked.id === 'linh_chi' && linhBatchCollecting) {
        linhBatchCollecting = false;
        logger.add('QUEST_BATCH_READY', { id: 'linh_chi', inventory: g.Inventory?.count?.('nam_linh_chi') || 0 });
      }
      tracked = null; chosen = null; signature = ''; taskStarted = now();
    } else throw Error('Nhiệm vụ biến mất khi chưa xác minh giao việc; dừng để kiểm tra.');
  }
  return {
    movement: { travel, move, object, interact, clear: clearMovement, click, closeDialog },
    status: () => ({ running, state, message, completed, task: chosen?.id || tracked?.id || null }),
    start({ otherScriptsStopped = false, maxRuns = Infinity, only = null } = {}) {
      if (running) return false;
      const g = getGame(), w = g?.SceneWorld;
      if (typeof g?.Quest?.canOpenSeedMenu === 'function' && !g.Quest.canOpenSeedMenu()) {
        phase('ERROR', 'Cần hoàn thành Giai đoạn 7; bấm Làm nhiệm vụ mở Dược Công.'); return false;
      }
      if (!otherScriptsStopped || !w?.player || !A.readDuocCong(g).available || w.autoOn || w.autoDC || w.diNV ||
          (!flight && w.player.flying) || w.player.downed || w.player.state === 'sit' || w.fishing || w.chopping) {
        phase('ERROR', 'Cần tắt Auto khác, đứng dậy và có dữ liệu nhiệm vụ trước khi chạy.'); return false;
      }
      controller.reset(); if (!controller.acquire('quest')) { phase('ERROR', 'Module khác đang giữ quyền điều khiển.'); return false; }
      running = true; started = taskStarted = lastProgress = now(); chosen = tracked = null; completed = 0;
      flight?.reset();
      acceptanceArmed = null; maxCompletions = Number.isFinite(maxRuns) ? Math.max(1, maxRuns) : Infinity;
      taskIds = Array.isArray(only) ? only : null; ownedActivity = false;
      linhBatchTarget = 0; linhBatchCollecting = false; linhBatchPlace = null;
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
          if (click('Sổ Dược Công', 'Đại Phu')) return;
          if (click('Nhận Việc Dược Công', 'Đại Phu')) return;
          acceptanceArmed = null; return void closeDialog(g);
        }
        if (!tracked) {
          tracked = { id: active.id, round: active.round, duocCong: g.Progress?.duocCong ?? 0, turnIn: false };
          chosen = catalog.tasks.find(t => t.id === active.id); taskStarted = now();
          if (active.id === 'linh_chi' && !linhBatchTarget) {
            const item = active.item || 'nam_linh_chi';
            linhBatchTarget = Math.max(9, g.Inventory?.count?.(item) || 0);
            linhBatchCollecting = (g.Inventory?.count?.(item) || 0) < linhBatchTarget;
            const batchIds = (g.Quest.seedTaskInfo?.()?.propIds || []).slice();
            linhBatchPlace = batchIds.length ? { mapId: 'tan_vien', ids: batchIds } : null;
            logger.add('QUEST_BATCH_START', { id: 'linh_chi', target: linhBatchTarget, inventory: g.Inventory?.count?.(item) || 0 });
          }
          logger.add('QUEST_ACCEPTED_OBSERVED', { id: active.id, round: active.round });
        }
        if (active.id !== tracked.id) throw Error('Nhiệm vụ bị thay đổi ngoài bộ điều phối.');
        if (chosen?.status === 'NEEDS_ADAPTER' || chosen?.locked) return stop('Đang giữ việc chưa được hỗ trợ: ' + active.name, 'PENDING_ACTIVITIES');
        if (g.HUD.dialogOpen) {
          const labels = active.complete ? ['Giao Ba Cá', 'Giao Nguyên Liệu'] : active.id === 'ho_tong_chau' ? ['Bẩm Thầy Ông Nội'] : [];
          for (const label of labels) if (click(label, active.id === 'ho_tong_chau' ? 'Thầy Ông Nội' : 'Đại Phu')) { tracked.turnIn = true; return; }
          if (active.id === 'cau_ca' && click('Thả câu')) return;
          // Main-stage dialogue (notably stage 16) takes priority at Dai Phu.
          // Open the daily-work ledger before looking for its turn-in button.
          if (active.id !== 'ho_tong_chau' && click('Sổ Dược Công', 'Đại Phu')) return;
          return void closeDialog(g);
        }
        const batchPending = active.id === 'linh_chi' && linhBatchCollecting &&
          (g.Inventory?.count?.(active.item || 'nam_linh_chi') || 0) < linhBatchTarget;
        if (active.complete && !batchPending) {
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
        let step = g.Quest.autoSeedStep(); // Read-only planning function verified in downloaded source.
        if (batchPending && linhBatchPlace) step = { act: 'hai', place: linhBatchPlace };
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


// src/quests/later-intro.js
// Stages 14–16. All quest, farm and inventory APIs here are read-only.
// Choices match the user's requested Thiet Kiem and Hoa Cau.
A.createLaterIntro = function ({ doc, host, helper, flight, now = Date.now, phase, press, at, click, brew }) {
  let bookSelected = false;
  const pickupStarted = new WeakMap(), skippedDrops = new WeakSet();
  function auto(g, enabled) {
    const w=g.SceneWorld;
    if (!!w.autoOn===enabled) return false;
    helper.clear(); w.player.setPath([]); press('t'); w.player.setPath([]); return true;
  }
  function stand(g) { if (g.SceneWorld.player.state!=='sit') return false; press('q'); return true; }
  function collect(g,item) {
    const w=g.SceneWorld,p=w.player;
    const drops=(w.drops||[]).filter(d=>d.kind==='item' && d.itemId===item &&
      ['ground','fall'].includes(d.state) && !d.asked && !skippedDrops.has(d) &&
      g.Loot?.canPick?.(d,g.Gateway?.selfId||null,d.age));
    drops.sort((a,b)=>Math.hypot(a.x-p.x,(a.state==='fall'?a.gy:a.y)-p.y)-Math.hypot(b.x-p.x,(b.state==='fall'?b.gy:b.y)-p.y));
    while (drops.length && pickupStarted.has(drops[0]) && now()-pickupStarted.get(drops[0])>10000) {
      skippedDrops.add(drops.shift());
    }
    if (!drops.length) return false;
    if (auto(g,false) || stand(g) || flight?.ground().waiting) return true;
    const d=drops[0];
    if (!pickupStarted.has(d)) pickupStarted.set(d,now());
    helper.move(g,{x:d.x,y:d.state==='fall'?d.gy:d.y},Math.max(8,(g.Loot.PICK_R||40)-12));
    phase('PICKUP','Nhặt '+(g.ITEMS?.[item]?.name||item)+' rơi từ quái.'); return true;
  }
  function equip(g,id) {
    if (g.Inventory.isEquipped?.(id)) {
      return true;
    }
    if (g.HUD.dialogOpen) { helper.closeDialog(g); return false; }
    if (!g.HUD.bagOpen) { press('b'); return false; }
    const name=g.ITEMS?.[id]?.name;
    const detail=doc.querySelector('#bag-detail h3');
    if (name && detail?.textContent.trim()===name) {
      const b=Array.from(doc.querySelectorAll('#bag-detail .bag-detail-actions button'))
        .find(b=>!b.disabled && b.textContent.trim()==='Trang Bị');
      if (b) { b.click(); return false; }
    }
    const item=doc.querySelector('#bag-list [data-item="'+id+'"]');
    if (item) { item.click(); return false; }
    const filter=doc.querySelector('#bag [data-filter="trang-bi"]');
    if (filter) filter.click();
    phase('EQUIP','Đang tìm '+(name||id)+' trong Hành Trang.'); return false;
  }
  function combat(g,map) {
    if (g.HUD.dialogOpen) { helper.closeDialog(g); return; }
    if (stand(g)) return;
    if (g.SceneWorld.map.data.id!==map) { if (auto(g,false)) return; helper.travel(g,map); return; }
    if (flight?.ground().waiting) return;
    auto(g,true); phase('COMBAT','Đánh quái theo mục tiêu nhiệm vụ.');
  }
  function garden(g) {
    const w=g.SceneWorld,q=g.Quest,p=w.player;
    if (w.map.data.id!=='vuon_ca_nhan') {
      if (g.HUD.dialogOpen) { helper.closeDialog(g); return; }
      if (stand(g)) return;
      helper.travel(g,'vuon_ca_nhan'); return;
    }
    const recipe=q.TU_KHI_DAN_RECIPE;
    const needPill=!g.Inventory.has('tu_khi_dan');
    const full=q.daoHanhFull();
    const ready=g.Breakthrough.check(p).ready;
    const alive=w.enemies.some(e=>['dlt_1','dlt_2'].includes(e.id)&&!e.dead&&e.hp>0);
    if (g.HUD.dialogOpen) {
      if (auto(g,false)) return;
      if (ready && click('Bắt Đầu Phá Quan')) return;
      if (needPill && q.hasRecipe(recipe) && brew('Tụ Khí Đan')) return;
      if (click('Múc nước')) return;
      helper.closeDialog(g); return;
    }
    if (ready) {
      if (auto(g,false)) return;
      if (stand(g)) return;
      at(g,'vuon_ca_nhan',['dai_da_duoc']); return;
    }
    if (needPill) {
      if (stand(g)) return;
      if (q.hasRecipe(recipe)) { if (auto(g,false)) return; at(g,'vuon_ca_nhan',['dan_lo_vuon']); return; }
      const plots=Array.from({length:g.Farm.PLOT_COUNT||10},(_,i)=>'plot_'+(i+1));
      const mature=plots.find(id=>g.Farm.ready(id));
      if (mature) { if (auto(g,false)) return; at(g,'vuon_ca_nhan',[mature]); return; }
      const dry=plots.find(id=>g.Farm.canWater(id));
      if (dry) { if (auto(g,false)) return; at(g,'vuon_ca_nhan',g.Farm.hasWaterAccess()?[dry]:['ho_bich_thuy']); return; }
      const empty=plots.find(id=>!g.Farm.plot(id));
      for (const [crop,seed] of [['linh_diep','hat_linh_diep'],['huyet_thao','hat_huyet_thao']]) {
        const growing=plots.filter(id=>g.Farm.plot(id)?.seed===seed).length;
        if (g.Inventory.count(crop)+growing>=3) continue;
        if (empty && g.Inventory.count(seed)>0) {
          if (auto(g,false)) return;
          const target=helper.object(g,[empty]);
          if (!target) throw Error('Không tìm thấy luống trống '+empty+'.');
          if (helper.interact(g,target)) {
            if (g.Farm.plot(empty)) throw Error('Luống đã được gieo trước khi Auto gửi hạt.');
            if (!g.Inventory.has(seed,1)) throw Error('Hạt '+g.ITEMS[seed].name+' không còn trong túi.');
            if (!g.Farm.sow(empty,seed)) throw Error('Game không nhận hạt '+g.ITEMS[seed].name+'.');
            g.Farm.syncProps?.(w.map);
            if (g.HUD.dialogOpen) g.HUD.closeDialog?.();
            phase('SOW','Đã gửi hạt '+g.ITEMS[seed].name+' vào '+empty+'.');
          } else at(g,'vuon_ca_nhan',[empty]);
          return;
        }
        if (!growing && !g.Inventory.count(seed)) throw Error('Thiếu hạt '+g.ITEMS[seed].name+' cho Tầng 4. Đổi thêm ở Đại Phu rồi chạy lại.');
      }
      if (g.Inventory.count('linh_thuy')<2 || alive) { combat(g,'vuon_ca_nhan'); return; }
      phase('WAIT_GARDEN','Đã gieo/tưới nguyên liệu Tụ Khí Đan, chờ cây chín.'); return;
    }
    if (alive) { combat(g,'vuon_ca_nhan'); return; }
    if (auto(g,false)) return;
    if (p.state==='sit' && !full) { phase('MEDITATE','Tọa thiền tích Đạo Hạnh để phá quan Tầng 4.'); return; }
    if (stand(g)) return;
    at(g,'vuon_ca_nhan',['dai_da_duoc']);
  }
  return { tick(g) {
    const q=g.Quest,w=g.SceneWorld;
    if (q.stage===14) {
      if (!q.binhKhiDaNhan()) {
        if (auto(g,false) || stand(g)) return;
        if (g.HUD.dialogOpen) {
          if (!click('Nhận Thiết Kiếm') && !click('Thiết Kiếm')) helper.closeDialog(g);
          return;
        }
        at(g,'duoc_vien',['dai_phu']); return;
      }
      if (!q.biTichUnlocked()) { garden(g); return; }
      if (q.flags.bi_tich_nhan_viec && !q.biTichComplete() && g.Inventory.has(q.MANH_THUONG)) {
        if (collect(g,q.MANH_HA)) return;
        combat(g,'mieu_hoang'); return;
      }
      if (auto(g,false) || stand(g)) return;
      if (!equip(g,'thiet_kiem')) return;
      if (!q.flags.phi_diep_da_trao) {
        if (g.HUD.bagOpen) { press('b'); return; }
        if (g.HUD.dialogOpen) { if (!click('Nhận Task Trang Bị')) helper.closeDialog(g); return; }
        at(g,'tan_vien',['tang_kinh_lao_nhan']); return;
      }
      if (!equip(g,'phi_diep')) return;
      if (g.HUD.bagOpen) { press('b'); return; }
      if (!q.flags.bi_tich_nhan_viec || q.biTichComplete()) {
        if (g.HUD.dialogOpen) {
          if (q.biTichComplete()) {
            const selected=doc.querySelector('#dialog [data-book="bi_tich_hoa_cau"]');
            if (bookSelected && selected?.classList.contains('chon') && click('Nhận Quyển Này')) { bookSelected=false; return; }
            if (selected) { selected.click(); bookSelected=true; return; }
          }
          if (!click('Nhận Việc')) helper.closeDialog(g); return;
        }
        at(g,'tan_vien',['tang_kinh_lao_nhan']); return;
      }
      if (g.HUD.dialogOpen) { helper.closeDialog(g); return; }
      if (!g.Inventory.has(q.MANH_THUONG)) { at(g,'mieu_hoang',[q.MANH_THUONG]); return; }
      combat(g,'mieu_hoang'); return;
    }
    if (q.stage===15) {
      if (!q.stageComplete()) { if (!collect(g,'yeu_cot')) combat(g,'mieu_hoang'); return; }
      if (auto(g,false) || stand(g)) return;
      if (g.HUD.dialogOpen) { if (!click('Báo Công')) helper.closeDialog(g); return; }
      at(g,'tan_vien',['tang_kinh_lao_nhan']); return;
    }
    if (q.stage===16) {
      if (g.Inventory.count(q.DOC_DANG_ITEM)<q.NEED_DOC_DANG) { if (!collect(g,q.DOC_DANG_ITEM)) combat(g,'duoc_vien'); return; }
      if (auto(g,false) || stand(g)) return;
      const caught=(Number(q.flags[q.LINH_NGU_CATCH_FLAG])||0)>=(q.NEED_LINH_NGU||1);
      if (caught && (w.fishing || w.fishingAuto)) {
        for (const type of ['keydown','keyup']) doc.dispatchEvent(new host.KeyboardEvent(type,{key:'ArrowRight',code:'ArrowRight',bubbles:true}));
        return;
      }
      if (g.HUD.dialogOpen) {
        if (caught ? !click('Báo Công') : !click('Thả câu')) helper.closeDialog(g);
        return;
      }
      if (caught) { at(g,'duoc_vien',['dai_phu']); return; }
      if (w.fishing) { phase('FISHING','Chờ câu được Linh Ngư cho Đại Phu.'); return; }
      at(g,'duoc_vien',['ho_bich_thuy_cong','suoi_duoc_coc']);
    }
  }};
};


// src/quests/intro-runner.js
// Complete the introductory main quest through the normal game UI.
A.createIntro = function ({ getGame, doc, host, controller, logger, flight, nativeActions = null, now = Date.now }) {
  const helper = A.createQuestRunner({ getGame, doc, host, controller, logger, flight, now }).movement;
  const later = A.createLaterIntro({ getGame, doc, host, helper, flight, now,
    phase: (...args)=>phase(...args), press: key=>press(key),
    at: (...args)=>at(...args), click: label=>click(label), brew: name=>brew(name) });
  let running = false, state = 'IDLE', message = '', started = 0, last = 0, stage = -1, craftArmed = false, revivePending = 0;
  let stopStage = 17;
  function phase(next, detail) {
    if (state !== next || message !== detail) logger.add('INTRO_STATE', { state: next, detail });
    state = next; message = detail;
  }
  function press(key) {
    for (const type of ['keydown','keyup']) doc.dispatchEvent(new host.KeyboardEvent(type, {key,code:'Key'+key.toUpperCase(),bubbles:true}));
    last = now();
  }
  function stop(detail = 'Đã dừng nhiệm vụ mở đầu.', next = 'STOPPED') {
    const w = getGame()?.SceneWorld;
    if (running && controller.owns('intro') && w?.autoOn) { w.player.setPath([]); press('t'); }
    helper.clear(); running = false; controller.release('intro'); phase(next, detail);
  }
  function at(g, map, ids) {
    if (!helper.travel(g,map)) return;
    const obj = helper.object(g,ids);
    if (!obj) throw Error('Chưa tìm thấy mục tiêu: '+ids.join(', '));
    helper.interact(g,obj);
  }
  function click(label) { if (helper.click(label)) { last = now(); return true; } return false; }
  function brew(name) {
    const detail = doc.querySelector('#dialog .forge-detail h3');
    if (detail?.textContent.trim() === name && craftArmed) {
      const button = Array.from(doc.querySelectorAll('#dialog .forge-detail .bag-detail-actions button'))
        .find(b => !b.disabled && b.textContent.trim() === 'Luyện');
      if (button) { button.click(); last = now(); return true; }
    }
    const slot = Array.from(doc.querySelectorAll('#dialog .forge-slot'))
      .find(b => !b.disabled && b.getAttribute('aria-label')?.startsWith(name + ','));
    if (slot) { slot.click(); craftArmed = true; last = now(); return true; }
    return false;
  }
  function revive(p) {
    if (!p.downed) { revivePending = 0; return false; }
    helper.clear();
    if (now() - revivePending < 3000) { phase('REVIVE', 'Đang chờ hồi sinh để tiếp tục nhiệm vụ.'); return true; }
    const panel = doc.querySelector?.('#downed');
    if (!panel || panel.classList.contains('hidden')) { phase('REVIVE', 'Chờ bảng hồi sinh của game.'); return true; }
    const spot = doc.querySelector?.('#downed-spot');
    const home = doc.querySelector?.('#downed-home');
    const button = spot && !spot.disabled ? spot : home && !home.disabled ? home : null;
    if (!button) { phase('REVIVE', 'Chờ lựa chọn hồi sinh khả dụng.'); return true; }
    button.click(); revivePending = now(); last = revivePending;
    phase('REVIVE', button === spot ? 'Hồi sinh tại chỗ rồi tiếp tục nhiệm vụ.' : 'Về làng hồi sinh rồi tiếp tục nhiệm vụ.');
    return true;
  }
  return {
    status:()=>({running,state,message,stage}), stop,
    start({otherScriptsStopped=false,stopAtStage=17}={}) {
      const g=getGame(), w=g?.SceneWorld;
      const blocked = !otherScriptsStopped || running || !w?.player || w.autoOn || w.autoDC || w.diNV || w.player.state==='sit' || g.HUD.dialogOpen || g.HUD.bagOpen || controller.status().owner;
      if (blocked) {
        if (!running) { logger.add('INTRO_START_BLOCKED',{checked:otherScriptsStopped, running, autoOn:w?.autoOn, autoDC:w?.autoDC, diNV:w?.diNV, downed:w?.player?.downed, state:w?.player?.state, dialog:g.HUD?.dialogOpen, bag:g.HUD?.bagOpen, owner:controller.status().owner}); phase('ERROR','Tắt Auto khác, đứng dậy và đóng menu trước khi chạy nhiệm vụ mở đầu.'); } return false;
      }
      controller.reset?.();
      if (!controller.acquire('intro')) return false;
      stopStage=stopAtStage===14?14:stopAtStage===15?15:17;
      running=true; started=now(); last=0; stage=-1; craftArmed=false; revivePending=0; phase('CHECK','Đọc nhiệm vụ mở đầu.'); return true;
    },
    tick() {
      if (!running) return;
      try {
        const g=getGame(),w=g?.SceneWorld,p=w?.player,q=g?.Quest;
        if (!p || !controller.owns('intro')) return stop('Mất quyền điều khiển.','ERROR');
        if (revive(p)) return;
        if (w.autoDC || w.diNV) return stop('Có Auto khác đang chạy.','ERROR');
        if (now()-started>3600000) return stop('Đã hết 60 phút cho phiên nhiệm vụ chính.','ERROR');
        if (q.stage!==stage) { helper.clear(); craftArmed=false; stage=q.stage; logger.add('INTRO_STAGE',{stage,name:q.stageInfo()?.name}); }
        if (now()-last<900 || w.transitioning || w.brewing || w.ritual || w.ascend || w.qiSurge || p.sitLocked) return;
        if (q.stage>=stopStage) return stop(stopStage===14?'Đã tới Giai đoạn 14; sẵn sàng làm Dược Công.':stopStage===15?'Đã tới Giai đoạn 15; sẵn sàng làm Dược Công.':'Đã hoàn thành nhiệm vụ chính qua Giai đoạn 16.','DONE');
        phase('STAGE_'+stage,q.stageInfo()?.name || 'Nhiệm vụ mở đầu');
        if (stage>=14) { later.tick(g); return; }
        // Garden mobs respawn even after the Linh Thuy objective is complete.
        // Clear them before brewing or sitting, then resume the current objective.
        const gardenThreat = (stage===12 || stage===13 && !q.stageComplete() && !q.daoHanhFull?.()) &&
          w.map.data?.id==='vuon_ca_nhan' &&
          (w.enemies || []).some(e=>['dlt_1','dlt_2'].includes(e.id) && !e.dead && e.hp>0);
        if (gardenThreat) {
          helper.clear(); craftArmed=false;
          if (g.HUD.dialogOpen) { helper.closeDialog(g); return; }
          if (p.state==='sit') { press('q'); return; }
          if (!w.autoOn) press('t');
          phase('COMBAT','Dọn Dược Linh Thú hồi lại rồi tiếp tục nhiệm vụ.'); return;
        }
        if (stage!==5 && stage!==6 && stage!==11 && w.autoOn) { p.setPath([]); press('t'); p.setPath([]); return; }
        if (stage<=1) {
          if (g.HUD.dialogOpen) { if (!click('Nhận Việc')) helper.closeDialog(g); return; }
          at(g,'tan_vien',['su_phu']); return;
        }
        if (stage===2) {
          if (g.HUD.dialogOpen) { helper.closeDialog(g); return; }
          if (!helper.travel(g,'tan_vien')) return;
          const rows=(w.map.props||[]).filter(o=>o.type==='herb'&&!o.hidden);
          rows.sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y));
          if (!rows.length) { phase('WAIT_HERBS','Chờ Tẩy Uế Thảo mọc lại.'); return; }
          helper.interact(g,helper.object(g,[rows[0].id])); return;
        }
        if (stage===3 || stage===4&&!g.Inventory.has('tay_tuy_thang')) {
          if (g.HUD.dialogOpen) {
            const detail=doc.querySelector('#dialog .forge-detail h3');
            if (detail?.textContent.trim()==='Tẩy Tuỷ Thang' && craftArmed) {
              const button=Array.from(doc.querySelectorAll('#dialog .forge-detail .bag-detail-actions button')).find(b=>!b.disabled&&b.textContent.trim()==='Luyện');
              if (button) { button.click(); last=now(); } return;
            }
            const slot=Array.from(doc.querySelectorAll('#dialog .forge-slot')).find(b=>b.getAttribute('aria-label')?.startsWith('Tẩy Tuỷ Thang,'));
            if (slot) { slot.click(); craftArmed=true; last=now(); return; }
            const tab=doc.querySelector('#dialog [data-muc="dan-khac"]');
            if (tab && tab.getAttribute('aria-selected')!=='true') { tab.click(); last=now(); return; }
            if (!click('Tẩy Tuỷ Thang')) helper.closeDialog(g); return;
          }
          at(g,'tan_vien',['dan_lo']); return;
        }
        if (stage===4) {
          if (g.HUD.dialogOpen) { if (!click('Uống Thang & Đả Tọa')&&!click('Phạt Mao Lần Nữa')) helper.closeDialog(g); return; }
          at(g,'tan_vien',['dai_da']); return;
        }
        if (p.state==='sit' && stage!==13) { press('q'); return; }
        if (stage===5 && !q.flags.nhan_viec_ly_thanh || stage===6 && q.stageComplete()) {
          if (w.autoOn) { p.setPath([]); press('t'); return; }
          if (g.HUD.dialogOpen) { if (!click(stage===5?'Nhận Việc':'Báo Công')) helper.closeDialog(g); return; }
          at(g,'thanh_truc_lam',['ly_thanh']); return;
        }
        if (stage===5 || stage===6) {
          if (!helper.travel(g,'thanh_truc_lam')) return;
          if (g.HUD.dialogOpen) { helper.closeDialog(g); return; }
          if (!q.daCamTrucKiem()) {
            phase('EQUIP','Trang bị Trúc Kiếm.');
            if (!g.HUD.bagOpen) { press('b'); return; }
            const equip=Array.from(doc.querySelectorAll('#bag-detail .bag-detail-actions button')).find(b=>!b.disabled&&b.textContent.trim()==='Trang Bị');
            if (doc.querySelector('#bag-detail h3')?.textContent.trim()==='Trúc Kiếm' && equip) { equip.click(); last=now(); return; }
            const item=doc.querySelector('#bag-list [data-item="truc_kiem"]');
            if (item) { item.click(); last=now(); return; }
            const filter=doc.querySelector('#bag [data-filter="trang-bi"]');
            if (filter) { filter.click(); last=now(); } return;
          }
          if (g.HUD.bagOpen) { press('b'); return; }
          const kills=stage===5?q.kills:q.patrolKills, need=stage===5?q.NEED_KILLS:q.NEED_PATROL_KILLS;
          if (kills<need) { if (!w.autoOn) press('t'); return; }
          if (w.autoOn) { p.setPath([]); press('t'); p.setPath([]); return; }
          const ids=q.CLUE_IDS.filter(id=>!g.Progress.isHarvested(id));
          if (ids.length) { at(g,'thanh_truc_lam',ids); return; }
          return;
        }
        if (stage===7) {
          if (g.HUD.dialogOpen) { if (!click('Nhận Hạt Giống')) helper.closeDialog(g); return; }
          at(g,'duoc_vien',['dai_phu']); return;
        }
        if (stage===8) {
          if (g.HUD.dialogOpen) {
            if (click('Gieo Hạt Linh Diệp') || click('Gieo Hạt Huyết Thảo') || click('Múc nước')) return;
            helper.closeDialog(g); return;
          }
          if (!helper.travel(g,'vuon_ca_nhan')) return;
          const targets=[['linh_diep','hat_linh_diep'],['huyet_thao','hat_huyet_thao']];
          const plots=Array.from({length:g.Farm?.PLOT_COUNT||10},(_,i)=>'plot_'+(i+1));
          const ready=plots.find(id=>g.Farm?.ready(id));
          if (ready) { at(g,'vuon_ca_nhan',[ready]); return; }
          const dry=plots.find(id=>g.Farm?.canWater(id));
          if (dry && !g.Farm?.hasWaterAccess?.()) { at(g,'vuon_ca_nhan',['ho_bich_thuy']); return; }
          if (dry) { at(g,'vuon_ca_nhan',[dry]); return; }
          for (const [crop,seed] of targets) {
            const growing=plots.filter(id=>g.Farm?.plot(id)?.seed===seed).length;
            if ((g.Inventory.count(crop)||0)+growing>=5) continue;
            const empty=plots.find(id=>!g.Farm?.plot(id));
            if (empty && g.Inventory.count(seed)>0) { at(g,'vuon_ca_nhan',[empty]); return; }
          }
          phase('WAIT_GARDEN','Chờ Linh Diệp và Huyết Thảo chín để thu hoạch.'); return;
        }
        if (stage===9) {
          if (g.HUD.dialogOpen) {
            if (!brew('Linh Dược')) helper.closeDialog(g);
            return;
          }
          at(g,'vuon_ca_nhan',['dan_lo_vuon']); return;
        }
        if (stage===10) {
          if (g.HUD.dialogOpen) {
            if (!click('Uống Dược & Vận Công') && !click('Phá Quan Ngay') && !click('Bắt Đầu Phá Quan')) helper.closeDialog(g);
            return;
          }
          at(g,'vuon_ca_nhan',['dai_da_duoc']); return;
        }
        if (stage===11) {
          const enough = q.duLinhThuy?.() || (g.Inventory.count('linh_thuy') >= (q.NEED_LINH_THUY || 2));
          if (enough) { phase('WAIT_ADVANCE','Đã đủ Linh Thúy, chờ game chuyển giai đoạn.'); return; }
          if (!helper.travel(g,'vuon_ca_nhan')) return;
          if (g.HUD.dialogOpen) { helper.closeDialog(g); return; }
          if (p.state === 'sit') { press('q'); return; }
          if (!w.autoOn) { phase('COMBAT','Đánh Dược Linh Thú để lấy Linh Thúy.'); press('t'); }
          return;
        }
        if (stage===12) {
          if (g.HUD.dialogOpen) {
            if (!brew('Tụ Khí Đan')) helper.closeDialog(g);
            return;
          }
          at(g,'vuon_ca_nhan',['dan_lo_vuon']); return;
        }
        if (stage===13) {
          if (q.stageComplete()) {
            if (p.state === 'sit') { press('q'); return; }
            if (g.HUD.dialogOpen) { if (!click('Báo Công & Bái Tạ')) helper.closeDialog(g); return; }
            at(g,'duoc_vien',['dai_phu']); return;
          }
          if (g.HUD.dialogOpen) {
            if (!click('Bắt Đầu Phá Quan') && !click('Phá Quan Ngay')) helper.closeDialog(g);
            return;
          }
          if (!helper.travel(g,'vuon_ca_nhan')) return;
          if (p.state === 'sit') {
            if (q.daoHanhFull?.()) press('q');
            else phase('MEDITATE','Tọa thiền ở đài đá, tích Đạo Hạnh cho cửa quan kế tiếp.');
            return;
          }
          at(g,'vuon_ca_nhan',['dai_da_duoc']); return;
        }
      } catch(error) { stop(error.message,'ERROR'); }
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
  const p=g.SceneWorld?.player;
  const exp=Number(p?.exp ?? g.Progress?.exp)||0;
  const expMax=Number(p?.expMax)||0;
  const full=typeof q?.daoHanhFull==='function'?q.daoHanhFull():expMax>0&&exp>=expMax;
  return { plots, water: farm.hasWaterAccess(), duocCong: g.Progress?.duocCong || 0,
    experience: {current:exp,target:expMax,full},
    breakthrough: check ? { ready: !!check.ready, blocked: check.blocked || null, next: check.next?.id || null, nextName:check.next?.name||null,
      conditions: (check.lines||[]).map(line => ({ label: line.label, current: line.current, target: line.target, done: line.done })) } : null,
    seeds: farm.seedsInBag().map(row => ({ id: row.def.seed, crop: row.def.crop, qty: row.qty })),
    goal: recipe ? { id: recipe.id, name: recipe.name, need: rule.qty || 1, have: count(recipe.id),
      materials: recipe.recipe.map(m => ({ id: m.id||m.any?.[0], qty: m.qty, have: q.recipeHave?q.recipeHave(m):count(m.id),
        name:m.label||g.ITEMS?.[m.id]?.name||m.id, required:m.qty*Math.max(0,(rule.qty||1)-count(recipe.id)) })) } : null };
};


// src/farm/garden-planner.js
// Read-only decision for the NEXT breakthrough, recalculated after every result.
A.planGarden = function (g,data,{spent=0,shopDisabled=false}={}) {
  if (!data) throw Error('Chưa đọc được điều kiện vườn và đột phá.');
  const plan=data.goal,plots=data.plots||[];
  const alive=(g.SceneWorld.enemies||[]).filter(e=>['dlt_1','dlt_2'].includes(e.id)&&!e.dead&&e.hp>0);
  const needExp=!data.experience?.full;
  if (data.breakthrough?.ready && !data.breakthrough.blocked) return {kind:'ascend'};
  if (needExp && alive.length) return {kind:'combat',reason:'Tích Đạo Hạnh cho cửa quan kế tiếp.'};
  const mature=plots.find(p=>p.ready);
  if (mature) return {kind:'harvest',row:mature};
  const needPill=plan && plan.have<plan.need;
  if (needPill && plan.materials.every(m=>m.have>=m.qty) &&
      (g.Game?.time||0)>=(g.SceneWorld.brewCooldownUntil||0)) return {kind:'brew',recipe:plan};
  const dry=plots.find(p=>p.dry);
  if (dry) return data.water?{kind:'water',row:dry}:{kind:'waterAccess'};
  let resourceMessage='';
  if (needPill) {
    const empty=plots.find(p=>!p.seed),wanted=new Set();
    const needed=m=>m.required ?? m.qty*(plan.need-plan.have);
    if (empty) for (const seed of data.seeds||[]) {
      const m=plan.materials.find(m=>m.id===seed.crop);
      if (m && m.have+plots.filter(p=>p.crop===seed.crop).length<needed(m) && seed.qty>0) {
        return {kind:'sow',row:empty,seed:seed.id,recipe:plan.name};
      }
    }
    for (const m of plan.materials) {
      const def=(g.Farm?.SEEDS||[]).find(s=>s.crop===m.id);
      if (!def) continue;
      const stock=m.have+plots.filter(p=>p.crop===m.id).length+
        ((data.seeds||[]).find(s=>s.id===def.seed)?.qty||0);
      if (stock<needed(m)) wanted.add(def.seed);
    }
    if (wanted.size) {
      const packs=(g.Quest?.SEED_PACKS||[]).filter(p=>g.Quest.packUnlocked?.(p) && p.give.some(([id])=>wanted.has(id)));
      packs.sort((a,b)=>a.cost-b.cost);
      const pack=!shopDisabled && packs.find(p=>p.cost<=data.duocCong && spent+p.cost<=30);
      if (pack) return {kind:'buySeeds',pack,seed:pack.give.find(([id])=>wanted.has(id))[0]};
      resourceMessage=shopDisabled?'Chưa xác nhận đổi hạt; cần kiểm tra quầy Đại Phu.':
        packs.length?'Thiếu điểm Dược Công hoặc đã hết hạn mức đổi hạt của phiên.':'Chưa có gói hạt mở phù hợp nguyên liệu còn thiếu.';
    }
  }
  if (alive.length) return {kind:'combat',reason:plots.some(p=>p.seed)?'Đánh quái trong lúc chờ cây lớn.':'Săn Linh Thúy và tài nguyên trong vườn.'};
  if (needExp) return {kind:'meditate'};
  if (plots.some(p=>p.seed && !p.ready)) return {kind:'waitGarden',reason:'Đạo Hạnh đã đầy; chờ cây lớn để luyện '+(plan?.name||'đan')+'.'};
  return {kind:'waitResources',reason:resourceMessage || data.breakthrough?.blocked ||
    (needPill?'Còn thiếu nguyên liệu cho '+plan.name+'.':'Chờ đủ các điều kiện đột phá của game.')};
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
        // The game's dialog deliberately suppresses clicks during its first
        // 500ms. Wait for that guard to pass before invoking the normal button
        // callback; an early .click() silently leaves the modal untouched.
        const openedAt = Number(g.HUD._dialogOpenedAt) || 0;
        if (openedAt && Date.now() - openedAt < 600) return true;
        const latest = g.Breakthrough.check(p);
        if (!latest.ready || latest.blocked || latest.next?.id !== check.next.id) return false;
        // The standard dialog callback closes the modal and sends the game's
        // expected breakthrough action. Verify it ran before latching a request.
        button.click();
        if (g.HUD.dialogOpen) return true;
        pending = { from: p.realmId, to: check.next.id, at: now() };
        logger.add('ASCENSION_REQUEST', { from: pending.from, to: pending.to });
        return true;
      }
      interactWithStone(); return true;
    }
  };
};


// src/farm/garden-runner.js
A.createGarden = function ({ getGame, doc, host, logger, controller, navigation, flight, ascension = null, nativeActions = null, now = Date.now }) {
  let running = false, state = 'IDLE', message = '', traveling = false, lastAction = 0, goal = null;
  let move = null, started = 0, expStart = 0, pillStart = 0, craftArmed = false;
  let pendingSow = null, sowFailures = 0;
  let pendingHarvest = null;
  let pendingBrew = null, objective = null;
  let settled = null;
  let shop = null, destination = 'vuon_ca_nhan', spent = 0, shopDisabled = false;
  let recoveringHp = false, healTrip = null;
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
  function recoverHealth(g) {
    const w = g?.SceneWorld, p = w?.player;
    if (!p || !Number.isFinite(p.hp) || !Number.isFinite(p.hpMax) || p.hpMax <= 0) return false;
    if (!recoveringHp && p.hp >= p.hpMax * .4) return false;
    if (!recoveringHp) {
      recoveringHp = true;
      healTrip = 'OUTBOUND';
      logger.add('GARDEN_HEAL_START', { hp: p.hp, hpMax: p.hpMax });
    }
    clear();
    if (healTrip === 'OUTBOUND') {
      if (w.autoOn) {
        p.setPath?.([]);
        if (now() - lastAction >= 1000) press('t');
        return true;
      }
      if (g.HUD?.dialogOpen) { close(); return true; }
      if (g.HUD?.bagOpen) { if (now() - lastAction >= 1000) press('b'); return true; }
      if (p.state === 'sit') { if (now() - lastAction >= 1000) press('q'); return true; }
      if (w.map.data.id !== 'duoc_vien') {
        travelTo('duoc_vien');
        phase('HEAL_TRAVEL', 'HP thấp; đang rời vườn đến Dược Viên để hồi máu.');
        return true;
      }
      healTrip = 'RESTING';
    }
    if (healTrip === 'RESTING') {
      phase('HEAL', `Đang hồi HP tại Dược Viên: ${Math.floor(p.hp)}/${p.hpMax}.`);
      if (p.hp < p.hpMax * .65) {
        if (p.state !== 'sit' && now() - lastAction >= 1000) press('q');
        return true;
      }
      if (p.state === 'sit') { if (now() - lastAction >= 1000) press('q'); return true; }
      if (shop) {
        recoveringHp = false; healTrip = null;
        phase('BUY_SEEDS', 'Đã hồi HP, tiếp tục đổi hạt.');
        return false;
      }
      healTrip = 'RETURNING';
      travelTo('vuon_ca_nhan');
      phase('HEAL_TRAVEL', 'HP đã hồi trên 65%; đang quay lại vườn.');
      return true;
    }
    if (healTrip === 'RETURNING' && w.map.data.id === 'vuon_ca_nhan') {
      recoveringHp = false; healTrip = null;
      logger.add('GARDEN_HEAL_DONE', { hp: p.hp, hpMax: p.hpMax });
      phase('CHECK', 'Đã hồi máu và quay lại vườn.');
      return false;
    }
    return true;
  }
  function close() { const b = doc.querySelector('#dialog-close'); if (b) b.click(); lastAction = now(); }
  function click(selector, prefix) {
    const matches = Array.from(doc.querySelectorAll(selector)).filter(b => !b.disabled && b.getClientRects().length &&
      (b.textContent.trim().startsWith(prefix) || b.getAttribute('aria-label')?.startsWith(prefix)));
    if (matches.length !== 1) return false;
    matches[0].click();
    lastAction = now(); logger.add('GARDEN_CLICK', { label: prefix }); return true;
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
  function interact(g, id, onReach = null) {
    const m = g.SceneWorld.map, p = g.SceneWorld.player;
    const obj = [...(m.props || []), ...(m.flatProps || []), ...(m.interactables || [])].find(o => o.id === id && !o.hidden);
    if (!obj) throw Error('Không tìm thấy ' + id);
    const target = { x: obj.x, y: obj.y - ((m.interactables || []).includes(obj) ? 0 : g.CONFIG.TILE / 2) };
    if (!go(g, target, obj.type === 'meditate_stone' ? 8 : obj.type === 'herb_plot' ? 20 : 36)) return false;
    // Let the server receive the final position before committing plot actions.
    if (obj.type === 'herb_plot') {
      if (!settled || settled.id !== id || Math.hypot(p.x - settled.x, p.y - settled.y) > 3) {
        settled = { id, x: p.x, y: p.y, at: now() }; return false;
      }
      if (now() - settled.at < 1200) return false;
    }
    const t = g.Targeting;
    for (let i = 0; i < (t.list?.length || 0) * 2 + 4; i++) {
      const selected = t.current();
      if (selected?.obj === obj && selected.dist <= selected.r) {
        if (onReach) return onReach();
        press('e'); return true;
      }
      t.cycle();
    }
    return false;
  }
  function stop(detail = 'Đã dừng vườn.', next = 'STOPPED') {
    nativeActions?.cancel();
    if (traveling) navigation.stop(detail);
    const g = getGame();
    if (running && controller.owns('garden') && g?.SceneWorld?.autoOn) { g.SceneWorld.player?.setPath?.([]); press('t'); g.SceneWorld.player?.setPath?.([]); }
    clear(); running = false; traveling = false; goal = null; shop = null; recoveringHp = false; healTrip = null; controller.release('garden'); phase(next, detail);
  }
  return {
    status: () => ({ running, state, message, goal: goal ? { kind: goal.kind, id: goal.id } : null,
      movement: move ? { tries: move.tries, issued: move.issued } : null, seedCost: spent, shopping: shop?.name || null, objective }), stop,
    start({ otherScriptsStopped = false } = {}) {
      const g = getGame(), w = g?.SceneWorld;
      if (running || !otherScriptsStopped || !w?.player || w.autoOn || w.autoDC || w.diNV || w.player.downed || w.player.state === 'sit') return false;
      if (controller.status().owner) return false;
      if (g.HUD?.bagOpen || g.HUD?.dialogOpen) { phase('ERROR', 'Đóng hành trang/hội thoại trước khi vào vườn.'); return false; }
      running = true; started = now(); expStart = w.player.exp || 0;
      spent = 0; shopDisabled = false; shop = null; pendingSow = null; sowFailures = 0; destination = 'vuon_ca_nhan'; recoveringHp = false; healTrip = null;
      pendingHarvest = null; pendingBrew = null; objective = null; ascension?.reset();
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
        if (!controller.owns('garden') || (w?.map?.data?.id !== 'vuon_ca_nhan' && !shop && !(recoveringHp && w?.map?.data?.id === 'duoc_vien'))) return stop('Đã rời vườn hoặc mất quyền điều khiển.');
        if (!p || p.downed) return stop('Nhân vật đang gục hoặc không sẵn sàng.', 'ERROR');
        if (now() - started > 3600000) return stop('Đã đạt thời gian một phiên vườn.');
        if (w.autoDC || w.diNV) return stop('Có tác vụ khác đang điều khiển.');
        if (w.transitioning) return;
        if (recoverHealth(g)) return;
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
            if (click('#dialog button', 'Đổi ' + shop.name)) {
              const confirm = Array.from(doc.querySelectorAll('#dialog button')).some(button =>
                button.getClientRects().length && button.textContent.trim().startsWith('Vẫn đổi ' + shop.name));
              if (!confirm) shop.issued = now();
              return;
            }
            if (click('#dialog button', 'Mở Quầy Đổi Hạt')) return;
            if (click('#dialog button', 'Sổ Dược Công')) return;
            close(); return;
          }
          interact(g, 'dai_phu'); return;
        }
        if (!Array.isArray(w.enemies)) return stop('Chưa đọc được danh sách quái trong vườn.', 'ERROR');
        const targets = w.enemies.filter(e => enemies.includes(e.id));
        const alive = targets.filter(e => !e.dead && e.hp > 0);
        const data = A.readGarden(g), plan = data?.goal;
        const decision = A.planGarden(g,data,{spent,shopDisabled});
        objective={next:data.breakthrough?.nextName||data.breakthrough?.next||null,
          experience:data.experience||null,pill:plan||null,action:decision.kind};
        // Finish the current short garden action and confirm its result before
        // resuming combat. Otherwise fast respawns cancel movement/dialogs and
        // native sow requests over and over without ever committing a seed.
        const gardenActionPending = !!(goal || pendingSow || pendingHarvest || pendingBrew);
        if (decision.kind==='combat' && !gardenActionPending) {
          nativeActions?.cancel();
          goal = null; craftArmed = false; settled = null; clear();
          if (g.HUD.dialogOpen) { close(); return; }
          if (p.state === 'sit') { press('q'); return; }
          if (!w.autoOn) { press('t'); return; }
          phase('COMBAT', 'Đánh ' + alive.length + ' quái. '+decision.reason); return;
        }
        if (w.autoOn) { p.setPath([]); press('t'); p.setPath([]); move = null; return; }
        if (pendingBrew) {
          if (g.Inventory.count(pendingBrew.id)>pendingBrew.before) {
            logger.add('GARDEN_BREW_CONFIRMED',{id:pendingBrew.id}); pendingBrew=null;
          } else if (now()-pendingBrew.at<15000) return;
          else throw Error('Game chưa xác nhận luyện đan; dừng để tránh luyện lặp.');
        }
        if (decision.kind==='ascend' && !gardenActionPending) {
          if (p.state==='sit') { press('q');return; }
          if (g.HUD.dialogOpen && doc.querySelector('#dialog-title')?.textContent.trim()!=='Đột Phá Cảnh Giới') { close();return; }
          if (ascension?.tick(() => interact(g, 'dai_da_duoc'))) {
            phase('ASCEND','Đã đủ kinh nghiệm và vật phẩm; phá quan '+(data.breakthrough.nextName||'cảnh giới kế tiếp')+'.');return;
          }
          return stop('Cửa quan này cần thao tác đặc biệt chưa có bộ tự chạy.','NEEDS_MANUAL');
        }
        if (pendingHarvest) {
          if (!g.Farm.plot(pendingHarvest.id) && g.Inventory.count(pendingHarvest.crop) > pendingHarvest.before) {
            logger.add('GARDEN_HARVEST_CONFIRMED', { plot: pendingHarvest.id, crop: pendingHarvest.crop }); pendingHarvest = null;
          } else if (now() - pendingHarvest.at < 3000) return;
          else throw Error('Chưa xác nhận thu hoạch; dừng để kiểm tra luống và túi đồ.');
        }
        if (pendingSow) {
          if (now() - pendingSow.at < 1800) return;
          if (data.plots.find(row => row.id === pendingSow.id)?.seed === pendingSow.seed) {
            logger.add('GARDEN_SOW_CONFIRMED', { plot: pendingSow.id, seed: pendingSow.seed }); pendingSow = null; sowFailures = 0;
          } else if (now() - pendingSow.at < 3000) return;
          else {
            logger.add('GARDEN_SOW_UNCONFIRMED', { plot: pendingSow.id }); pendingSow = null; sowFailures++;
            if (sowFailures>=2) throw Error('Game chưa xác nhận gieo hạt sau 2 lần; dừng để kiểm tra, chưa coi là đã trồng xong.');
          }
        }
        if (goal) {
          if (p.state === 'sit') { press('q'); return; }
          if (goal.kind === 'waterAccess' && g.HUD.dialogOpen) {
            if (!click('#dialog button', 'Múc nước')) close();
            goal = null; return;
          }
          if (goal.kind === 'sow') {
            if (g.HUD.dialogOpen) { close(); return; }
            // Use the same Farm.sow game action used by the dialog's choice
            // callback. The planner already selected this exact missing seed;
            // the dialog, desktop cursor and mouse helper are unnecessary.
            interact(g, goal.id, () => {
              if (!g.Farm?.isEmpty?.(goal.id)) throw Error('Luống không còn trống; đọc lại vườn trước khi gieo.');
              if (!g.Inventory?.has?.(goal.seed, 1)) throw Error('Không còn hạt đã chọn trong túi.');
              const plotId = goal.id, seed = goal.seed;
              if (!g.Farm.sow(plotId, seed)) throw Error('Game không nhận thao tác gieo hạt.');
              g.Farm.syncProps?.(w.map);
              if (g.HUD.dialogOpen) g.HUD.closeDialog?.();
              logger.add('GARDEN_SOW_REQUEST', { plot: plotId, seed });
              pendingSow = { id: plotId, seed, at: now() };
              goal = null; lastAction = now();
              return true;
            });
            return;
          }
          if (goal.kind === 'brew' && g.HUD.dialogOpen) {
            const detail = doc.querySelector('#dialog .forge-detail h3');
            const before=g.Inventory.count(goal.recipe);
            if (detail?.textContent.trim() === goal.name && craftArmed && click('#dialog .forge-detail .bag-detail-actions button', 'Luyện')) {
              logger.add('GARDEN_BREW_REQUEST', { id: goal.recipe });
              pendingBrew={id:goal.recipe,before,at:now()};
              goal = null; craftArmed = false; return;
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
        if (decision.kind==='harvest' || decision.kind==='water') {
          const row=decision.row;
          goal={kind:decision.kind,id:row.id,crop:row.crop,before:row.crop?g.Inventory.count(row.crop):0};
          phase('GARDEN_WORK',decision.kind==='harvest'?'Thu hoạch nguyên liệu đã chín.':'Tưới cây cho mau thu hoạch.');return;
        }
        if (decision.kind==='waterAccess') {
          goal = { kind: 'waterAccess', id: 'ho_bich_thuy' };
          return;
        }
        if (decision.kind==='brew') {
          goal={kind:'brew',id:'dan_lo_vuon',recipe:decision.recipe.id,name:decision.recipe.name};
          phase('BREW','Đủ nguyên liệu; luyện '+decision.recipe.name+' để đột phá.');return;
        }
        if (decision.kind==='sow') {
          const obj=w.map.props.find(o=>o.id===decision.row.id);
          if (!obj) throw Error('Không tìm thấy luống trồng đã chọn.');
          goal={kind:'sow',id:obj.id,name:obj.name,seed:decision.seed};
          phase('SOW','Gieo đúng nguyên liệu cho '+decision.recipe+'.');return;
        }
        if (decision.kind==='buySeeds') {
          if (p.state==='sit') { press('q');return; }
          const pack=decision.pack,seed=decision.seed;
          shop={id:pack.id,name:pack.name,cost:pack.cost,seed,before:g.Inventory.count(seed),dc:data.duocCong,issued:0};
          travelTo('duoc_vien','dai_phu');phase('BUY_SEEDS','Đổi '+pack.name+' · '+pack.cost+' Dược Công.');return;
        }
        if (decision.kind==='waitResources') {
          // Keep polling the planner so newly spawned monsters are fought even
          // when the next seed pack cannot currently be purchased.
          phase('WAIT_RESOURCES',decision.reason);return;
        }
        if (decision.kind==='waitGarden') {
          phase('WAIT_GARDEN',decision.reason);
          // Full EXP without the required pill must not repeatedly open the
          // stone's failed-breakthrough dialog. Rest there while waiting instead.
          if (p.state!=='sit') {
            const stone=[...(w.map.props||[]),...(w.map.flatProps||[]),...(w.map.interactables||[])]
              .find(o=>o.id==='dai_da_duoc'&&!o.hidden);
            if (!stone) return;
            if (go(g,{x:stone.x,y:stone.y-g.CONFIG.TILE/2},8)) press('q');
          }
          return;
        }
        if (p.state !== 'sit') {
          phase('RETURN_TO_STONE', 'Về đài đá tăng Đạo Hạnh.'); interact(g, 'dai_da_duoc'); return;
        }
        phase('MEDITATE', 'Tọa thiền tại bệ đá · Đạo Hạnh '+Math.floor(data.experience?.current||p.exp||0)+'/'+(data.experience?.target||p.expMax||'?'));
        if ((g.Inventory?.count('pha_canh_dan') || 0) > pillStart) {
          logger.add('GARDEN_PILLS_OBSERVED', { count: g.Inventory.count('pha_canh_dan') }); pillStart = g.Inventory.count('pha_canh_dan');
        }
      } catch (error) { stop(error.message, 'ERROR'); }
    }
  };
};


// src/core/auto-runner.js
// One scheduler selects and hands control to exactly one existing worker.
A.createAutoRunner = function ({ getGame, doc, host, intro, quests, garden, navigation,
  nativeActions, controller, logger, combatSkills = null, now = Date.now }) {
  let running=false, state='IDLE', message='', worker=null, next=null, pending=[];
  let reviveAt=0, preparingAt=0, healing=false;
  let inputUntil=0;
  const workers={INTRO:intro,QUESTS:quests,GARDEN:garden};
  function phase(s,m) {
    if (state!==s || message!==m) logger.add('AUTO_STATE',{state:s,message:m});
    state=s;message=m;
  }
  function press(key) {
    if (key.startsWith('Arrow')) {
      doc.dispatchEvent(new host.KeyboardEvent('keydown',{key,code:key,bubbles:true}));
      host.setTimeout(()=>doc.dispatchEvent(new host.KeyboardEvent('keyup',{key,code:key,bubbles:true})),80);
      inputUntil=now()+200;return;
    }
    for (const type of ['keydown','keyup']) doc.dispatchEvent(new host.KeyboardEvent(type,{
      key,code:key.startsWith('Arrow')?key:'Key'+key.toUpperCase(),bubbles:true
    }));
  }
  function stopWorkers(reason) {
    nativeActions.cancel();
    for (const w of Object.values(workers)) if (w.status().running) w.stop(reason);
    if (navigation.status().running) navigation.stop(reason);
    worker=null;
  }
  function stop(reason='Đã dừng Auto tổng.',s='STOPPED') {
    if (running) stopWorkers(reason);
    combatSkills?.reset();running=false;next=null;healing=false;phase(s,reason);
  }
  function prepare(target) {
    next=target;worker=null;healing=false;preparingAt=now();
    phase('PREPARE',target==='INTRO'?'Chuẩn bị làm nhiệm vụ đến Giai đoạn 15.':
      target==='QUESTS'?'Chuẩn bị làm việc Dược Công ở Đại Phu.':'Chuẩn bị vào vườn đánh quái, chăm cây và luyện đan.');
  }
  function catalog(g) {
    const c=A.readDuocCong(g);
    pending=c.tasks.filter(t=>t.status==='NEEDS_ADAPTER').map(t=>t.name);
    return c;
  }
  function gardenAfterQuests(c) {
    if (c.active) return stop('Đang giữ việc chưa tự làm được: '+c.active.name+'. Nhiệm vụ vẫn được giữ nguyên.','NEEDS_MANUAL');
    prepare('GARDEN');
  }
  return {
    status:()=>({running,state,message,worker,next,pending:[...pending]}),stop,
    start({otherScriptsStopped=false}={}) {
      const g=getGame(),w=g?.SceneWorld;
      if (running) return false;
      if (!otherScriptsStopped || !w?.player || !Number.isInteger(g?.Quest?.stage)) {
        phase('ERROR','Cần vào game và xác nhận đã tắt các script Auto khác.');return false;
      }
      if (Object.values(workers).some(w=>w.status().running) || navigation.status().running || controller.status().owner) {
        phase('ERROR','Dừng chức năng đang chạy trước khi bật Auto tổng.');return false;
      }
      if (w.autoDC || w.diNV) { phase('ERROR','Tắt Auto Dược Công/tự đi của game trước khi bật Auto tổng.');return false; }
      controller.reset();combatSkills?.reset();running=true;pending=[];reviveAt=0;
      prepare(g.Quest.stage<15?'INTRO':'QUESTS');return true;
    },
    tick() {
      if (!running) return;
      try {
        const g=getGame(),w=g?.SceneWorld,p=w?.player;
        if (!p || !Number.isInteger(g.Quest?.stage)) return stop('Mất dữ liệu nhân vật.','ERROR');
        if (p.downed) {
          const resume=worker||next||(g.Quest.stage<15?'INTRO':'QUESTS');
          if (worker) stopWorkers('Tạm dừng để hồi sinh.');
          next=resume;
          phase('REVIVE','Hồi sinh rồi tiếp tục luồng '+resume+'.');
          if (now()-reviveAt<3000) return;
          const panel=doc.querySelector('#downed');
          if (!panel || panel.classList.contains('hidden')) return;
          const spot=doc.querySelector('#downed-spot'),home=doc.querySelector('#downed-home');
          const b=spot&&!spot.disabled?spot:home&&!home.disabled?home:null;
          if (b) { b.click();reviveAt=now(); }
          return;
        }
        if (state==='REVIVE') { prepare(next);return; }
        if (w.autoDC || w.diNV) return stop('Có Auto khác của game đang chạy.','ERROR');
        if (worker==='INTRO' && g.Quest.stage>=15) {
          intro.stop('Đã tới Giai đoạn 15; chuyển sang Đại Phu.');worker=null;
          prepare('QUESTS');return;
        }
        if (worker) {
          const s=workers[worker].status();
          if (s.running) return;
          if (worker==='QUESTS' && ['DONE','PENDING_ACTIVITIES'].includes(s.state)) {
            const c=catalog(g);
            if (!c.available) return stop('Chưa đọc được danh sách việc Đại Phu.','ERROR');
            if (!c.active && c.tasks.some(t=>t.status==='READY')) return stop('Luồng Dược Công kết thúc khi vẫn còn việc có thể làm.','ERROR');
            gardenAfterQuests(c);return;
          }
          if (worker==='INTRO' && s.state==='DONE' && g.Quest.stage>=15) { prepare('QUESTS');return; }
          return stop(s.message||'Chức năng '+worker+' đã dừng.',s.state==='ERROR'?'ERROR':'STOPPED');
        }
        if (state!=='PREPARE') return;
        if (now()<inputUntil) return;
        if (now()-preparingAt>300000) return stop('Chuẩn bị quá 5 phút chưa xong.','ERROR');
        if (w.transitioning || w.brewing || w.ritual || w.ascend || w.qiSurge || w.foundationBreakthrough || p.sitLocked) return;
        if (g.HUD?.dialogOpen) { doc.querySelector('#dialog-close')?.click();return; }
        if (g.HUD?.bagOpen && !combatSkills?.status().configuring) { press('b');return; }
        if (w.autoOn) { p.setPath([]);press('t');p.setPath([]);return; }
        if (w.fishing || w.fishingAuto || w.chopping) { press('ArrowRight');return; }
        if (p.hp<p.hpMax*.4) healing=true;
        if (healing && p.hp<p.hpMax*.65) {
          if (p.state!=='sit') press('q');
          return;
        }
        healing=false;
        if (p.state==='sit') { press('q');return; }
        if (next==='INTRO' && g.Quest.stage>=15) next='QUESTS';
        if (next==='QUESTS') {
          if (typeof g.Quest.canOpenSeedMenu==='function' && !g.Quest.canOpenSeedMenu()) return stop('Nhân vật chưa mở được sổ việc Đại Phu.','ERROR');
          const c=catalog(g);
          if (!c.available) return stop('Chưa đọc được danh sách việc Đại Phu.','ERROR');
          if (c.active && !(c.active.supported || c.tasks.some(t=>t.id===c.active.id && t.status==='READY'))) { gardenAfterQuests(c);return; }
          if (!c.active && !c.tasks.some(t=>t.status==='READY')) { gardenAfterQuests(c);return; }
        }
        const target=next;
        if (combatSkills && !combatSkills.prepare()) return;
        const started=workers[target].start({otherScriptsStopped:true,stopAtStage:15});
        if (!started) return stop(workers[target].status().message||'Chưa khởi động được '+target+'.','ERROR');
        worker=target;next=null;
        phase(target,target==='INTRO'?'Làm nhiệm vụ giai đoạn đến mốc 15.':target==='QUESTS'?
          'Làm các việc Dược Công ở Đại Phu.':pending.length?
          'Vào vườn; còn '+pending.length+' loại việc chưa hỗ trợ, xem danh sách bên dưới.':
          'Đã hết lượt Dược Công có thể làm; vào vườn đánh quái và chăm cây.');
      } catch(e) { stop(e.message,'ERROR'); }
    }
  };
};


// src/ui/native-actions.js
// Small accessibility handshake for committing garden actions through Chrome's
// native UI. No network, credentials, or arbitrary command execution.
A.createNativeActions = function ({ doc, logger, now = Date.now }) {
  let node = null, pending = null, serial = 0;
  const allowed = /^(Gieo Hạt .+|Vẫn đổi Gói Hạt .+|Bắt Đầu Phá Quan)$/;
  function cancel() { pending = null; if (node) node.hidden = true; }
  return {
    attach(root) {
      node = doc.createElement('button'); node.id = 'tta-native-action'; node.hidden = true;
      node.textContent = 'Đang xác nhận thao tác trong game…';
      node.addEventListener('click', () => { if (pending) logger.add('NATIVE_ACTION_DISPATCHED', { label: pending.label }); cancel(); });
      root.appendChild(node);
    },
    request(label) {
      if (!allowed.test(label) || !node) return false;
      if (pending) return pending.label === label;
      pending = { label, at: now(), id: now() + '-' + (++serial), timeout:label==='Bắt Đầu Phá Quan'?30000:5000 };
      node.setAttribute('aria-label', 'TTA_NATIVE|' + pending.id + '|' + label); node.hidden = false;
      logger.add('NATIVE_ACTION_REQUEST', { label }); return true;
    },
    intentional(e) {
      const b = e.target?.closest?.('button');
      return !!pending && now() - pending.at < pending.timeout && !!b && b.textContent.trim().startsWith(pending.label);
    },
    tick() {
      if (pending && now() - pending.at > pending.timeout) { const label = pending.label; cancel(); return 'Chưa xác nhận thao tác Chrome: ' + label; }
      return null;
    },
    cancel
  };
};


// src/ui/overlay.js
A.createOverlay = function ({ doc, getStatus, startAuto, start, startQuests, startGarden, startIntro, stop, exportLog, copyLog, debugToggle, nativeActions }) {
  const host = doc.createElement('div');
  host.id = 'tutien-auto-panel';
  Object.assign(host.style, { position: 'fixed', right: '12px', top: '12px', zIndex: '2147483647', maxWidth: 'calc(100vw - 24px)' });
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { color-scheme: dark; }
      section { width: 310px; max-width: calc(100vw - 28px); box-sizing: border-box; background: #152020f2; color: #eaf4ee; border: 1px solid #5b7869; border-radius: 10px; padding: 12px; font: 13px/1.5 system-ui,sans-serif; box-shadow: 0 5px 25px #0007; }
      header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .title { display: flex; align-items: center; gap: 7px; }
      .run-indicator { display: inline-block; padding: 2px 6px; border-radius: 5px; font: 700 10px/1.4 ui-monospace,monospace; letter-spacing: .04em; }
      .run-indicator.on { background: #176b43; color: #d7ffe7; }
      .run-indicator.off { background: #4b3434; color: #ffdede; }
      button { cursor: pointer; background: #304c40; color: white; border: 1px solid #648673; border-radius: 5px; padding: 6px 9px; margin: 3px 3px 3px 0; font: inherit; }
      button:disabled { opacity: .45; cursor: default; } button.stop { background: #923c3c; }
      p { margin: 7px 0; overflow-wrap: anywhere; } .muted { color: #b6c9bc; font-size: 12px; }
      label { display: block; margin: 8px 0; } input { vertical-align: middle; }
      textarea { box-sizing: border-box; width: 100%; height: 150px; font: 11px monospace; }
      [hidden] { display: none !important; }
    </style>
    <section aria-label="TuTien2D Automation">
      <header><div class="title"><span id="run-indicator" class="run-indicator off" role="status" aria-live="polite">DONT</span><strong>TuTien2D · Auto tổng</strong></div><button id="fold" title="Thu gọn">−</button></header>
      <div id="body">
        <p id="status" aria-live="polite"></p>
        <p id="details" class="muted"></p>
        <label><input id="ready" type="checkbox"> Tôi đã tắt các script Auto khác.</label>
        <button id="auto">Chạy Auto tổng</button><button id="stop" class="stop">Stop</button>
        <p id="auto-status" aria-live="polite"></p>
        <p id="garden-objective" class="muted" hidden></p>
        <p class="muted">Đến Giai đoạn 15 → việc Đại Phu → vào vườn.</p>
        <p id="auto-pending" class="muted" hidden></p>
        <details><summary>Chạy từng chức năng</summary>
        <button id="start">Start · Tới Đại Phu</button>
        <button id="intro">Làm nhiệm vụ mở Dược Công</button><p id="intro-status" class="muted"></p>
        <button id="quests">Chạy việc Dược Công</button><p id="quest-status" class="muted"></p>
        <label><input id="one-run" type="checkbox"> Dừng sau một lượt hoàn thành</label>
        <button id="garden">Vào vườn · Đánh quái & trồng cây</button><p id="garden-status" class="muted"></p>
        </details>
        <p class="muted">Đứng dậy, tắt Auto game và đóng menu trước khi Start. Esc hoặc di chuyển bằng tay sẽ dừng điều hướng.</p>
        <button id="copy">Copy Log</button><button id="export">Export JSON</button><button id="debug">Dừng khảo sát</button>
        <p id="feedback" class="muted" aria-live="polite"></p>
        <textarea id="fallback" hidden readonly aria-label="Log để sao chép"></textarea>
      </div>
    </section>`;
  const $ = id => root.getElementById(id);
  nativeActions?.attach($('body'));
  let folded = false;
  $('fold').addEventListener('click', () => { folded = !folded; $('body').hidden = folded; $('fold').textContent = folded ? '+' : '−'; });
  $('start').addEventListener('click', () => start($('ready').checked));
  $('auto').addEventListener('click', () => startAuto($('ready').checked));
  $('quests').addEventListener('click', () => startQuests($('ready').checked, $('one-run').checked));
  $('intro').addEventListener('click', () => startIntro($('ready').checked));
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
    const auto=s.automation||{running:false,state:'IDLE',message:'',pending:[]};
    const isRunning=!!(auto.running||s.navigation?.running||s.quests?.running||s.intro?.running||s.garden?.running);
    const indicator=$('run-indicator');
    indicator.textContent=isRunning?'RUN':'DONT';
    indicator.classList.toggle('on',isRunning);
    indicator.classList.toggle('off',!isRunning);
    const current=auto.worker==='INTRO'?s.intro:auto.worker==='QUESTS'?s.quests:auto.worker==='GARDEN'?s.garden:null;
    $('auto-status').textContent=auto.state+' · '+(auto.message||'Sẵn sàng chạy tự động theo tiến độ.');
    if (auto.running && current?.message) $('auto-status').textContent+=' '+current.message;
    const objective=s.garden.objective;
    $('garden-objective').hidden=!(objective && s.garden.running);
    if (objective) {
      const exp=objective.experience,pill=objective.pill;
      const missing=pill?.materials.filter(m=>m.have<(m.required??m.qty))||[];
      $('garden-objective').textContent=(objective.next?'Mục tiêu '+objective.next+'. ':'')+
        (exp?'Đạo Hạnh '+Math.floor(exp.current)+'/'+exp.target+'. ':'')+
        (pill?pill.name+' '+pill.have+'/'+pill.need+'. ':'')+
        (missing.length?'Nguyên liệu: '+missing.map(m=>(m.name||m.id)+' '+m.have+'/'+(m.required??m.qty)).join(', ')+'.':'');
    }
    $('auto-pending').hidden=!auto.pending.length;
    $('auto-pending').textContent='Việc chưa hỗ trợ tự chạy: '+auto.pending.join(', ')+'.';
    $('status').textContent = s.snapshot.ready ? 'Đã kết nối dữ liệu game 0.9.1.' : s.snapshot.hud?.ready ?
      'Đã đọc HUD. Auto 0.9.1 còn thiếu dữ liệu game; xuất log để kiểm tra.' : 'Đang chờ HUD nhân vật trong game.';
    const p = s.snapshot.player;
    const h = s.snapshot.hud;
    $('details').textContent = s.snapshot.ready ? `${s.snapshot.map.name || 'Chưa có map'} · (${Math.round(p.x || 0)}, ${Math.round(p.y || 0)})` :
      h?.ready ? `${h.map} · (${h.x}, ${h.y}) · ${h.realm || 'Chưa rõ cảnh giới'} · HUD` : 'Chưa đọc được nhân vật';
    $('quest-status').textContent = s.quests.state + ' · ' + s.quests.message + ' · Đã xong ' + s.quests.completed + ' lượt';
    $('intro-status').textContent = s.intro.state + ' · ' + s.intro.message;
    $('garden-status').textContent = s.garden.state + ' · ' + s.garden.message;
    $('auto').disabled=auto.running || !s.snapshot.ready || !$('ready').checked;
    $('start').disabled = auto.running || s.navigation.running || s.quests.running || s.garden.running || s.intro.running || !s.snapshot.ready || !$('ready').checked;
    $('intro').disabled = $('start').disabled;
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
﻿if (window.TuTienAuto) return;
const access = A.createGameAccess(window);
const logger = A.createLogger(300);
const controller = A.createController();
let hiddenSince = document.hidden ? Date.now() : 0, hiddenTotal = 0;
const now = () => Date.now() - hiddenTotal - (hiddenSince ? Date.now() - hiddenSince : 0);
const flight = A.createFlight({ getGame: () => access.get(), doc: document, host: window, logger, now });
const navigation = A.createNavigation({ getGame: () => access.get(), logger, controller, flight, now });
const quests = A.createQuestRunner({ getGame: () => access.get(), doc: document, host: window, controller, logger, flight, now });
const nativeActions = A.createNativeActions({ doc: document, logger, now });
const intro = A.createIntro({ getGame: () => access.get(), doc: document, host: window, controller, logger, flight, nativeActions, now });
const ascension = A.createAscension({ getGame: () => access.get(), doc: document, logger, now });
const garden = A.createGarden({ getGame: () => access.get(), doc: document, host: window, logger, controller, navigation, flight, ascension, nativeActions, now });
const combatSkills=A.createCombatSkills({getGame:()=>access.get(),doc:document,host:window,logger});
const automation = A.createAutoRunner({ getGame: () => access.get(), doc: document, host: window,
  intro, quests, garden, navigation, nativeActions, controller, logger, combatSkills, now });
let debug = true, ui = null, lastSignature = '', lastSample = 0, disposed = false;
let snapshot = A.readState(access.get(), document);
logger.add('LOADED', { version: '0.9.7', mode: 'read-only-until-start' });

function sample(force = false) {
  snapshot = A.readState(access.get(), document);
  // Position is exported, but walking alone does not generate a record each tick.
  const signature = JSON.stringify({ ...snapshot, player: A.pick(snapshot.player, ['state', 'downed', 'flying']),
    enemies: snapshot.enemies.map(e => A.pick(e, ['id', 'dead'])) });
  if (debug && (force || signature !== lastSignature)) {
    logger.add('STATE_CHANGED', snapshot); lastSignature = signature;
  }
  lastSample = now();
}
function status() {
  return { version: '0.9.7', debug, disposed, logs: logger.size(), snapshot, automation: automation.status(), combatSkills:combatSkills.status(), navigation: navigation.status(), quests: quests.status(), intro: intro.status(), garden: garden.status(), controller: controller.status(),
    oldFarmStatusFunctionPresent: typeof window.getFarmStatus === 'function' };
}
function report() {
  sample();
  const g = access.get();
  return { schema: 'tutien2d-diagnostic-v1', version: '0.9.7', exportedAt: new Date().toISOString(),
    snapshot, access: access.diagnostics(), automation: automation.status(), combatSkills:combatSkills.status(), navigation: navigation.status(),
    quests: quests.status(), duocCong: A.readDuocCong(g),
    flight: flight.status(),
    intro: intro.status(), garden: garden.status(), gardenData: A.readGarden(g),
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
  automation.stop(reason);
  nativeActions.cancel();
  intro.stop(reason); garden.stop(reason); quests.stop(reason); navigation.stop(reason); controller.stop(); ui?.render();
}
const listeners = [];
function listen(target, event, handler, capture = false) {
  target.addEventListener(event, handler, capture);
  listeners.push(() => target.removeEventListener(event, handler, capture));
}
listen(window, 'keydown', e => {
  if (!e.isTrusted || !(automation.status().running || navigation.status().running || quests.status().running || garden.status().running || intro.status().running)) return;
  if (['Escape', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyT', 'KeyR', 'KeyQ', 'KeyE', 'Enter', 'Space', 'KeyB', 'KeyI', 'KeyF'].includes(e.code)) stopAll('Đã dừng vì bạn thao tác bàn phím.');
}, true);
listen(document, 'pointerdown', e => {
  if (e.isTrusted && (automation.status().running || navigation.status().running || quests.status().running || garden.status().running || intro.status().running) && !e.composedPath().includes(ui?.host) && !nativeActions.intentional(e)) stopAll('Đã dừng vì bạn chạm màn hình game.');
}, true);
listen(document, 'visibilitychange', () => {
  if (document.hidden) hiddenSince ||= Date.now();
  else if (hiddenSince) { hiddenTotal += Date.now() - hiddenSince; hiddenSince = 0; }
});
listen(window, 'pagehide', () => stopAll('Đã rời trang.'));

const timer = setInterval(() => {
  const nativeError = nativeActions.tick(); if (nativeError) stopAll(nativeError);
  automation.tick();
  navigation.tick();
  quests.tick();
  garden.tick();
  intro.tick();
  if (debug && now() - lastSample >= 1000) {
    try { sample(); } catch (error) { logger.add('DIAGNOSTIC_ERROR', { message: error.message }); }
  }
  ui?.render();
}, 250);
function mount() {
  if (disposed || ui || !document.documentElement) return;
  ui = A.createOverlay({ doc: document, getStatus: status,
    startAuto: checked => { if (automation.status().running) return; stopAll('Chuyển sang Auto tổng.'); automation.start({otherScriptsStopped:checked}); ui.render(); },
    start: checked => { navigation.start({ otherScriptsStopped: checked }); ui.render(); },
    startQuests: (checked, oneRun) => { quests.start({ otherScriptsStopped: checked, maxRuns: oneRun ? 1 : Infinity }); ui.render(); },
    startIntro: checked => { intro.start({ otherScriptsStopped: checked }); ui.render(); },
    startGarden: checked => { garden.start({ otherScriptsStopped: checked }); ui.render(); },
    stop: stopAll, exportLog, copyLog: () => navigator.clipboard.writeText(exportLog(true)), nativeActions,
    debugToggle: () => { debug = !debug; if (debug) sample(true); ui.render(); } });
}
const api = Object.freeze({
  version: '0.9.7',
  status: () => JSON.parse(JSON.stringify(status())),
  report,
  startAuto: options => {
    if (disposed || automation.status().running || !options?.otherScriptsStopped) return false;
    stopAll('Chuyển sang Auto tổng.');return automation.start(options);
  },
  start: options => { if (disposed || automation.status().running) return false; return navigation.start(options); },
  startQuests: options => { if (disposed || automation.status().running) return false; return quests.start(options); },
  startIntro: options => { if (disposed || automation.status().running) return false; return intro.start(options); },
  startGarden: options => { if (disposed || automation.status().running) return false; return garden.start(options); },
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
