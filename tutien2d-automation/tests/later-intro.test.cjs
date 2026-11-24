const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(stage=14,nativeActions=null) {
 const c=vm.createContext({Math,Array}); vm.runInContext('var A={}',c);
 vm.runInContext(fs.readFileSync('src/quests/later-intro.js','utf8'),c);
 const actions=[],counts={},equipped=new Set(['thiet_kiem','phi_diep']);
 const g={SceneWorld:{autoOn:false,player:{state:'idle',setPath(){}},map:{data:{id:'vuon_ca_nhan'}},enemies:[]},
  HUD:{},Inventory:{has:id=>(counts[id]||0)>0,count:id=>counts[id]||0,isEquipped:id=>equipped.has(id)},
  ITEMS:{hat_linh_diep:{name:'Hạt Linh Diệp'},hat_huyet_thao:{name:'Hạt Huyết Thảo'}},
  Farm:{PLOT_COUNT:10,plot:()=>null,ready:()=>false,canWater:()=>false,hasWaterAccess:()=>true},
  Breakthrough:{check:()=>({ready:false})},Quest:{stage,flags:{},binhKhiDaNhan:()=>true,
   biTichUnlocked:()=>false,biTichComplete:()=>false,hasRecipe:()=>false,daoHanhFull:()=>false,
   MANH_THUONG:'manh_bi_tich_thuong',MANH_HA:'manh_bi_tich_ha',stageComplete:()=>false,
   DOC_DANG_ITEM:'doc_dang_doc_dich',NEED_DOC_DANG:10,LINH_NGU_CATCH_FLAG:'linh_ngu_cau_duoc',NEED_LINH_NGU:1}};
 const doc={querySelector:()=>null,querySelectorAll:()=>[],dispatchEvent:e=>actions.push(['key',e.code])};
 const helper={clear(){},travel(g,map){actions.push(['travel',map]);return true},closeDialog(){actions.push(['close'])}};
 const runner=c.A.createLaterIntro({doc,host:{KeyboardEvent:class{constructor(t,p){Object.assign(this,p)}}},helper,nativeActions,
  flight:{ground:()=>({waiting:false})},phase:(...a)=>actions.push(['phase',...a]),
  press:k=>{actions.push(['press',k]);if(k==='t')g.SceneWorld.autoOn=!g.SceneWorld.autoOn},
  at:(g,map,ids)=>actions.push(['at',map,...ids]),click:l=>{actions.push(['click',l]);return false},
  brew:n=>{actions.push(['brew',n]);return false}});
 return {g,runner,actions,counts,doc,tick(){runner.tick(g)}};
}
test('stage 14 only confirms the requested Thiet Kiem',()=>{
 const f=setup();f.g.Quest.binhKhiDaNhan=()=>false;f.g.HUD.dialogOpen=true;f.tick();
 assert.ok(f.actions.some(a=>a[1]==='Nhận Thiết Kiếm'));
 assert.ok(!f.actions.some(a=>String(a[1]).includes('Thiết Đao')));
});
test('stage 14 sows the missing herb before meditating',()=>{
 const f=setup();f.counts.hat_linh_diep=3;f.tick();
 assert.deepEqual(f.actions.at(-1),['at','vuon_ca_nhan','plot_1']);
 f.g.HUD.dialogOpen=true;f.tick();assert.ok(f.actions.some(a=>a[1]==='Gieo Hạt Linh Diệp'));
});

test('respawned garden mobs do not starve planting work',()=>{
 const f=setup();f.counts.hat_linh_diep=3;
 f.g.SceneWorld.enemies=[{id:'dlt_1',hp:20}];f.tick();
 assert.deepEqual(f.actions.at(-1),['at','vuon_ca_nhan','plot_1']);
});

test('a confirmed sow clears its native request before a later recipe dialog',()=>{
 const requests=[];let cancelled=0;
 const f=setup(14,{request:l=>requests.push(l),cancel(){cancelled++}});
 f.counts.hat_linh_diep=3;f.tick();f.g.HUD.dialogOpen=true;f.tick();
 assert.deepEqual(requests,['Gieo Hạt Linh Diệp']);
 f.g.HUD.dialogOpen=false;f.counts.hat_linh_diep=0;f.counts.linh_diep=3;
 f.g.Farm.canWater=id=>id==='plot_1';f.tick();assert.equal(cancelled,1);
 f.g.HUD.dialogOpen=true;f.g.Quest.hasRecipe=()=>true;f.tick();
 assert.equal(requests.length,1);
});
test('stage 14 waters dry plots before planting',()=>{
 const f=setup();f.g.Farm.canWater=id=>id==='plot_2';f.tick();
 assert.deepEqual(f.actions.at(-1),['at','vuon_ca_nhan','plot_2']);
});
test('stage 14 opens cauldron only when pill materials are available',()=>{
 const f=setup();f.g.Quest.hasRecipe=()=>true;f.tick();assert.deepEqual(f.actions.at(-1),['at','vuon_ca_nhan','dan_lo_vuon']);
});
test('stage 14 prioritizes ready breakthrough over respawned mobs',()=>{
 const f=setup();f.g.SceneWorld.enemies=[{id:'dlt_1',hp:20}];f.g.Breakthrough.check=()=>({ready:true});
 f.tick();assert.deepEqual(f.actions.at(-1),['at','vuon_ca_nhan','dai_da_duoc']);
});
test('stage 14 partial manuscript keeps combat enabled across ticks',()=>{
 const f=setup();f.g.Quest.biTichUnlocked=()=>true;f.g.Quest.flags.bi_tich_nhan_viec=true;
 f.counts.manh_bi_tich_thuong=1;f.g.SceneWorld.map.data.id='mieu_hoang';f.tick();f.tick();
 assert.equal(f.actions.filter(a=>a[0]==='press'&&a[1]==='t').length,1);
});
test('stage 14 selected Hoa Cau is confirmed only after selecting its card',()=>{
 const f=setup();let selected=false;f.g.Quest.biTichUnlocked=()=>true;f.g.Quest.biTichComplete=()=>true;
 f.g.Quest.flags.phi_diep_da_trao=true;f.g.HUD.dialogOpen=true;
 f.doc.querySelector=()=>({classList:{contains:()=>selected},click(){selected=true}});
 f.tick();assert.equal(selected,true);assert.ok(!f.actions.some(a=>a[1]==='Nhận Quyển Này'));
 f.tick();assert.ok(f.actions.some(a=>a[1]==='Nhận Quyển Này'));
});

test('already equipped sword does not close the bag needed to equip Phi Diep',()=>{
 const f=setup();let picked=false;f.g.Quest.biTichUnlocked=()=>true;
 f.g.Quest.flags.phi_diep_da_trao=true;f.g.Inventory.isEquipped=id=>id==='thiet_kiem';
 f.g.HUD.bagOpen=true;f.doc.querySelector=s=>s.includes('data-item="phi_diep"')?{click(){picked=true}}:null;
 f.tick();assert.equal(picked,true);assert.ok(!f.actions.some(a=>a[0]==='press'&&a[1]==='b'));
});
test('stage 15 collects bones then disables combat and returns to elder',()=>{
 const f=setup(15);f.g.SceneWorld.map.data.id='mieu_hoang';f.tick();f.tick();
 assert.equal(f.actions.filter(a=>a[0]==='press'&&a[1]==='t').length,1);
 f.g.Quest.stageComplete=()=>true;f.tick();f.tick();
 assert.deepEqual(f.actions.at(-1),['at','tan_vien','tang_kinh_lao_nhan']);
});
test('stage 16 catches a quest Linh Ngu even if one is already in the inventory',()=>{
 const f=setup(16);f.counts.doc_dang_doc_dich=10;f.counts.linh_ngu=1;f.tick();
 assert.deepEqual(f.actions.at(-1),['at','duoc_vien','ho_bich_thuy_cong','suoi_duoc_coc']);
 f.g.SceneWorld.fishing=true;f.tick();assert.equal(f.actions.at(-1)[1],'FISHING');
 f.g.Quest.flags.linh_ngu_cau_duoc=1;f.tick();assert.equal(f.actions.at(-1)[1],'ArrowRight');
 f.g.SceneWorld.fishing=false;f.tick();assert.deepEqual(f.actions.at(-1),['at','duoc_vien','dai_phu']);
});

test('quest drops are approached for normal pickup instead of chasing another mob',()=>{
 const f=setup(15);f.g.SceneWorld.player.x=0;f.g.SceneWorld.player.y=0;
 f.g.SceneWorld.drops=[{kind:'item',itemId:'yeu_cot',state:'fall',x:100,y:40,gy:120}];
 f.g.Loot={PICK_R:40,canPick:()=>true};
 // The movement helper is intentionally small; inject its public move method.
 const source=fs.readFileSync('src/quests/later-intro.js','utf8');
 const c=vm.createContext({Math,Array});vm.runInContext('var A={}',c);vm.runInContext(source,c);
 let target=null,time=0;
 const runner=c.A.createLaterIntro({doc:f.doc,helper:{clear(){},move(g,p,r){target={...p,r}}},
  now:()=>time,phase(){},press(){},flight:{ground:()=>({waiting:false})}});
 runner.tick(f.g);assert.deepEqual(target,{x:100,y:120,r:28});
 f.g.Loot.canPick=()=>false;
 // A non-pickable drop must not enter the pickup branch.
 f.g.SceneWorld.map.data.id='mieu_hoang';f.tick();
 assert.equal(f.actions.at(-1)[1],'COMBAT');
 f.g.Loot.canPick=()=>true;time=11000;target=null;runner.tick(f.g);
 assert.equal(target,null,'stale loot must not keep the player at its location forever');
});
