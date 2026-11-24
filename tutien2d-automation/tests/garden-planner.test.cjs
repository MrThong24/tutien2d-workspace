const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture() {
 const c=vm.createContext({Math,Set});vm.runInContext('var A={}',c);
 vm.runInContext(fs.readFileSync('src/farm/garden-planner.js','utf8'),c);
 const g={SceneWorld:{enemies:[],brewCooldownUntil:0},Game:{time:100},
  Farm:{SEEDS:[{seed:'hat_linh_ngoc',crop:'linh_ngoc_diep'},{seed:'hat_xich_duong',crop:'xich_duong_thao'}]},
  Quest:{packUnlocked:p=>!p.locked,SEED_PACKS:[{id:'linh',cost:5,give:[['hat_linh_ngoc',3],['hat_xich_duong',3]]}]}};
 const data={experience:{current:630,target:630,full:true},breakthrough:{ready:false},
  plots:[],seeds:[],water:true,duocCong:20,
  goal:{id:'luyen_khi_dan',name:'Luyện Khí Đan',need:1,have:0,materials:[
   {id:'linh_ngoc_diep',qty:3,have:0},{id:'xich_duong_thao',qty:3,have:0},{id:'linh_thuy',qty:4,have:4}]}};
 return {g,data,plan:opts=>c.A.planGarden(g,data,opts)};
}
test('missing EXP prioritizes native combat before buying seeds',()=>{
 const f=fixture();f.data.experience.full=false;f.g.SceneWorld.enemies=[{id:'dlt_1',hp:20}];assert.equal(f.plan().kind,'combat');
});
test('no live mobs and missing EXP selects bonus stone meditation',()=>{
 const f=fixture();f.data.experience.full=false;f.data.goal.have=1;assert.equal(f.plan().kind,'meditate');
});
test('all conditions ready prioritizes breakthrough over respawned mobs',()=>{
 const f=fixture();f.data.breakthrough.ready=true;f.g.SceneWorld.enemies=[{id:'dlt_1',hp:20}];assert.equal(f.plan().kind,'ascend');
});
test('full EXP with growing herbs waits without opening an unsuccessful breakthrough',()=>{
 const f=fixture();f.data.plots=[...Array(3)].map((_,i)=>({id:'plot_'+i,seed:'hat_linh_ngoc',crop:'linh_ngoc_diep'}))
  .concat([...Array(3)].map((_,i)=>({id:'plot_'+(i+3),seed:'hat_xich_duong',crop:'xich_duong_thao'})));
 assert.equal(f.plan().kind,'waitGarden');
 f.g.SceneWorld.enemies=[{id:'dlt_2',hp:10}];assert.equal(f.plan().kind,'combat');
});
test('ripe herbs are harvested even while mobs respawn once EXP is full',()=>{
 const f=fixture();f.data.plots=[{id:'plot_1',seed:'hat_linh_ngoc',crop:'linh_ngoc_diep',ready:true}];
 f.g.SceneWorld.enemies=[{id:'dlt_1',hp:20}];assert.equal(f.plan().kind,'harvest');
});
test('enough ingredients selects the required pill, not a fixed recipe',()=>{
 const f=fixture();f.data.goal.materials.forEach(m=>m.have=m.qty);const p=f.plan();
 assert.equal(p.kind,'brew');assert.equal(p.recipe.id,'luyen_khi_dan');
 f.data.goal.id='pha_canh_dan';assert.equal(f.plan().recipe.id,'pha_canh_dan');
});
test('only seeds for the current missing recipe are sown',()=>{
 const f=fixture();f.data.plots=[{id:'plot_1',seed:null}];
 f.data.seeds=[{id:'hat_linh_diep',crop:'linh_diep',qty:10},{id:'hat_xich_duong',crop:'xich_duong_thao',qty:3}];
 assert.equal(f.plan().kind,'sow');assert.equal(f.plan().seed,'hat_xich_duong');
});
test('water is unlocked before watering a dry plot',()=>{
 const f=fixture();f.data.plots=[{id:'plot_1',seed:'hat_xich_duong',crop:'xich_duong_thao',dry:true}];
 f.data.water=false;assert.equal(f.plan().kind,'waterAccess');f.data.water=true;assert.equal(f.plan().kind,'water');
});
test('only an affordable unlocked pack matching the missing crops is exchanged',()=>{
 const f=fixture();f.g.Quest.SEED_PACKS.unshift({id:'wrong',cost:1,give:[['hat_linh_diep',9]]},{id:'locked',cost:2,locked:true,give:[['hat_linh_ngoc',3]]});
 const p=f.plan();assert.equal(p.kind,'buySeeds');assert.equal(p.pack.id,'linh');
 f.data.duocCong=4;assert.equal(f.plan().kind,'waitResources');
});
test('inventory and planted crops prevent repeat purchases for the same pill',()=>{
 const f=fixture();f.data.goal.materials[0].have=3;
 f.data.plots=[...Array(3)].map((_,i)=>({id:'plot_'+i,seed:'hat_xich_duong',crop:'xich_duong_thao'}));
 assert.equal(f.plan().kind,'waitGarden');
});
test('partial pill stock scales herb demand to the number of pills still missing',()=>{
 const f=fixture();f.data.goal.need=3;f.data.goal.have=1;
 f.data.goal.materials[0].have=3;f.data.goal.materials[1].have=3;f.data.goal.materials[2].have=0;
 // One batch of herbs is insufficient for two pills; a matching pack is needed.
 assert.equal(f.plan().kind,'buySeeds');
});
