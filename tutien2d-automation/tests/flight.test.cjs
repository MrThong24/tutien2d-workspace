const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(){
  const box=vm.createContext({Math});vm.runInContext('var A={};'+fs.readFileSync(path.join(__dirname,'../src/navigation/flight.js'),'utf8'),box);
  let time=10000;const events=[],records=[];
  const game={CONFIG:{PLAYER:{HITBOX_W:16,HITBOX_H:12}},SceneWorld:{player:{x:0,y:0,flying:false,setPath(){}},map:{data:{id:'a'},rectFlyBlocked:()=>false}},
    Player:{canFly:()=>true,inNoFlyZone:()=>false,flyOverTerrain:()=>true},Quest:{seedTaskInfo:()=>null},HUD:{}};
  const flight=box.A.createFlight({getGame:()=>game,doc:{dispatchEvent:e=>events.push(e)},host:{KeyboardEvent:class{constructor(type,data){this.type=type;Object.assign(this,data)}}},logger:{add:(event,data)=>records.push({event,data})},now:()=>time});
  return{game,flight,events,records,advance(ms){time+=ms}};
}
test('long journey requests F once and waits for confirmed flight state',()=>{
  const f=setup();assert.equal(f.flight.update({x:400,y:0}).waiting,true);
  f.flight.update({x:400,y:0});assert.equal(f.events.length,2);
  f.game.SceneWorld.player.flying=true;assert.equal(f.flight.update({x:400,y:0}).changed,true);
});
test('near destination requests landing and never treats a pending landing as complete',()=>{
  const f=setup();f.game.SceneWorld.player.flying=true;
  assert.equal(f.flight.update({x:60,y:0}).waiting,true);
  assert.equal(f.flight.update({x:60,y:0}).waiting,true);
  f.game.SceneWorld.player.flying=false;assert.equal(f.flight.update({x:60,y:0}).changed,true);
});
test('rejected takeoff falls back to walking without repeated F spam',()=>{
  const f=setup();f.flight.update({x:400,y:0});f.advance(2600);
  assert.equal(f.flight.update({x:400,y:0}).waiting,false);
  for(let i=0;i<10;i++)f.flight.update({x:400,y:0});
  assert.equal(f.events.length,2);
});
test('escort, convoy, and no-fly zone do not request takeoff',()=>{
  for(const mode of ['escort','convoy','zone']){
    const f=setup();if(mode==='escort')f.game.Quest.seedTaskInfo=()=>({kind:'escort'});
    if(mode==='convoy')f.game.SceneWorld.player.tieuXa=1;
    if(mode==='zone')f.game.Player.inNoFlyZone=()=>true;
    f.flight.update({x:400,y:0});assert.equal(f.events.length,0);
  }
});
test('blocked flight segment forces walking and cannot be used as a flight route',()=>{
  const f=setup();f.game.SceneWorld.player.flying=true;
  f.game.SceneWorld.map.rectFlyBlocked=(x)=>x>20;
  assert.equal(f.flight.pathAllowed(f.game,[{x:80,y:0}]),false);
  f.flight.ground();assert.equal(f.events.length,2);
});
test('failed landing stops instead of interacting in the air',()=>{
  const f=setup();f.game.SceneWorld.player.flying=true;
  f.flight.update(null,false);f.advance(2600);
  assert.throws(()=>f.flight.update(null,false),/phi hành/);
});
