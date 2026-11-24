const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(stage=1,combatSkills=null) {
 const c=vm.createContext({Math,Date,Number,Object});vm.runInContext('var A={}',c);
 vm.runInContext(fs.readFileSync('src/core/controller.js','utf8'),c);
 vm.runInContext(fs.readFileSync('src/core/auto-runner.js','utf8'),c);
 const controller=c.A.createController(),calls=[],events=[],nodes={},timers=[];
 let time=10000;
 const f={catalog:{available:true,tasks:[{id:'linh_chi',status:'READY'}],active:null}};
 c.A.readDuocCong=()=>f.catalog;
 const g={Quest:{stage,canOpenSeedMenu:()=>true},HUD:{},SceneWorld:{player:{hp:100,hpMax:100,state:'idle',setPath(){}},map:{data:{id:'tan_vien'}}}};
 const make=(name,owner)=>{
  let state='IDLE',running=false,detail='';
  return {status:()=>({running,state,message:detail}),
   start(options){calls.push(['start',name,options]);running=true;state='RUNNING';controller.acquire(owner);return true},
   stop(reason){calls.push(['stop',name]);running=false;state='STOPPED';detail=reason;controller.release(owner)},
   finish(s='DONE',m=''){running=false;state=s;detail=m;controller.release(owner)}};
 };
 const intro=make('intro','intro'),quests=make('quests','quest'),garden=make('garden','garden'),navigation=make('navigation','navigation');
 const nativeActions={cancel(){calls.push(['cancel'])}};
 const doc={querySelector:s=>nodes[s]||null,dispatchEvent:e=>events.push(e)};
 const host={KeyboardEvent:class{constructor(type,p){this.type=type;Object.assign(this,p)}},setTimeout:f=>timers.push(f)};
 const auto=c.A.createAutoRunner({getGame:()=>g,doc,host,intro,quests,garden,navigation,nativeActions,controller,combatSkills,logger:{add(){}},now:()=>time});
 return Object.assign(f,{g,auto,calls,events,nodes,timers,intro,quests,garden,navigation,controller,
  start(){return auto.start({otherScriptsStopped:true})},tick(){time+=1000;auto.tick()}});
}
test('new account runs intro and hands off at stage 14 before continuing with Dược Công',()=>{
 const f=setup(0);assert.equal(f.start(),true);f.tick();
 assert.equal(f.auto.status().worker,'INTRO');assert.equal(f.calls[0][2].stopAtStage,14);
 f.g.Quest.stage=14;f.tick();assert.equal(f.intro.status().running,false);
 f.tick();assert.equal(f.auto.status().worker,'QUESTS');assert.equal(f.controller.status().owner,'quest');
});
test('accounts at stages 15, 16 and later never restart intro',()=>{
 for(const stage of [15,16,23]){const f=setup(stage);f.start();f.tick();assert.equal(f.auto.status().worker,'QUESTS');assert.ok(!f.calls.some(a=>a[1]==='intro'));}
});
test('quest completion goes to garden only after no runnable or active jobs remain',()=>{
 const f=setup(15);f.start();f.tick();
 f.catalog.tasks=[];f.quests.finish();f.tick();f.tick();
 assert.equal(f.auto.status().worker,'GARDEN');assert.equal(f.controller.status().owner,'garden');
 assert.equal(f.quests.status().running,false);
});
test('unfinished unsupported jobs are listed instead of reported as completed',()=>{
 const f=setup(15);f.catalog.tasks=[{id:'convoy',name:'Vận Tiêu',status:'NEEDS_ADAPTER'}];
 f.start();f.tick();f.tick();assert.equal(f.auto.status().worker,'GARDEN');
 assert.deepEqual(Array.from(f.auto.status().pending),['Vận Tiêu']);
 assert.ok(f.auto.status().message.includes('chưa hỗ trợ'));
});
test('an active unsupported job is preserved and prevents garden handoff',()=>{
 const f=setup(16);f.catalog.tasks=[{id:'convoy',status:'NEEDS_ADAPTER',name:'Vận Tiêu'}];
 f.catalog.active={id:'convoy',name:'Vận Tiêu',supported:false};f.start();f.tick();
 assert.equal(f.auto.status().state,'NEEDS_MANUAL');assert.equal(f.catalog.active.id,'convoy');
 assert.ok(!f.calls.some(a=>a[0]==='start'));
});
test('last accepted daily job remains runnable even after its acceptance uses the last run',()=>{
 const f=setup(15);f.catalog.tasks=[{id:'linh_chi',status:'EXHAUSTED'}];
 f.catalog.active={id:'linh_chi',name:'Linh Chi',supported:true};f.start();f.tick();
 assert.equal(f.auto.status().worker,'QUESTS');
});
test('an error is not mistaken for all quests being finished',()=>{
 const f=setup(15);f.start();f.tick();f.quests.finish('ERROR','Kẹt đường');f.tick();f.tick();
 assert.equal(f.auto.status().state,'ERROR');assert.equal(f.auto.status().message,'Kẹt đường');
 assert.ok(!f.calls.some(a=>a[0]==='start'&&a[1]==='garden'));
});
test('Stop cancels the active worker and later ticks cannot start the next phase',()=>{
 const f=setup(15);f.start();f.tick();f.auto.stop();const n=f.calls.length;
 f.catalog.tasks=[];f.tick();f.tick();assert.equal(f.calls.length,n);assert.equal(f.controller.status().owner,null);
});
test('revival returns to the same garden phase without redoing daily work',()=>{
 const f=setup(15);f.catalog.tasks=[];f.start();f.tick();f.tick();
 let revived=0;f.g.SceneWorld.player.downed=true;
 f.nodes['#downed']={classList:{contains:()=>false}};
 f.nodes['#downed-spot']={disabled:true};f.nodes['#downed-home']={disabled:false,click(){revived++}};
 f.tick();assert.equal(revived,1);assert.equal(f.auto.status().next,'GARDEN');
 assert.equal(f.garden.status().running,false);f.tick();assert.equal(revived,1);
 f.g.SceneWorld.player.downed=false;f.tick();f.tick();
 assert.equal(f.auto.status().worker,'GARDEN');assert.ok(!f.calls.some(a=>a[0]==='start'&&a[1]==='quests'));
});
test('phase handoff closes dialog and bag then stands before starting the next worker',()=>{
 const f=setup(15);let closed=0;f.g.HUD.dialogOpen=true;f.nodes['#dialog-close']={click(){closed++;f.g.HUD.dialogOpen=false}};
 f.start();f.tick();assert.equal(closed,1);assert.equal(f.auto.status().worker,null);
 f.g.HUD.bagOpen=true;f.tick();assert.equal(f.events.at(-1).code,'KeyB');
 f.g.HUD.bagOpen=false;f.g.SceneWorld.player.state='sit';f.tick();assert.equal(f.events.at(-1).code,'KeyQ');
 f.g.SceneWorld.player.state='idle';f.tick();assert.equal(f.auto.status().worker,'QUESTS');
});
test('preparation holds an arrow long enough to cancel native fishing',()=>{
 const f=setup(15);f.g.SceneWorld.fishing=true;f.start();f.tick();
 assert.equal(f.events.length,1);assert.equal(f.events[0].type,'keydown');
 f.timers[0]();assert.equal(f.events.at(-1).type,'keyup');
 f.g.SceneWorld.fishing=false;f.tick();assert.equal(f.auto.status().worker,'QUESTS');
});
test('start refuses a missing confirmation or another controlling worker',()=>{
 const f=setup(15);assert.equal(f.auto.start(),false);assert.equal(f.calls.length,0);
 f.controller.acquire('garden');assert.equal(f.start(),false);assert.equal(f.controller.status().owner,'garden');
});

test('skill preparation may keep its inventory open until settings are confirmed',()=>{
 let configuring=false,attempts=0;let f;
 const skills={status:()=>({configuring}),reset(){configuring=false},prepare(){
  attempts++;if(attempts===1){configuring=true;f.g.HUD.bagOpen=true;return false;}
  f.g.HUD.bagOpen=false;configuring=false;return true;
 }};
 f=setup(15,skills);f.start();f.tick();assert.equal(f.auto.status().worker,null);
 f.tick();assert.equal(f.auto.status().worker,'QUESTS');assert.equal(f.events.length,0);
});
