// Uses normal dialog buttons and interaction keys. Never invokes Quest mutation APIs.
A.createQuestRunner = function ({ getGame, doc, host, controller, logger, flight = null, now = Date.now }) {
  let running = false, state = 'IDLE', message = '', started = 0, taskStarted = 0;
  let chosen = null, moving = null, lastAction = 0, lastProgress = 0, signature = '', waiting = null;
  let recoveringHp = false;
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
  function recoverHealth(g) {
    const w=g?.SceneWorld,p=w?.player;
    if (!p || !Number.isFinite(p.hpMax) || p.hpMax<=0) return false;
    if (!recoveringHp && p.hp>=p.hpMax*.35) return false;
    recoveringHp=true; clearMovement();
    if (ownedActivity && (w.fishing || w.chopping)) {
      doc.dispatchEvent(new host.KeyboardEvent('keydown',{key:'ArrowRight',code:'ArrowRight',bubbles:true}));
      host.setTimeout(()=>doc.dispatchEvent(new host.KeyboardEvent('keyup',{key:'ArrowRight',code:'ArrowRight',bubbles:true})),80);
      ownedActivity=false;
    }
    phase('HEAL','HP thấp; đang hồi máu trước khi tiếp tục nhiệm vụ.');
    if (p.hp<p.hpMax*.65) {
      if (p.state!=='sit' && now()-lastAction>=1000) press('q');
      return true;
    }
    if (p.state==='sit') { if (now()-lastAction>=1000) press('q'); return true; }
    recoveringHp=false;
    return false;
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
      recoveringHp = false;
      linhBatchTarget = 0; linhBatchCollecting = false; linhBatchPlace = null;
      waiting = null; signature = ''; phase('SELECT_TASK', 'Đang đọc toàn bộ việc Dược Công.'); return true;
    },
    stop,
    tick() {
      if (!running) return;
      try {
        const g = getGame(), w = g?.SceneWorld, p = w?.player;
        if (!controller.owns('quest')) return stop('Đã mất quyền điều khiển.');
        if (!p || p.downed) return stop('Nhân vật đang gục hoặc không sẵn sàng.', 'ERROR');
        if (w.autoOn || w.autoDC || w.diNV || (!flight && p.flying)) return stop('Có điều khiển khác đang hoạt động.', 'ERROR');
        if (recoverHealth(g)) return;
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
