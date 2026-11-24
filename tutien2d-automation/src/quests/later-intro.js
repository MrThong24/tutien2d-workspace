// Stages 14–17. All quest, farm and inventory APIs here are read-only.
// Stage 14 choices are randomized from the options exposed by the game.
A.createLaterIntro = function ({ doc, host, helper, flight, now = Date.now, phase, press, at, click, brew }) {
  function randomSavedChoice(key, choices) {
    if (!Array.isArray(choices) || !choices.length) return null;
    const storageKey='tutien2d_intro14_'+key;
    let choice=null;
    try { choice=host.sessionStorage.getItem(storageKey); } catch (_) {}
    if (!choices.includes(choice)) {
      choice=choices[Math.floor(Math.random()*choices.length)];
      try { host.sessionStorage.setItem(storageKey,choice); } catch (_) {}
    }
    return choice;
  }
  function clearSavedChoice(key) {
    try { host.sessionStorage.removeItem('tutien2d_intro14_'+key); } catch (_) {}
  }
  const pickupStarted = new WeakMap(), skippedDrops = new WeakSet();
  const freeBookPools = [
    { id: 'so_cap', label: 'Tàng Kinh Sơ Cấp', tab: 'Sơ Cấp' },
    { id: 'bi_dong', label: 'Tàng Kinh Bị Động', tab: 'Bị Động' }
  ];
  let quizAnswer = null, quizSubmitted = '', bookDraw = null, bookStarted = 0;
  let battleStarted = 0, battleBoardOpened = 0;
  const textOf = selector => doc.querySelector(selector)?.textContent?.trim() || '';
  const visible = node => !!node && !node.disabled && !!node.getClientRects().length;
  const normalizeAnswer = value => String(value || '').trim().replace(/[.!?\s]+$/u, '').normalize('NFC').toLocaleLowerCase();
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
  function stage17(g) {
    const q=g.Quest,w=g.SceneWorld,p=w.player;
    if (auto(g,false) || stand(g)) return;
    if (p.flying) { press('f'); return; }
    if (w.fishing || w.fishingAuto || w.chopping) { press('ArrowRight'); return; }
    if (g.HUD.bagOpen) { press('b'); return; }

    const progress=Number(q.bachKhoaProgress?.())||0;
    if (progress < (q.BACH_KHOA_NEED||5)) {
      if (!g.HUD.dialogOpen) { quizSubmitted=''; at(g,'tan_vien',['su_phu']); return; }
      const body=textOf('#dialog-text');
      if (/Chưa đúng/i.test(body)) {
        const hint=body.match(/Gợi ý:\s*([\s\S]+?)(?:[.!?]\s*$|\s*$)/i)?.[1]?.trim();
        if (!hint) throw Error('Không đọc được đáp án gợi ý ở Bách Khoa; dừng để tránh trả lời mò.');
        quizAnswer=hint.replace(/[.!?]+$/u,'').trim();
        quizSubmitted='';
        const retry=Array.from(doc.querySelectorAll('#dialog-choices button')).find(b=>visible(b)&&b.textContent.trim().startsWith('Thử lại câu này'));
        if (!retry) throw Error('Game không hiện nút thử lại câu Bách Khoa.');
        retry.click(); phase('BACH_KHOA_RETRY','Đã đọc gợi ý đáp án; mở lại câu để chọn đúng.'); return;
      }
      if (/Đúng rồi/i.test(body)) {
        const action=doc.querySelector('#dialog-action');
        if (visible(action) && /Câu tiếp theo/i.test(action.textContent)) { action.click(); quizSubmitted=''; return; }
        return;
      }
      if (!/^Câu\s+\d+\/\d+\s*:/i.test(body))
        throw Error('Hội thoại Thầy Ông Nội không giống câu hỏi Bách Khoa; dừng để tránh bấm nhầm lựa chọn.');
      const choices=Array.from(doc.querySelectorAll('#dialog-choices button')).filter(b=>visible(b)&&
        !/^(Mở Bách Khoa|Thử lại câu này)/i.test(b.textContent.trim()));
      if (!choices.length) {
        if (g.HUD.dialogOpen) { helper.closeDialog(g); return; }
        return;
      }
      const key=progress+'|'+body;
      if (quizSubmitted===key) return;
      let selected=null;
      if (quizAnswer) {
        selected=choices.find(b=>normalizeAnswer(b.textContent)===normalizeAnswer(quizAnswer));
        if (!selected) throw Error('Đáp án gợi ý không khớp lựa chọn hiện tại; dừng để tránh chọn sai.');
        quizAnswer=null;
      } else {
        // The game reveals the correct answer after an incorrect attempt. This
        // lets the runner learn from the game's own hint instead of guessing repeatedly.
        selected=choices[Math.floor(Math.random()*choices.length)];
      }
      quizSubmitted=key; selected.click();
      phase('BACH_KHOA_ANSWER','Đang trả lời câu Bách Khoa '+(progress+1)+'/5.'); return;
    }

    if (q.flags?.[q.RUT_BI_TICH_FLAG] || q.biTichGachaExhausted?.()) {
      if (g.GachaUI?.open) { doc.querySelector('#gacha-close')?.click(); return; }
      if (g.HUD.dialogOpen) { helper.closeDialog(g); return; }
      phase('WAIT_STAGE_ADVANCE','Đã xong Bách Khoa và bí tịch; chờ game cập nhật nhiệm vụ.'); return;
    }
    if (!g.Gacha || typeof g.Gacha.freeToday!=='function' || typeof g.Gacha.soldOut!=='function' || !g.GachaUI)
      throw Error('Chưa đọc được quầy bí tịch để làm Giai đoạn 17.');
    if (!bookStarted) bookStarted=now();
    if (now()-bookStarted>300000) throw Error('Quá 5 phút chờ hoàn thành phần bí tịch Giai đoạn 17.');

    const available=pool=>g.Gacha.freeToday(g,pool.id)===true && g.Gacha.soldOut(g,pool.id)===false;
    if (bookDraw) {
      if (q.flags?.[q.RUT_BI_TICH_FLAG] || (!g.Gacha.freeToday(g,bookDraw.id) && !g.GachaUI.rolling)) {
        bookDraw=null; quizSubmitted=''; return;
      }
      if (now()-bookDraw.at>30000) throw Error('Chưa xác nhận được lượt rút miễn phí; đã dừng, không thử rút lại.');
      return;
    }
    const next=freeBookPools.find(available);
    if (!next) throw Error('Giai đoạn 17 cần rút bí tịch mới nhưng hôm nay không còn lượt miễn phí; dừng, không dùng Linh Thạch.');
    if (g.GachaUI.open) {
      if (g.GachaUI.rolling) return;
      if (g.Gacha.activePoolId!==next.id) {
        const tab=Array.from(doc.querySelectorAll('#gacha-pools button')).find(b=>visible(b)&&b.textContent.trim()===next.tab);
        if (!tab) throw Error('Không tìm thấy tab '+next.tab+' trong quầy bí tịch.');
        tab.click(); phase('BOOK_POOL','Đã chọn '+next.label+'.'); return;
      }
      const button=doc.querySelector('#gacha-one');
      if (!visible(button) || !/Rút 1\s*·\s*Miễn phí hôm nay/i.test(button.textContent.trim()) || !available(next))
        throw Error('Không xác nhận được nút rút miễn phí; chưa bấm rút.');
      bookDraw={id:next.id,at:now()}; button.click();
      phase('BOOK_DRAW','Đã yêu cầu lượt miễn phí '+next.label+'; chờ game xác nhận.'); return;
    }
    if (g.HUD.dialogOpen) {
      const title=textOf('#dialog-title');
      if (!/Tàng Kinh Lão Nhân/i.test(title)) { helper.closeDialog(g); return; }
      const button=Array.from(doc.querySelectorAll('#dialog-choices button')).find(b=>visible(b)&&
        (b.textContent.trim().startsWith(next.label)||b.textContent.trim().startsWith(next.tab)));
      if (!button) throw Error('Không thấy lựa chọn '+next.label+' trong hội thoại Tàng Kinh Lão Nhân.');
      button.click(); phase('BOOK_OPEN','Đang mở '+next.label+'.'); return;
    }
    if (w.map.data.id!=='tan_vien') { at(g,'tan_vien',['tang_kinh_lao_nhan']); return; }
    const check=g.Gacha.open(g);
    if (!check) throw Error('Quầy bí tịch chưa mở khóa hoặc game chưa sẵn sàng.');
    at(g,'tan_vien',['tang_kinh_lao_nhan']);
  }
  return { tick(g) {
    const q=g.Quest,w=g.SceneWorld;
    if (q.stage===14) {
      const weaponId=q.flags?.[q.BINH_KHI_FLAG] || randomSavedChoice('weapon',q.BINH_KHI_CHOICES);
      if (!q.binhKhiDaNhan()) {
        if (auto(g,false) || stand(g)) return;
        if (g.HUD.dialogOpen) {
          const weaponName=g.ITEMS?.[weaponId]?.name;
          if (!weaponName || (!click('Nh\u1eadn '+weaponName) && !click(weaponName))) helper.closeDialog(g);
          return;
        }
        at(g,'duoc_vien',['dai_phu']); return;
      }
      clearSavedChoice('weapon');
      if (!q.biTichUnlocked()) { garden(g); return; }
      if (q.flags.bi_tich_nhan_viec && !q.biTichComplete() && g.Inventory.has(q.MANH_THUONG)) {
        if (collect(g,q.MANH_HA)) return;
        combat(g,'mieu_hoang'); return;
      }
      if (auto(g,false) || stand(g)) return;
      const selectedWeapon=q.flags?.[q.BINH_KHI_FLAG] || weaponId;
      if (!selectedWeapon || !equip(g,selectedWeapon)) return;
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
            const allowed=new Set(q.BI_TICH_CHOICES||[]);
            const options=Array.from(doc.querySelectorAll('#dialog [data-book]'))
              .filter(node=>allowed.has(node.getAttribute('data-book')));
            const choice=randomSavedChoice('book',options.map(node=>node.getAttribute('data-book')));
            const selected=options.find(node=>node.getAttribute('data-book')===choice);
            if (selected?.classList.contains('chon')) { if (click('Nhận Quyển Này')) clearSavedChoice('book'); return; }
            if (selected) { selected.click(); return; }
            phase('WAIT_BOOK_CHOICE','Khong doc duoc danh sach bi kip de chon ngau nhien.'); return;
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
    if (q.stage===17) { stage17(g); return; }
  }};
};

