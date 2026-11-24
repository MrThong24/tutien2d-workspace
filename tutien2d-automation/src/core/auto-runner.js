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
    phase('PREPARE',target==='INTRO'?'Tiếp tục nhiệm vụ chính; sẽ dừng khi gặp giai đoạn chưa hỗ trợ.':
      target==='QUESTS'?'Chuẩn bị làm việc Dược Công ở Đại Phu.':'Chuẩn bị vào vườn đánh quái, chăm cây và luyện đan.');
  }
  function stopAtUnsupportedStage(stage) {
    const detail='Giai đoạn '+stage+' chưa có luồng nhiệm vụ đã hỗ trợ; Auto tổng dừng tại đây.';
    if (intro.status().running) intro.stop(detail,'DONE');
    stop(detail,'NEEDS_MANUAL');
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
  function continueAfterMain(g) {
    const c=catalog(g);
    if (!c.available) return stop('Chưa đọc được danh sách việc Đại Phu sau mốc nhiệm vụ chính Giai đoạn 18.','ERROR');
    if (c.active && !(c.active.supported || c.tasks.some(t=>t.id===c.active.id && t.status==='READY'))) return gardenAfterQuests(c);
    if (!c.active && !c.tasks.some(t=>t.status==='READY')) return gardenAfterQuests(c);
    prepare('QUESTS');
  }
  return {
    status:()=>({running,state,message,worker,next,pending:[...pending]}),stop,
    start({otherScriptsStopped=false}={}) {
      const g=getGame(),w=g?.SceneWorld;
      if (running) return false;
      if (!otherScriptsStopped) { phase('ERROR','Tích xác nhận đã tắt các script Auto khác trước khi chạy.');return false; }
      if (!w?.player || !Number.isInteger(g?.Quest?.stage)) {
        phase('ERROR','Chưa đọc được nhân vật hoặc nhiệm vụ từ game. Reload trang khi đã vào game rồi thử lại.');return false;
      }
      if (Object.values(workers).some(w=>w.status().running) || navigation.status().running || controller.status().owner) {
        phase('ERROR','Dừng chức năng đang chạy trước khi bật Auto tổng.');return false;
      }
      if (w.autoDC || w.diNV) { phase('ERROR','Tắt Auto Dược Công/tự đi của game trước khi bật Auto tổng.');return false; }
      if (g.Quest.stage>=21) {
        phase('NEEDS_MANUAL','Giai đoạn '+g.Quest.stage+' chưa có luồng nhiệm vụ đã hỗ trợ. Auto tổng chưa chạy.');
        return false;
      }
      controller.reset();combatSkills?.reset();running=true;pending=[];reviveAt=0;
      if (g.Quest.stage>=18) continueAfterMain(g);
      else prepare('INTRO');
      return running;
    },
    tick() {
      if (!running) return;
      try {
        const g=getGame(),w=g?.SceneWorld,p=w?.player;
        if (!p || !Number.isInteger(g.Quest?.stage)) return stop('Mất dữ liệu nhân vật.','ERROR');
        if (p.downed) {
          const resume=worker||next||'INTRO';
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
        if (worker && worker!=='GARDEN' && Number.isFinite(p.hpMax) && p.hpMax>0 && p.hp<p.hpMax*.4) {
          const resume=worker;
          stopWorkers('Tạm dừng để hồi máu.');
          next=resume;prepare(resume);return;
        }
        if (w.autoDC || w.diNV) return stop('Có Auto khác của game đang chạy.','ERROR');
        if (worker==='INTRO' && g.Quest.stage>=18) { continueAfterMain(g); return; }
        if (worker) {
          const s=workers[worker].status();
          if (s.running) return;
          if (worker==='INTRO' && s.state==='DONE' && g.Quest.stage>=18) { continueAfterMain(g); return; }
          if (worker==='QUESTS' && ['DONE','PENDING_ACTIVITIES'].includes(s.state)) {
            const c=catalog(g);
            if (!c.available) return stop('Chưa đọc được danh sách việc Đại Phu.','ERROR');
            if (!c.active && c.tasks.some(t=>t.status==='READY')) return stop('Luồng Dược Công kết thúc khi vẫn còn việc có thể làm.','ERROR');
            gardenAfterQuests(c);return;
          }
          if (worker==='INTRO' && g.Quest.stage>=21) return stopAtUnsupportedStage(g.Quest.stage);
          if (worker==='GARDEN' && s.state==='DONE' && g.Quest.stage>=21) return stopAtUnsupportedStage(g.Quest.stage);
          return stop(s.message||'Chức năng '+worker+' đã dừng.',s.state==='ERROR'?'ERROR':s.state==='NEEDS_MANUAL'?'NEEDS_MANUAL':'STOPPED');
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
        if (next==='INTRO' && g.Quest.stage>=21) return stopAtUnsupportedStage(g.Quest.stage);
        if (next==='INTRO' && g.Quest.stage>=18) { continueAfterMain(g); return; }
        if (next==='QUESTS') {
          if (typeof g.Quest.canOpenSeedMenu==='function' && !g.Quest.canOpenSeedMenu()) return stop('Nhân vật chưa mở được sổ việc Đại Phu.','ERROR');
          const c=catalog(g);
          if (!c.available) return stop('Chưa đọc được danh sách việc Đại Phu.','ERROR');
          if (c.active && !(c.active.supported || c.tasks.some(t=>t.id===c.active.id && t.status==='READY'))) { gardenAfterQuests(c);return; }
          if (!c.active && !c.tasks.some(t=>t.status==='READY')) { gardenAfterQuests(c);return; }
        }
        const target=next;
        if (combatSkills && !combatSkills.prepare()) return;
        const started=target==='INTRO'
          ? workers[target].start({otherScriptsStopped:true,stopAtStage:18})
            : workers[target].start({otherScriptsStopped:true});
        if (!started) return stop(workers[target].status().message||'Chưa khởi động được '+target+'.','ERROR');
        worker=target;next=null;
        phase(target,target==='INTRO'?'Làm nhiệm vụ chính đến Giai đoạn 18.' :target==='QUESTS'?
          'Làm các việc Dược Công ở Đại Phu.':pending.length?
          'Vào vườn; còn '+pending.length+' loại việc chưa hỗ trợ, xem danh sách bên dưới.':
          'Đã hết lượt Dược Công có thể làm; vào vườn đánh quái và chăm cây.');
      } catch(e) { stop(e.message,'ERROR'); }
    }
  };
};



