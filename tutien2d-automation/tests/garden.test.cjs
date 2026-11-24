const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(nativeActions=null){
 const c=vm.createContext({Math,Date,Array});vm.runInContext('var A={};',c);
 for(const f of ['core/controller.js','farm/garden-reader.js','farm/garden-planner.js','farm/garden-runner.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'),c);
 let time=10000;const events=[],paths=[],records=[];const p={x:272,y:240,hp:100,hpMax:100,exp:20,state:'idle',setPath:v=>paths.push(v)};
 const w={player:p,map:{data:{id:'vuon_ca_nhan'},props:[]},enemies:[{id:'dlt_1',hp:10,dead:false},{id:'dlt_2',hp:0,dead:true}]};
 const g={SceneWorld:w,HUD:{},Game:{time:50},Inventory:{count:()=>0},Quest:{brewList:()=>[]}};
 const doc={dispatchEvent:e=>events.push(e),querySelector:()=>null};
 const controller=c.A.createController(), journeys=[];const garden=c.A.createGarden({getGame:()=>g,
 doc,host:{KeyboardEvent:class{constructor(type,p){this.type=type;Object.assign(this,p)}}},
 logger:{add:(event,data)=>records.push({event,data})},nativeActions,controller,navigation:{start:o=>{journeys.push(o);return true},status:()=>({running:false,state:'DONE'}),stop(){}},flight:{ground:()=>({waiting:false})},now:()=>time});
 c.A.readGarden=()=>({plots:[],seeds:[],water:true,goal:null});
 return{A:c.A,g,w,p,garden,controller,events,paths,journeys,doc,records,tick(){time+=1000;garden.tick()}};
}
function readStageGarden(stage, counts={}){
 const c=vm.createContext({Math,Date,Array});vm.runInContext('var A={};',c);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/farm/garden-reader.js'),'utf8'),c);
 const g={Farm:{PLOT_COUNT:10,plot:()=>null,ready:()=>false,canWater:()=>false,remain:()=>0,
   seedDef:()=>null,hasWaterAccess:()=>true,seedsInBag:()=>[]},
   Inventory:{count:id=>counts[id]||0},Quest:{stage,brewList:()=>[]},
   Breakthrough:{ruleOf:()=>({}),check:()=>null},SceneWorld:{player:{}},Progress:{}};
 return c.A.readGarden(g);
}
test('garden reader keeps stage quests in the separate main quest runner',()=>{
 const data=readStageGarden(8,{linh_diep:3,huyet_thao:5});
 assert.equal(data.goal,null);
 assert.equal(Object.hasOwn(data,'stageGoal'),false);
 assert.equal(readStageGarden(9).goal,null);
});
test('garden starts native combat once rather than repeatedly toggling Auto',()=>{
 const f=setup();assert.equal(f.garden.start({otherScriptsStopped:true}),true);f.tick();
 assert.equal(f.events.filter(e=>e.code==='KeyT').length,2);
 f.w.autoOn=true;f.tick();f.tick();assert.equal(f.events.filter(e=>e.code==='KeyT').length,2);
});
test('respawn while meditating stands first, then enables combat',()=>{
 const f=setup();f.garden.start({otherScriptsStopped:true});f.p.state='sit';f.tick();
 assert.equal(f.events[0].code,'KeyQ');assert.ok(!f.events.some(e=>e.code==='KeyT'));
 f.p.state='idle';f.tick();assert.ok(f.events.some(e=>e.code==='KeyT'));
});
test('all enemies dead clears stale chase path before and after disabling Auto',()=>{
 const f=setup();f.garden.start({otherScriptsStopped:true});f.w.autoOn=true;f.w.enemies.forEach(e=>{e.hp=0;e.dead=true});f.tick();
 assert.equal(f.paths.length,2);assert.equal(f.events[0].code,'KeyT');
});
test('Stop releases control and turns off combat it owned',()=>{
 const f=setup();f.garden.start({otherScriptsStopped:true});f.w.autoOn=true;f.garden.stop();f.tick();
 assert.equal(f.controller.status().owner,null);assert.equal(f.events.filter(e=>e.code==='KeyT').length,2);
});
test('another module holding control prevents garden from starting',()=>{
 const f=setup();f.controller.acquire('quest');assert.equal(f.garden.start({otherScriptsStopped:true}),false);assert.equal(f.events.length,0);
});
test('missing target data stops instead of assuming the garden is empty',()=>{
 const f=setup();f.garden.start({otherScriptsStopped:true});f.w.enemies=[{id:'dlt_1',hp:10,dead:false}];f.tick();assert.equal(f.garden.status().state,'ERROR');
});
test('cauldron interaction can approach an adjacent tile beside its blocked tile',()=>{
 const f=setup();f.w.enemies.forEach(e=>{e.dead=true;e.hp=0});f.p.x=297;f.p.y=201;
 f.w.map.props=[{id:'dan_lo_vuon',type:'cauldron',x:336,y:320,r:46}];f.g.CONFIG={TILE:32};
 f.w.brewCooldownUntil=0;
 f.A.readGarden=()=>({plots:[],seeds:[],water:true,goal:{id:'pha_canh_dan',name:'Phá Cảnh Đan',have:0,need:3,materials:[{have:6,qty:3}]}});
 f.A.tileCenter=(g,x,y)=>({x:x*32+16,y:y*32+16});
 f.A.makePath=(g,p)=>Math.floor(p.x/32)===10&&Math.floor(p.y/32)===9?null:[p];
 f.garden.start({otherScriptsStopped:true});f.tick();f.tick();
 assert.ok(f.paths.some(p=>p.length>0));
});
test('missing seeds selects an unlocked pack matching the required herb',()=>{
 const f=setup();f.w.enemies.forEach(e=>{e.dead=true;e.hp=0});
 f.A.readGarden=()=>({plots:[],seeds:[],water:true,duocCong:33,goal:{id:'pha_canh_dan',name:'Phá Cảnh Đan',have:1,need:3,materials:[{id:'long_huyet_thao',have:1,qty:3}]}});
 f.g.Farm={SEEDS:[{seed:'hat_long_huyet',crop:'long_huyet_thao'}]};
 f.g.Quest.packUnlocked=p=>!p.locked;f.g.Quest.SEED_PACKS=[{id:'huyen',name:'Gói Hạt Phá Cảnh Đan',cost:10,give:[['hat_long_huyet',3]]}];
 f.garden.start({otherScriptsStopped:true});f.tick();
 assert.equal(f.garden.status().state,'BUY_SEEDS');assert.equal(f.journeys[0].target,'duoc_vien');
});

test('garden seed shop opens the daily ledger under main quest dialogue then verifies purchase',()=>{
 const f=setup();f.w.enemies.forEach(e=>{e.dead=true;e.hp=0});
 f.g.Progress={duocCong:20};let stock=0,menu='main',opens=0;
 f.g.Inventory.count=()=>stock;
 f.A.readGarden=()=>({plots:[],seeds:[],water:true,duocCong:20,goal:{id:'luyen_khi_dan',name:'Luyện Khí Đan',have:0,need:1,materials:[{id:'linh_ngoc_diep',have:0,qty:3}]}});
 f.g.Farm={SEEDS:[{seed:'hat_linh_ngoc',crop:'linh_ngoc_diep'}]};
 f.g.Quest.packUnlocked=()=>true;f.g.Quest.SEED_PACKS=[{id:'linh',name:'Gói Hạt Luyện Khí Đan',cost:5,give:[['hat_linh_ngoc',3]]}];
 f.garden.start({otherScriptsStopped:true});f.tick();
 f.w.map.data.id='duoc_vien';f.g.HUD.dialogOpen=true;
 f.doc.querySelector=s=>s==='#dialog-title'?{textContent:'Đại Phu'}:s==='#dialog-close'?{click(){f.g.HUD.dialogOpen=false}}:null;
 const button=(text,fn)=>({disabled:false,textContent:text,getClientRects:()=>[{}],getAttribute:()=>null,click:fn});
 f.doc.querySelectorAll=()=>menu==='main'?[button('Sổ Dược Công · đổi hạt',()=>{menu='ledger';opens++})]:
  menu==='ledger'?[button('Mở Quầy Đổi Hạt',()=>{menu='shop'})]:
  [button('Đổi Gói Hạt Luyện Khí Đan',()=>{stock=3;f.g.Progress.duocCong-=5})];
 f.tick();assert.equal(opens,1);assert.equal(stock,0);
 f.tick();f.tick();f.tick();f.tick();f.tick();
 assert.equal(stock,3);assert.equal(f.garden.status().seedCost,5);
 assert.equal(f.journeys.at(-1).target,'vuon_ca_nhan');
});

test('plot interaction waits for position to settle before opening the seed dialog',()=>{
 const f=setup();f.w.enemies.forEach(e=>{e.dead=true;e.hp=0});
 const plot={id:'plot_1',name:'Luống 1',type:'herb_plot',x:112,y:160,r:34};
 f.w.map.props=[plot];f.p.x=112;f.p.y=144;f.g.CONFIG={TILE:32};
 f.g.Targeting={list:[plot],current:()=>({obj:plot,dist:16,r:34}),cycle(){}};
 f.A.readGarden=()=>({plots:[{id:plot.id,seed:null}],seeds:[{id:'hat_long_huyet',crop:'long_huyet_thao',qty:1}],water:true,
 goal:{id:'pha_canh_dan',name:'Phá Cảnh Đan',have:2,need:3,materials:[{id:'long_huyet_thao',have:2,qty:3}]}});
 f.garden.start({otherScriptsStopped:true});f.tick();f.tick();f.tick();
 assert.equal(f.events.filter(e=>e.code==='KeyE').length,0);
 assert.equal(f.garden.status().running,true);
 f.tick();assert.equal(f.events.filter(e=>e.code==='KeyE').length,2);
});

test('a respawn does not cancel an already selected planting action before interaction',()=>{
 const f=setup();f.w.enemies.forEach(e=>{e.dead=true;e.hp=0});
 const plot={id:'plot_1',name:'Luống 1',type:'herb_plot',x:112,y:160,r:34};
 f.w.map.props=[plot];f.p.x=112;f.p.y=144;f.g.CONFIG={TILE:32};
 f.g.Targeting={list:[plot],current:()=>({obj:plot,dist:16,r:34}),cycle(){}};
 f.A.readGarden=()=>({plots:[{id:plot.id,seed:null}],seeds:[{id:'hat_linh_ngoc',crop:'linh_ngoc_diep',qty:3}],water:true,
  goal:{id:'luyen_khi_dan',name:'Luyện Khí Đan',have:0,need:1,materials:[{id:'linh_ngoc_diep',have:0,qty:3}]}});
 f.garden.start({otherScriptsStopped:true});f.tick();
 f.w.enemies[0].dead=false;f.w.enemies[0].hp=20;
 f.tick();f.tick();f.tick();
 assert.equal(f.events.filter(e=>e.code==='KeyE').length,2);
 assert.equal(f.events.filter(e=>e.code==='KeyT').length,0);
 assert.equal(f.garden.status().goal.kind,'sow');
});

test('full EXP with missing pill rests at the stone without repeatedly interacting',()=>{
 const f=setup();f.w.enemies.forEach(e=>{e.dead=true;e.hp=0});f.g.CONFIG={TILE:32};
 f.w.map.props=[{id:'dai_da_duoc',type:'meditate_stone',x:272,y:256,r:34}];
 f.A.readGarden=()=>({experience:{current:100,target:100,full:true},breakthrough:{ready:false},
  plots:[{id:'plot_1',seed:'hat_linh_ngoc',crop:'linh_ngoc_diep'}],seeds:[],water:true,
  goal:{id:'luyen_khi_dan',name:'Luyện Khí Đan',need:1,have:0,materials:[{id:'linh_ngoc_diep',qty:1,have:0}]}});
 f.garden.start({otherScriptsStopped:true});f.tick();assert.equal(f.garden.status().state,'WAIT_GARDEN');
 assert.equal(f.events[0].code,'KeyQ');f.p.state='sit';f.tick();f.tick();
 assert.equal(f.events.filter(e=>e.code==='KeyE').length,0);
 assert.equal(f.events.filter(e=>e.code==='KeyQ').length,2);
});

function plantingFixture(seed,commit=true) {
 const requests=[],f=setup({request:label=>{requests.push(label);return false},cancel(){}});
 f.w.enemies.forEach(e=>{e.dead=true;e.hp=0});
 const defs=[{id:'hat_bich_van',crop:'bich_van_diep',name:'Hạt Bích Vân Diệp'},
  {id:'hat_long_huyet',crop:'long_huyet_thao',name:'Hạt Long Huyết Thảo'}];
 const selected=defs.find(d=>d.id===seed),plot={id:'plot_1',name:'Luống Thuốc 1',type:'herb_plot'};
 let planted=null;
 f.w.map.props=[plot];f.g.ITEMS=Object.fromEntries(defs.map(d=>[d.id,{name:d.name}]));
 f.A.readGarden=()=>({plots:[{id:plot.id,seed:planted,crop:planted?selected.crop:null}],
  seeds:defs.map(d=>({...d,qty:3})),water:true,
  goal:{id:'pha_canh_dan',name:'Phá Cảnh Đan',have:0,need:1,
   materials:defs.map(d=>({id:d.crop,qty:3,have:d.id===seed?0:3}))}});
 const clicks=[];
 f.doc.querySelector=s=>s==='#dialog-title'?{textContent:plot.name}:null;
 f.doc.querySelectorAll=()=>defs.map(d=>({disabled:false,textContent:'Gieo '+d.name+' ×3',
  getClientRects:()=>[{}],getAttribute:()=>null,
  click(){clicks.push(d.id);f.g.HUD.dialogOpen=false;if(commit)planted=d.id}}));
 f.garden.start({otherScriptsStopped:true});f.tick();
 f.g.HUD.dialogOpen=true;f.tick();
 return {...f,requests,clicks};
}

for (const seed of ['hat_bich_van','hat_long_huyet']) test('garden selects '+seed+' directly without native mouse requests',()=>{
 const f=plantingFixture(seed);
 assert.deepEqual(f.clicks,[seed]);assert.deepEqual(f.requests,[]);
 assert.equal(f.records.some(r=>r.event==='GARDEN_SOW_CONFIRMED'),false);
 f.tick();f.tick();
 assert.equal(f.records.filter(r=>r.event==='GARDEN_SOW_CONFIRMED'&&r.data.seed===seed).length,1);
});

test('a DOM seed click without an updated plot is not reported as a successful planting',()=>{
 const f=plantingFixture('hat_long_huyet',false);f.tick();f.tick();f.tick();
 assert.equal(f.records.some(r=>r.event==='GARDEN_SOW_CONFIRMED'),false);
 assert.equal(f.records.filter(r=>r.event==='GARDEN_SOW_UNCONFIRMED').length,1);
 assert.deepEqual(f.requests,[]);
});
