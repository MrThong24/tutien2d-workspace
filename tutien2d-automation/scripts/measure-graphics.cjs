async function main() {
  const port = 19300 + Number(process.argv[2] || 1);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = pages.find(p => p.type === 'page' && /^https:\/\/(www\.)?tutien2d\.com\//.test(p.url));
  if (!page) throw Error('Không thấy tab game');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  let id=0; const pending=new Map();
  ws.onmessage=e=>{ const m=JSON.parse(e.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id)} };
  const call=(method,params={})=>new Promise(resolve=>{const n=++id;pending.set(n,resolve);ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const x=await call('Runtime.evaluate',{expression,returnByValue:true});if(x.error||x.result?.exceptionDetails)throw Error('Không đọc được dữ liệu game');return x.result.result.value;};
  const read=()=>evaluate(`(() => {const g=window.gameDebug,q=g?.Quality;return {level:q?.get?.()?.id,fpsLock:q?.fpsKhoa?.(),fps:g?.HUD?.fps,auto:!!window.TuTienStoneFarm?.status?.()?.running,map:g?.SceneWorld?.map?.data?.id}})()`);
  const metrics=async()=>Object.fromEntries((await call('Performance.getMetrics')).result.metrics.map(x=>[x.name,x.value]));
  await call('Performance.enable');
  const original=await read();
  if(!original.level || !Number.isFinite(original.fpsLock))throw Error('Không đọc được cấu hình để khôi phục');
  async function sample(level,lock) {
    const applied=await evaluate(`(() => {const q=window.gameDebug.Quality;return {level:q.set(${JSON.stringify(level)}).id,fpsLock:q.fpsKhoaDat(${lock})}})()`);
    if(applied.level!==level||applied.fpsLock!==lock)throw Error('Game chưa xác nhận cài đặt');
    await new Promise(r=>setTimeout(r,1500));
    const a=await metrics(),values=[],start=Date.now();
    for(let i=0;i<12;i++){await new Promise(r=>setTimeout(r,1000));values.push(await read());}
    const b=await metrics(),seconds=(Date.now()-start)/1000;
    return {setting:level,fpsLock:lock,seconds,mainThreadMsPerSecond:Math.round((b.TaskDuration-a.TaskDuration)*1000/seconds),
      scriptMsPerSecond:Math.round((b.ScriptDuration-a.ScriptDuration)*1000/seconds),heapMB:Math.round(b.JSHeapUsedSize/1048576),
      fps:values.map(x=>x.fps).filter(Number.isFinite),autoRunning:values.every(x=>x.auto),maps:[...new Set(values.map(x=>x.map))]};
  }
  let normal,light;
  try {normal=await sample(process.argv.includes('--fps20') ? 'sieu_lo' : 'binh_thuong',process.argv.includes('--fps20') ? 30 : 0);light=await sample('sieu_lo',process.argv.includes('--fps20') ? 20 : 30);}
  finally {await evaluate(`(() => {const q=window.gameDebug.Quality;q.set(${JSON.stringify(original.level)});q.fpsKhoaDat(${original.fpsLock})})()`);}
  const restored=await read();console.log(JSON.stringify({original,normal,light,restored},null,2));ws.close();
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
