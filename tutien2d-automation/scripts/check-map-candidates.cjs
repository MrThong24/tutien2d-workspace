const fs = require('node:fs');

async function main() {
  const profile = Number(process.argv[2] || 1);
  if (!Number.isInteger(profile) || profile < 1 || profile > 20) throw Error('Profile must be 1..20.');
  const pages = await (await fetch(`http://127.0.0.1:${19300 + profile}/json/list`, { signal: AbortSignal.timeout(2500) })).json();
  const page = pages.find(p => p.type === 'page' && /^https:\/\/(www\.)?(tutien2d\.com|tutienpixel\.online)\//.test(p.url));
  if (!page) throw Error(`Profile${String(profile).padStart(2, '0')}: không thấy tab game đang được theo dõi.`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const graph = fs.readFileSync('src/navigation/map-graph.js', 'utf8');
  const planner = fs.readFileSync('src/farm/stone-planner.js', 'utf8');
  const expression = `(() => { const A = {}; ${graph}\n${planner}
    const game = [window.gameDebug, window.PNTT].find(g => g?.SceneWorld?.player && g?.SceneWorld?.map?.data?.id);
    if (!game) return {error:'Chưa kết nối được dữ liệu nhân vật/map.'};
    const maps = A.maps(game.MapData), current = game.SceneWorld.map.data.id;
    const candidates = A.stoneFarmCandidates(game);
    const rows = [...maps].map(([id,map]) => {
      const reasons = [], route = A.mapRoute(game.MapData, current, id);
      if (map.scope !== 'shared') reasons.push('map không phải khu chung');
      if (!Array.isArray(map.enemies)) reasons.push('map không có danh sách quái');
      if (!route) reasons.push('không có đường đi tự động từ map hiện tại');
      const spawns = Array.isArray(map.enemies) ? map.enemies.filter(e =>
        (id !== 'mo_linh_thach' || e.type === 'thach_ma') &&
        (!e.requireStage || (Number.isInteger(game.Quest?.stage) && game.Quest.stage >= e.requireStage))) : [];
      if (spawns.some(e => game.ENEMY_DEFS?.[e.type]?.isBoss)) reasons.push('bãi có boss trong danh sách spawn');
      const eligible = spawns.filter(e => A.stoneFarmEnemy(game, { ...e, stoneRate: e.stoneRate || map.stoneRate }, id));
      if (!eligible.length && !reasons.length) reasons.push('không xác nhận được quái rơi Linh Thạch hoặc chỉ số an toàn');
      const included = candidates.some(m => m.id === id);
      return {id, name:map.name||id, scope:map.scope||null, included, hops:route?.length??null,
        enemies:[...new Set(eligible.map(e=>e.type))], excludedBecause:included?[]:reasons};
    });
    return {profile:${profile}, currentMap:current, realm:game.SceneWorld.player.realmId||game.Progress?.realmId||null,
      stage:game.Quest?.stage??null, candidates:candidates.map(({id,name,hops,types})=>({id,name,hops,enemies:types})), maps:rows};
  })()`;
  try {
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('CDP timeout')), 5000);
      ws.onmessage = event => { const msg = JSON.parse(event.data); if (msg.id === 1) { clearTimeout(timer); resolve(msg); } };
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    if (result.error) throw Error(result.error.message);
    const value = result.result?.result?.value;
    if (!value) throw Error(result.result?.exceptionDetails?.text || 'Game did not return map data.');
    console.log(JSON.stringify(value, null, 2));
  } finally { ws.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
