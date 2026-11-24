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
