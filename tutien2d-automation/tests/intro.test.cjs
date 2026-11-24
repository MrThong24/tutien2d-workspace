const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(stage=2){
 const c=vm.createContext({Math,Date});vm.runInContext('var A={};',c);
 let time=10000,owner=null;const events=[],actions=[];
 const helper={clear(){},travel(g,map){actions.push(['travel',map]);return true},object(g,ids){return {obj:{id:ids[0]}}},interact(g,o){actions.push(['interact',o.obj.id])},click(label){actions.push(['click',label]);return true},closeDialog(){}};
 c.A.createQuestRunner=()=>({movement:helper});
 vm.runInContext(fs.readFileSync('src/quests/later-intro.js','utf8'),c);
 vm.runInContext(fs.readFileSync('src/quests/intro-runner.js','utf8'),c);
 const g={SceneWorld:{player:{hp:100,hpMax:100,state:'idle',setPath(){}},map:{props:[{id:'herb1',type:'herb',x:1,y:1}]},enemies:[]},HUD:{},Inventory:{has:()=>true,count:()=>0},Quest:{stage,flags:{},stageInfo:()=>({name:'intro'}),daCamTrucKiem:()=>true,stageComplete:()=>false,kills:0,NEED_KILLS:5},Progress:{}};
 const controller={status:()=>({owner}),acquire(id){owner=id;return true},owns:id=>id===owner,release(){owner=null}};
 const doc={dispatchEvent:e=>events.push(e)};
 const runner=c.A.createIntro({getGame:()=>g,controller,logger:{add(){}},doc,host:{KeyboardEvent:class{constructor(t,p){Object.assign(this,p)}}},now:()=>time});
 return {g,runner,events,actions,controller,doc,tick(){time+=1000;runner.tick()}};
}
test('intro returns a new character to the herb map',()=>{const f=setup();assert.equal(f.runner.start({otherScriptsStopped:true}),true);f.tick();assert.deepEqual(f.actions,[['travel','tan_vien'],['interact','herb1']]);});
test('intro stops after completing stage 16',()=>{const f=setup(17);f.runner.start({otherScriptsStopped:true});f.tick();assert.equal(f.runner.status().state,'DONE');assert.equal(f.controller.status().owner,null);assert.equal(f.actions.length,0);});
test('intro does not interrupt the native purification ritual',()=>{const f=setup(4);f.g.SceneWorld.ritual={t:2};f.runner.start({otherScriptsStopped:true});f.tick();assert.equal(f.events.length,0);assert.equal(f.actions.length,0);});
test('intro accepts bamboo work before enabling combat',()=>{const f=setup(5);f.runner.start({otherScriptsStopped:true});f.tick();assert.deepEqual(f.actions,[['travel','thanh_truc_lam'],['interact','ly_thanh']]);assert.equal(f.events.length,0);});
test('intro stops native combat when manually stopped',()=>{const f=setup(5);f.runner.start({otherScriptsStopped:true});f.g.SceneWorld.autoOn=true;f.runner.stop();assert.equal(f.events[0].code,'KeyT');assert.equal(f.runner.status().running,false);});
test('intro will not start over another module',()=>{const f=setup();f.controller.acquire('garden');assert.equal(f.runner.start({otherScriptsStopped:true}),false);});

test('an explicit start resets the stop latch before reacquiring control',()=>{
 const f=setup();let reset=false;
 const acquire=f.controller.acquire;f.controller.acquire=id=>reset&&acquire(id);
 f.controller.reset=()=>{reset=true};
 assert.equal(f.runner.start({otherScriptsStopped:true}),true);
 assert.equal(f.controller.status().owner,'intro');
});
test('intro opens the medicine recipe by its accessible name then commits only its detail button',()=>{
 const f=setup(3);let selected=false,brewed=false;
 f.doc.querySelector=s=>s.includes(' h3')?{textContent:'Tẩy Tuỷ Thang'}:null;
 f.doc.querySelectorAll=s=>s.includes('bag-detail-actions')?[{disabled:false,textContent:'Luyện',click(){brewed=true}}]:[{getAttribute:()=> 'Tẩy Tuỷ Thang, luyện được',click(){selected=true}}];
 f.runner.start({otherScriptsStopped:true});f.g.HUD.dialogOpen=true;f.tick();assert.equal(selected,true);assert.equal(brewed,false);f.tick();assert.equal(brewed,true);
});
test('intro selects the bamboo sword from the bag before combat',()=>{
 const f=setup(5);f.g.Quest.flags.nhan_viec_ly_thanh=true;f.g.Quest.daCamTrucKiem=()=>false;
 let selected=false;f.doc.querySelector=s=>s.includes('data-item="truc_kiem"')?{click(){selected=true}}:null;f.doc.querySelectorAll=()=>[];
 f.runner.start({otherScriptsStopped:true});f.g.HUD.bagOpen=true;f.tick();assert.equal(selected,true);assert.equal(f.events.length,0);
});

test('stage 11 keeps combat enabled across ticks and disables it on stage 12',()=>{
 const f=setup(11); f.runner.start({otherScriptsStopped:true}); f.tick();
 assert.equal(f.events.filter(e=>e.code==='KeyT').length,2);
 f.g.SceneWorld.autoOn=true; f.tick(); f.tick();
 assert.equal(f.events.filter(e=>e.code==='KeyT').length,2);
 f.g.Quest.stage=12; f.tick();
 assert.equal(f.events.filter(e=>e.code==='KeyT').length,4);
});

test('stage 13 meditates uninterrupted until EXP is full, then returns to the stone',()=>{
 const f=setup(13); f.runner.start({otherScriptsStopped:true});
 f.g.SceneWorld.player.state='sit'; f.g.Quest.daoHanhFull=()=>false;
 f.tick(); f.tick(); assert.equal(f.events.length,0); assert.equal(f.runner.status().state,'MEDITATE');
 f.g.Quest.daoHanhFull=()=>true; f.tick(); assert.equal(f.events[0].code,'KeyQ');
 f.g.SceneWorld.player.state='idle'; f.tick();
 assert.deepEqual(f.actions.at(-1),['interact','dai_da_duoc']);
});

test('stages 9 and 12 select the requested recipe before confirming craft',()=>{
 for(const [stage,name] of [[9,'Linh Dược'],[12,'Tụ Khí Đan']]) {
  const f=setup(stage); let selected=0,crafted=0;
  f.doc.querySelector=()=>({textContent:name});
  f.doc.querySelectorAll=s=>s.includes('bag-detail-actions')?
   [{disabled:false,textContent:'Luyện',click(){crafted++}}]:
   [{disabled:false,getAttribute:()=>name+', luyện được',click(){selected++}}];
  f.runner.start({otherScriptsStopped:true}); f.g.HUD.dialogOpen=true; f.tick();
  assert.equal(selected,1); assert.equal(crafted,0); f.tick(); assert.equal(crafted,1);
 }
});

test('revive uses home if spot is unavailable, waits, then resumes the quest',()=>{
 const f=setup(9); let home=0;
 f.doc.querySelector=s=>s==='#downed'?{classList:{contains:()=>false}}:
  s==='#downed-spot'?{disabled:true}:s==='#downed-home'?{disabled:false,click(){home++}}:null;
 f.runner.start({otherScriptsStopped:true}); f.g.SceneWorld.player.downed=true;
 f.tick(); f.tick(); assert.equal(home,1); assert.equal(f.actions.length,0);
 f.g.SceneWorld.player.downed=false; f.tick();
 assert.deepEqual(f.actions.at(-1),['interact','dan_lo_vuon']);
});

test('stage 13 turns in to Dai Phu and final stage 17 stops',()=>{
 const f=setup(13); f.g.Quest.stageComplete=()=>true; f.runner.start({otherScriptsStopped:true});
 f.tick(); assert.deepEqual(f.actions.at(-1),['interact','dai_phu']);
 f.g.HUD.dialogOpen=true; f.tick(); assert.deepEqual(f.actions.at(-1),['click','Báo Công & Bái Tạ']);
 f.g.Quest.stage=17; f.tick(); assert.equal(f.runner.status().state,'DONE');
});

test('stage 13 clears respawned mobs before returning to meditation',()=>{
 const f=setup(13); f.g.SceneWorld.map.data={id:'vuon_ca_nhan'};
 f.runner.start({otherScriptsStopped:true}); f.g.SceneWorld.player.state='sit';
 f.g.SceneWorld.enemies=[{id:'dlt_1',hp:20,dead:false}]; f.tick();
 assert.equal(f.events[0].code,'KeyQ'); f.g.SceneWorld.player.state='idle'; f.tick();
 assert.equal(f.events.at(-1).code,'KeyT'); f.g.SceneWorld.autoOn=true; f.tick();
 assert.equal(f.events.filter(e=>e.code==='KeyT').length,2);
 f.g.SceneWorld.enemies[0].dead=true; f.tick();
 assert.equal(f.events.filter(e=>e.code==='KeyT').length,4);
 f.g.SceneWorld.autoOn=false; f.tick();
 assert.deepEqual(f.actions.at(-1),['interact','dai_da_duoc']);
});

test('full EXP takes priority over respawned mobs so stage 13 can finish',()=>{
 const f=setup(13); f.g.SceneWorld.map.data={id:'vuon_ca_nhan'};
 f.g.SceneWorld.enemies=[{id:'dlt_1',hp:20,dead:false}];
 f.g.Quest.daoHanhFull=()=>true; f.runner.start({otherScriptsStopped:true}); f.tick();
 assert.equal(f.events.length,0); assert.deepEqual(f.actions.at(-1),['interact','dai_da_duoc']);
});
