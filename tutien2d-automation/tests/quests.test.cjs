const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function setup() {
  const context = vm.createContext({ Date, Set, Map, Math });
  vm.runInContext('var A={};', context);
  for (const f of ['core/controller.js','core/logger.js','quests/quest-reader.js','quests/quest-runner.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',f),'utf8'), context);
  }
  const A = context.A;
  let time = 10000, active = null, progress = 0, complete = false;
  const rows = ['linh_chi','cau_ca','ho_tong_chau','truc_gia','duoc_moc','dai_hoi','van_tieu','chien_bang'].map(id => ({
    def: { id, shortName: id, need: 3 }, runsLeft: 3, locked: id === 'van_tieu', exhausted: false
  }));
  const g = { SceneWorld: { player: { hp: 100, hpMax: 100, state:'idle',setPath(){} }, map:{data:{id:'duoc_vien'}} },
    Progress:{duocCong:0}, HUD:{dialogOpen:true}, Quest:{seedQuest:{round:0}, seedTaskList:()=>rows,
    seedTaskInfo:()=>active, seedQuestProgress:()=>progress, seedQuestComplete:()=>complete } };
  const buttons = [];
  const doc = { querySelector(s){return s==='#dialog-title'?{textContent:'Đại Phu'}:null},
    querySelectorAll(){return buttons},dispatchEvent(){} };
  const controller = A.createController(), logger=A.createLogger();
  const events=[];doc.dispatchEvent=e=>events.push(e);
  const runner=A.createQuestRunner({getGame:()=>g,doc,host:{KeyboardEvent:class{constructor(type,props){this.type=type;Object.assign(this,props)}}},controller,logger,now:()=>time});
  return {A,g,rows,buttons,controller,logger,runner,events,
    tick(ms=1000){time+=ms;runner.tick()},
    active(id,done=false){active=rows.find(r=>r.def.id===id)?.def||null;complete=done},
    progressSet(v){progress=v},
    award(){active=null;g.Quest.seedQuest.round++;g.Progress.duocCong+=3},
    button(text,fn){buttons.push({textContent:text,disabled:false,getClientRects:()=>[{}],click:fn})}
  };
}
test('catalog accounts for all eight jobs, separating locked and unimplemented activities',()=>{
  const f=setup(), c=f.A.readDuocCong(f.g);
  assert.equal(c.tasks.length,8);
  assert.equal(c.tasks.filter(t=>t.status==='READY').length,5);
  assert.equal(c.tasks.find(t=>t.id==='van_tieu').status,'LOCKED');
  assert.equal(c.tasks.find(t=>t.id==='dai_hoi').status,'NEEDS_ADAPTER');
});
test('Linh Chi batches nine mushrooms before returning after the first three',()=>{
  const f=setup();f.active('linh_chi',true);f.progressSet(3);f.g.HUD.dialogOpen=false;
  let count=3;f.g.Inventory={count:id=>id==='nam_linh_chi'?count:0,has:()=>true};
  const herb={id:'linh_chi_1',x:208,y:128,r:40};
  f.g.CONFIG={TILE:32};f.g.SceneWorld.map.data.id='tan_vien';f.g.SceneWorld.map.props=[herb];
  f.g.SceneWorld.player.x=208;f.g.SceneWorld.player.y=145.415;
  f.g.Quest.seedTaskInfo=()=>({id:'linh_chi',kind:'collect',item:'nam_linh_chi',need:3,propIds:['linh_chi_1']});
  f.g.Quest.autoSeedStep=()=>({act:'nop',place:{mapId:'duoc_vien',ids:['dai_phu']}});
  f.g.Targeting={list:[{}],current:()=>({obj:herb,kind:'prop',dist:33.415,r:64}),cycle(){}};
  f.runner.start({otherScriptsStopped:true});f.tick();
  assert.equal(f.runner.status().state,'EXECUTE_TASK', JSON.stringify(f.runner.status()));
  assert.equal(f.events.filter(e=>e.code==='KeyE').length,2);
});
test('refuses to run while game Auto is active and takes no control',()=>{
  const f=setup();f.g.SceneWorld.autoOn=true;
  assert.equal(f.runner.start({otherScriptsStopped:true}),false);
  assert.equal(f.controller.status().owner,null);
});
test('existing competition job is preserved, never silently cancelled',()=>{
  const f=setup();f.active('chien_bang');
  f.runner.start({otherScriptsStopped:true});f.tick();
  assert.equal(f.runner.status().state,'PENDING_ACTIVITIES');
  assert.equal(f.A.readDuocCong(f.g).active.id,'chien_bang');
  assert.equal(f.controller.status().owner,null);
});
test('never accepts a preexisting offer until its own task selection is verified',()=>{
  const f=setup();let clicked=0;
  f.button('Nhận Việc Này',()=>clicked++);
  f.runner.start({otherScriptsStopped:true});f.tick();
  assert.equal(clicked,0);
});
test('normal dialog turn-in must produce a new round before completion is recorded',()=>{
  const f=setup();f.active('duoc_moc',true);
  f.button('Giao Nguyên Liệu',()=>f.award());
  f.runner.start({otherScriptsStopped:true,maxRuns:1});f.tick();f.tick();
  assert.equal(f.runner.status().state,'DONE');
  assert.equal(f.runner.status().completed,1);
  const e=f.logger.records().find(e=>e.event==='QUEST_COMPLETED');
  assert.equal(e.data.duocCongDelta,3);
});

test('stage 16 main dialogue opens the daily ledger before turning in herbs',()=>{
 const f=setup();f.g.Quest.stage=16;f.active('linh_chi',true);f.progressSet(9);
 f.g.Inventory={count:()=>9};let opened=0,wrong=0;
 f.button('Báo Công',()=>wrong++);
 f.button('Sổ Dược Công · đổi hạt',()=>{
  opened++;f.buttons.length=0;f.button('Giao Nguyên Liệu',()=>f.award());
 });
 f.runner.start({otherScriptsStopped:true,maxRuns:1});f.tick();
 assert.equal(opened,1);assert.equal(wrong,0);assert.equal(f.runner.status().completed,0);
 f.tick();f.tick();assert.equal(f.runner.status().state,'DONE');
 assert.equal(f.runner.status().completed,1);assert.equal(f.g.Progress.duocCong,3);
});
test('missing server confirmation never yields a completion claim',()=>{
  const f=setup();f.active('duoc_moc',true);
  f.button('Giao Nguyên Liệu',()=>{});
  f.runner.start({otherScriptsStopped:true,maxRuns:1});f.tick();f.tick(181000);
  assert.equal(f.runner.status().completed,0);
  assert.equal(f.runner.status().state,'ERROR');
});
test('Stop prevents any later dialog mutation and releases control',()=>{
  const f=setup();let clicks=0;f.active('duoc_moc',true);
  f.button('Giao Nguyên Liệu',()=>clicks++);
  f.runner.start({otherScriptsStopped:true});f.runner.stop();f.tick();
  assert.equal(clicks,0);assert.equal(f.controller.status().owner,null);
});
test('waypoint arrival margin permits normal interaction without reissuing a stuck path',()=>{
  const f=setup();f.active('linh_chi');f.g.HUD.dialogOpen=false;
  f.g.CONFIG={TILE:32};f.g.SceneWorld.map.data.id='tan_vien';
  const herb={id:'linh_chi_1',x:208,y:128,r:40};
  f.g.SceneWorld.map.props=[herb];f.g.SceneWorld.player.x=208;f.g.SceneWorld.player.y=145.415;
  f.g.Quest.autoSeedStep=()=>({act:'hai',place:{mapId:'tan_vien',ids:['linh_chi_1']}});
  f.g.Targeting={list:[{}],current:()=>({obj:herb,kind:'prop',dist:33.415,r:64}),cycle(){}};
  f.runner.start({otherScriptsStopped:true});f.tick();
  assert.equal(f.events.filter(e=>e.code==='KeyE').length,2);
  assert.notEqual(f.runner.status().state,'ERROR');
});
test('Dược Mộc can route to a tile center within pickup range of an unaligned falling branch',()=>{
  const f=setup();f.active('duoc_moc');f.g.HUD.dialogOpen=false;
  f.g.CONFIG={TILE:32};f.g.Loot={PICK_R:40};
  f.g.SceneWorld.player.x=1135.56;f.g.SceneWorld.player.y=586.82;
  f.g.SceneWorld.drops=[{materialId:'branch',task:'duoc_moc',state:'fall',x:1058.856,y:700,gy:777.059}];
  f.g.Quest.autoSeedStep=()=>({act:'chat',place:{mapId:'duoc_vien',ids:['co_thu_linh_moc']}});
  f.A.tileCenter=(g,tx,ty)=>({x:tx*32+16,y:ty*32+16});
  f.A.makePath=(g,point)=>[point];
  let assigned=null;f.g.SceneWorld.player.setPath=p=>{assigned=p};
  f.runner.start({otherScriptsStopped:true});f.tick();
  assert.ok(assigned?.length);
  const end=assigned.at(-1);
  assert.ok(Math.hypot(end.x-1058.856,end.y-777.059)<=28);
  assert.equal(f.runner.status().state,'EXECUTE_TASK');
});
