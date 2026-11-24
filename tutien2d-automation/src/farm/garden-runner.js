A.createGarden = function ({ getGame, doc, host, logger, controller, navigation, flight, ascension = null, nativeActions = null, now = Date.now }) {
  let running = false, state = 'IDLE', message = '', traveling = false, lastAction = 0, goal = null;
  let move = null, started = 0, expStart = 0, pillStart = 0, craftArmed = false;
  let pendingSow = null, sowFailures = 0;
  let pendingHarvest = null;
  let pendingBrew = null, objective = null;
  let settled = null;
  let shop = null, destination = 'vuon_ca_nhan', spent = 0, shopDisabled = false;
  let recoveringHp = false, healTrip = null;
  let stopAtQuestStage = 0;
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
    const w=g?.SceneWorld,p=w?.player;
    if (!p || !Number.isFinite(p.hpMax) || p.hpMax<=0) return false;
    if (!recoveringHp && p.hp>=p.hpMax*.4) return false;
    if (!recoveringHp) { recoveringHp=true; healTrip='OUTBOUND'; }
    clear();
    if (healTrip==='OUTBOUND') {
      if (w.autoOn) {
        p.setPath([]);
        if (now()-lastAction>=1000) press('t');
        p.setPath([]); return true;
      }
      if (g.HUD?.dialogOpen) { close(); return true; }
      if (p.state==='sit') { if (now()-lastAction>=1000) press('q'); return true; }
      if (w.map.data.id!=='duoc_vien') { travelTo('duoc_vien'); phase('HEAL_TRAVEL','Rời vườn để hồi máu an toàn.'); return true; }
      healTrip='RESTING';
    }
    if (healTrip==='RESTING') {
      phase('HEAL','Đang hồi máu ở Dược Viên trước khi quay lại vườn.');
      if (p.hp<p.hpMax*.65) {
        if (p.state!=='sit' && now()-lastAction>=1000) press('q');
        return true;
      }
      if (p.state==='sit') { if (now()-lastAction>=1000) press('q'); return true; }
      healTrip='RETURNING';
      travelTo('vuon_ca_nhan'); phase('HEAL_TRAVEL','Đã hồi máu; quay lại vườn tiếp tục.'); return true;
    }
    if (healTrip==='RETURNING') {
      if (w.map.data.id!=='vuon_ca_nhan') return true;
      recoveringHp=false; healTrip=null;
      phase('CHECK','Đã quay lại vườn sau khi hồi máu.');
      return false;
    }
    if (p.hp<p.hpMax*.65) {
      if (p.state!=='sit' && now()-lastAction>=1000) press('q');
      return true;
    }
    if (p.state==='sit') { if (now()-lastAction>=1000) press('q'); return true; }
    recoveringHp=false;
    return false;
  }
  function close() { const b = doc.querySelector('#dialog-close'); if (b) b.click(); lastAction = now(); }
  function click(selector, prefix) {
    const matches = Array.from(doc.querySelectorAll(selector)).filter(b => !b.disabled && b.getClientRects().length &&
      (b.textContent.trim().startsWith(prefix) || b.getAttribute('aria-label')?.startsWith(prefix)));
    if (matches.length !== 1) return false;
    // Garden seed choices must be committed as a real Chrome click. A DOM
    // click can leave the game's choice modal open without sowing the seed.
    if (nativeActions && /^(Gieo Hạt |Vẫn đổi Gói Hạt )/.test(prefix)) {
      if (!nativeActions.request(prefix)) return false;
    } else matches[0].click();
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
    clear(); running = false; traveling = false; goal = null; shop = null; recoveringHp=false; healTrip=null; controller.release('garden'); phase(next, detail);
  }
  return {
    status: () => ({ running, state, message, goal: goal ? { kind: goal.kind, id: goal.id } : null,
      movement: move ? { tries: move.tries, issued: move.issued } : null, seedCost: spent, shopping: shop?.name || null, objective }), stop,
    start({ otherScriptsStopped = false, stopAtQuestStage: stopAt = 0 } = {}) {
      const g = getGame(), w = g?.SceneWorld;
      if (running || !otherScriptsStopped || !w?.player || w.autoOn || w.autoDC || w.diNV || w.player.downed || w.player.state === 'sit') return false;
      if (controller.status().owner) return false;
      if (g.HUD?.bagOpen || g.HUD?.dialogOpen) { phase('ERROR', 'Đóng hành trang/hội thoại trước khi vào vườn.'); return false; }
      running = true; started = now(); expStart = w.player.exp || 0;
      stopAtQuestStage = Number.isInteger(stopAt) && stopAt > 0 ? stopAt : 0;
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
        if (stopAtQuestStage && Number.isInteger(g?.Quest?.stage) && g.Quest.stage >= stopAtQuestStage)
          return stop('Đã hoàn thành Giai đoạn '+(stopAtQuestStage-1)+'; Giai đoạn '+g.Quest.stage+' chưa được tự động hỗ trợ.','DONE');
        if (!controller.owns('garden') || (w?.map?.data?.id !== 'vuon_ca_nhan' && !shop && !(recoveringHp && w?.map?.data?.id==='duoc_vien'))) return stop('Đã rời vườn hoặc mất quyền điều khiển.');
        if (!p || p.downed) return stop('Nhân vật đang gục hoặc không sẵn sàng.', 'ERROR');
        if (now() - started > 3600000) return stop('Đã đạt thời gian một phiên vườn.');
        if (w.autoDC || w.diNV) return stop('Có tác vụ khác đang điều khiển.');
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
            if (click('#dialog button', 'Đổi ' + shop.name)) { shop.issued = g.Inventory.count(shop.seed) > shop.before ? now() : 0; return; }
            if (click('#dialog button', 'Mở Quầy Đổi Hạt')) return;
            if (click('#dialog button', 'Sổ Dược Công')) return;
            close(); return;
          }
          interact(g, 'dai_phu'); return;
        }
        const targets = w.enemies.filter(e => enemies.includes(e.id));
        if (targets.length !== 2) return stop('Chưa xác nhận đủ hai quái vườn.', 'ERROR');
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
