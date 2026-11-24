// Complete the introductory main quest through the normal game UI.
A.createIntro = function ({ getGame, doc, host, controller, logger, flight, nativeActions = null, now = Date.now }) {
  const helper = A.createQuestRunner({ getGame, doc, host, controller, logger, flight, now }).movement;
  const later = A.createLaterIntro({ getGame, doc, host, helper, flight, now,
    phase: (...args)=>phase(...args), press: key=>press(key),
    at: (...args)=>at(...args), click: label=>click(label), brew: name=>brew(name) });
  let running = false, state = 'IDLE', message = '', started = 0, last = 0, stage = -1, craftArmed = false, revivePending = 0;
  let stopStage = 18;
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
    start({otherScriptsStopped=false,stopAtStage=18}={}) {
      const g=getGame(), w=g?.SceneWorld;
      const blocked = !otherScriptsStopped || running || !w?.player || w.autoOn || w.autoDC || w.diNV || w.player.state==='sit' || g.HUD.dialogOpen || g.HUD.bagOpen || controller.status().owner;
      if (blocked) {
        if (!running) { logger.add('INTRO_START_BLOCKED',{checked:otherScriptsStopped, running, autoOn:w?.autoOn, autoDC:w?.autoDC, diNV:w?.diNV, downed:w?.player?.downed, state:w?.player?.state, dialog:g.HUD?.dialogOpen, bag:g.HUD?.bagOpen, owner:controller.status().owner}); phase('ERROR','Tắt Auto khác, đứng dậy và đóng menu trước khi chạy nhiệm vụ mở đầu.'); } return false;
      }
      controller.reset?.();
      if (!controller.acquire('intro')) return false;
      stopStage=stopAtStage===14?14:stopAtStage===15?15:18;
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
        if (q.stage>=stopStage) return stop(stopStage===14?'Đã tới Giai đoạn 14; sẵn sàng làm Dược Công.':stopStage===15?'Đã tới Giai đoạn 15; sẵn sàng làm Dược Công.':stopStage===20?'Đã hoàn thành nhiệm vụ chính Giai đoạn 19; chuyển sang Dược Công.':'Đã hoàn thành nhiệm vụ chính qua Giai đoạn 17.','DONE');
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


