// Local, read-only inspection unless an explicit --load argument is given.
const fs = require('fs');
async function main() {
  const port = Number(process.env.STONE_PROFILE_PORT || 19301);
  const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
  const page = pages.find(p => /^https:\/\/(www\.)?tutien2d\.com\//.test(p.url));
  if (!page) throw Error('No game page on monitored Profile01');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let next = 0; const pending = new Map();
  ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  async function evaluate(expression) {
    const id = ++next;
    const result = new Promise(resolve => pending.set(id, resolve));
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
    const response = await result;
    if (response.error || response.result?.exceptionDetails) throw Error(JSON.stringify(response.error || response.result.exceptionDetails));
    return response.result?.result?.value;
  }
  if (process.argv.includes('--load')) await evaluate(fs.readFileSync('dist/tutien2d-farm-linh-thach-1.0.0.user.js', 'utf8'));
  if (process.argv.includes('--start')) await evaluate('window.TuTienStoneFarm.start()');
  if (process.argv.includes('--stop')) await evaluate('window.TuTienStoneFarm.stop()');
  if (process.argv.includes('--map-test')) {
    const result = await evaluate(`(() => {const api = window.TuTienStoneFarm; if (api.status().running) return {error:'Auto đang chạy'}; const maps = api.maps(); const selected = maps.find(m => m.id !== window.gameDebug?.SceneWorld?.map?.data?.id) || maps[0]; if (!selected) return {error:'Không có map phù hợp'}; const started = api.start({mapId:selected.id}); const status = api.status(); if (started) api.stop('Đã kiểm tra lựa chọn map.'); return {selected,started,preferred:status.preferredMapId,message:status.message};})()`);
    console.log(JSON.stringify(result)); ws.close(); return;
  }
  if (process.argv.includes('--heal-events')) {
    const result = await evaluate(`(() => { const r=window.TuTienStoneFarm?.report?.(); return {status:r?.status, events:r?.events?.filter(e=>/HEAL|NAV_STATE|STONE_MAP|STONE_STATE/.test(e.event)).slice(-35)}; })()`);
    console.log(JSON.stringify(result,null,2)); ws.close(); return;
  }
  if (process.argv.includes('--quality')) {
    const result = await evaluate(`(() => {const g=window.gameDebug, q=g?.Quality; return {quality: q && Object.fromEntries(Object.keys(q).map(k=>[k,typeof q[k] === 'function' ? String(q[k]).slice(0,800) : q[k]])),weather: g?.Weather && {mode: g.Weather.mode?.(), setMode: String(g.Weather.setMode)}, fps:g?.HUD?.fps, fpsOptions:[...document.querySelectorAll('#menu-fps [data-gia]')].map(e=>({v:e.dataset.gia,text:e.textContent.trim()}))};})()`);
    console.log(JSON.stringify(result,null,2)); ws.close(); return;
  }
  if (process.argv.includes('--graphics-test')) {
    const source = fs.readFileSync('../ChromeGridApp/MonitorView.cs', 'utf8');
    const code = source.match(/private const string Expression = @"([\s\S]*?)";/)?.[1];
    const expression = command => code.replaceAll('__RUN_COMMAND__', JSON.stringify(command)).replaceAll('__AUTO_SESSION__', 'null').replaceAll('__DETAIL__', 'false').replaceAll('""', '"');
    const read = () => evaluate(`(() => {const q=window.gameDebug?.Quality;return {level:q?.get?.()?.id,fps:q?.fpsKhoa?.(),playing:!!window.TuTienStoneFarm?.status?.()?.running}})()`);
    const before = await read(); let applied, after, restored;
    try { applied = JSON.parse(await evaluate(expression('optimizeGraphics'))).auto; after = await read(); }
    finally { restored = JSON.parse(await evaluate(expression('restoreGraphics'))).auto; }
    console.log(JSON.stringify({ before, applied, after, restored, final: await read() }, null, 2)); ws.close(); return;
  }
  if (process.argv.includes('--monitor')) {
    const source = fs.readFileSync('../ChromeGridApp/MonitorView.cs', 'utf8');
    const code = source.match(/private const string Expression = @"([\s\S]*?)";/)?.[1];
    if (!code) throw Error('Monitor expression not found');
    const expression = code.replaceAll('__RUN_COMMAND__', 'null').replaceAll('__AUTO_SESSION__', 'null').replaceAll('__DETAIL__', 'true').replaceAll('""', '"');
    console.log(await evaluate(expression)); ws.close(); return;
  }
  const result = await evaluate(`(() => { const a = window.TuTienAuto?.status?.(); const g = window.gameDebug;
    return {farm: window.TuTienStoneFarm?.report?.() || null, mainRunning: ['automation','intro','quests','garden','navigation'].some(k => a?.[k]?.running),
    game: {ready: !!g?.Gateway?.ready, autoOn: !!g?.SceneWorld?.autoOn, flying: !!g?.SceneWorld?.player?.flying, canFly: g?.Player?.canFly?.(g?.SceneWorld?.player), map: g?.SceneWorld?.map?.data?.id, name: !!document.getElementById('hud-name')?.textContent?.trim()}}; })()`);
  console.log(JSON.stringify(result, null, 2)); ws.close();
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
