const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup() {
 const c=vm.createContext({Date});vm.runInContext('var A={}',c);
 vm.runInContext(fs.readFileSync('src/core/combat-skills.js','utf8'),c);
 let time=10000,shown=false,enabled=false,accept=true;const clicks=[],logs=[];
 const defs=[{id:'hoa_cau',name:'Hỏa Cầu'},{id:'pvp',name:'PVP',playerTargetOnly:true},{id:'hidden',name:'Hidden'}];
 const g={SceneWorld:{player:{}},HUD:{bagOpen:false},Skills:{learnedSlots:()=>[0,1,2],slotDef:i=>defs[i],
  onBar:id=>id!=='hidden',autoUses:id=>id==='hoa_cau'&&enabled,coolLeft:()=>2.5}};
 const b=(name,fn)=>({disabled:false,getClientRects:()=>[{}],click(){clicks.push(name);fn()}});
 const nodes={
  '#hud-left':b('open',()=>g.HUD.bagOpen=true),
  '#bag-close':b('close',()=>g.HUD.bagOpen=false),
  '#bag [data-tab="tu-dong"]':b('tab',()=>shown=true),
  '#ht-tu-dong':{classList:{contains:()=>!shown}},
  '#td-list [data-td="0"]':{...b('enable',()=>{if(accept)enabled=!enabled}),getAttribute:()=>enabled?'true':'false'}
 };
 const doc={querySelector:s=>nodes[s]||null};
 const manager=c.A.createCombatSkills({getGame:()=>g,doc,logger:{add:(...a)=>logs.push(a)},now:()=>time});
 return {g,clicks,logs,manager,nodes,tick(ms=500){time+=ms;return manager.prepare()},reject(){accept=false},enable(){enabled=true}};
}
test('native settings enable learned visible PvE skill and close the inventory',()=>{
 const f=setup();let done=false;for(let i=0;i<8&&!done;i++)done=f.tick();
 assert.equal(done,true);assert.deepEqual(f.clicks,['open','tab','enable','close']);
 assert.equal(f.manager.status().skills[0].enabled,true);assert.equal(f.g.HUD.bagOpen,false);
 assert.equal(f.logs[0][0],'COMBAT_SKILL_ENABLED');
});
test('already enabled skill is never toggled off and needs no menu',()=>{
 const f=setup();f.enable();assert.equal(f.tick(),true);assert.equal(f.tick(),true);assert.equal(f.clicks.length,0);
});
test('hidden and player-only skills are not automatically enabled',()=>{
 const f=setup();for(let i=0;i<8;i++)f.tick();
 const rows=f.manager.status().skills;assert.equal(rows[1].enabled,false);assert.equal(rows[2].enabled,false);
 assert.equal(f.clicks.filter(c=>c==='enable').length,1);
});
test('unconfirmed setting change times out instead of repeated toggles',()=>{
 const f=setup();f.reject();f.tick();f.tick();f.tick();
 assert.throws(()=>f.tick(3500),/chưa xác nhận/);assert.equal(f.clicks.filter(c=>c==='enable').length,1);
});
test('reading cooldowns does not trigger skill casts',()=>{
 const f=setup();assert.equal(f.manager.status().skills[0].cooldown,2.5);assert.equal(f.clicks.length,0);
});
