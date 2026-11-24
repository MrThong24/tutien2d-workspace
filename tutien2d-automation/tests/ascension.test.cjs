const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(nativeActions=null){
 const c=vm.createContext({});vm.runInContext('var A={};'+fs.readFileSync(path.join(__dirname,'../src/farm/ascension.js'),'utf8'),c);
 let time=10000,clicks=0,stone=0;const events=[];
 const game={SceneWorld:{player:{realmId:'luyen_khi_12'}},HUD:{dialogOpen:false},Breakthrough:{check:()=>({ready:false,blocked:null,next:{id:'luyen_khi_13'}})}};
 const button={disabled:false,textContent:'Bắt Đầu Phá Quan',getClientRects:()=>[{}],click:()=>clicks++};
 const doc={querySelector:s=>s==='#dialog-title'?{textContent:'Đột Phá Cảnh Giới'}:s==='#dialog-action'?button:null};
 const unit=c.A.createAscension({getGame:()=>game,doc,logger:{add:(event,data)=>events.push({event,data})},nativeActions,now:()=>time});
 return {game,unit,events,button,get clicks(){return clicks},get stone(){return stone},tick(){return unit.tick(()=>stone++)},advance(ms){time+=ms}};
}
test('missing any requirement never invokes a stone or spends a pill',()=>{const f=setup();f.tick();assert.equal(f.clicks,0);assert.equal(f.stone,0)});
test('ready conditions open the normal stone interaction',()=>{const f=setup();f.game.Breakthrough.check=()=>({ready:true,next:{id:'luyen_khi_13'}});assert.equal(f.tick(),true);assert.equal(f.stone,1);assert.equal(f.clicks,0)});
test('readiness is checked again immediately before confirming ascension',()=>{const f=setup();f.game.HUD.dialogOpen=true;let calls=0;f.game.Breakthrough.check=()=>({ready:++calls===1,next:{id:'luyen_khi_13'}});f.tick();assert.equal(f.clicks,0)});
test('one confirmation is latched until the realm actually changes',()=>{const f=setup();f.game.HUD.dialogOpen=true;f.game.Breakthrough.check=()=>({ready:true,next:{id:'luyen_khi_13'}});f.tick();f.tick();f.tick();assert.equal(f.clicks,1);assert.equal(f.unit.active(),true);f.game.SceneWorld.player.realmId='luyen_khi_13';f.tick();assert.equal(f.unit.active(),false);assert.equal(f.events.at(-1).event,'ASCENSION_CONFIRMED')});
test('no server confirmation times out without a second purchase or pill spend',()=>{const f=setup();f.game.HUD.dialogOpen=true;f.game.Breakthrough.check=()=>({ready:true,next:{id:'luyen_khi_13'}});f.tick();f.advance(120001);assert.throws(()=>f.tick(),/2 phút/);assert.equal(f.clicks,1)});
test('foundation encounter is not substituted with the normal ascension button',()=>{const f=setup();f.game.SceneWorld.player.realmId='luyen_khi_13';f.game.Breakthrough.check=()=>({ready:true,next:{id:'truc_co_1'}});assert.equal(f.tick(),false);assert.equal(f.clicks,0);assert.equal(f.stone,0)});

test('ascension clicks the dialog once without using the native helper and waits for a real realm change',()=>{
 let requested=0;const f=setup({request(){requested++;return true}});
 f.game.HUD.dialogOpen=true;f.game.SceneWorld.player.realmId='luyen_khi_5';
 f.game.Breakthrough.check=()=>({ready:true,next:{id:'luyen_khi_6'}});
 f.tick();f.advance(6000);f.tick();assert.equal(f.clicks,1);assert.equal(requested,0);
 assert.equal(f.unit.active(),true);f.game.SceneWorld.player.realmId='luyen_khi_6';f.tick();
 assert.equal(f.events.at(-1).event,'ASCENSION_CONFIRMED');assert.equal(f.unit.active(),false);
});

test('an unavailable native helper does not block the direct ascension button',()=>{
 const f=setup({request:()=>false});f.game.HUD.dialogOpen=true;
 f.game.Breakthrough.check=()=>({ready:true,next:{id:'luyen_khi_13'}});
 f.tick();assert.equal(f.unit.active(),true);assert.equal(f.clicks,1);
});
