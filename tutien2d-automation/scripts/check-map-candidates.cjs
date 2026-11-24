const fs = require('fs');
async function main() {
  const profile = Number(process.argv[2] || 1);
  const pages = await (await fetch(`http://127.0.0.1:${19300 + profile}/json/list`)).json();
  const page = pages.find(p => p.type === 'page' && /^https:\/\/(www\.)?tutien2d\.com\//.test(p.url));
  if (!page) throw Error('Không thấy game');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const expression = `(() => { const A = {}; ${fs.readFileSync('src/navigation/map-graph.js','utf8')}\n${fs.readFileSync('src/farm/stone-planner.js','utf8')}\nreturn A.stoneFarmCandidates(window.gameDebug).map(({id,name}) => ({id,name})); })()`;
  const result = new Promise(resolve => { ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) resolve(m); }; });
  ws.send(JSON.stringify({id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true }}));
  console.log(JSON.stringify(await result, null, 2)); ws.close();
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
