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
      // Realm 10 unlocks the Trúc Cơ pack, but its current breakthrough still
      // requires two Phá Cảnh Đan. Pin supported recipes to their own pack so
      // a newly unlocked, unrelated realm pack can never be chosen by mistake.
      const requiredPack={luyen_khi_dan:'linh',pha_canh_dan:'huyen'}[plan.id];
      const allPacks=g.Quest?.SEED_PACKS||[];
      const packs=allPacks.filter(p=>(requiredPack ? p.id===requiredPack : true) &&
        g.Quest.packUnlocked?.(p) && p.give.some(([id])=>wanted.has(id)));
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
