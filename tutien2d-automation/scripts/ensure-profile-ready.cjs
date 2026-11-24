const profile = Number(process.argv[2]);
if (!Number.isInteger(profile) || profile < 1 || profile > 20) throw new Error('Profile number must be 1..20.');
const port = 19300 + profile;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getPage() {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
  const pages = await response.json();
  const page = pages.find(x => x.type === 'page' && /^https:\/\/(www\.)?(tutien2d\.com|tutienpixel\.online)\//.test(x.url));
  if (!page) throw new Error(`Profile${String(profile).padStart(2, '0')}: game tab not found.`);
  return page;
}

async function evaluate(page, expression) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP evaluate timeout')), 5000);
      ws.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        clearTimeout(timeout);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result?.result?.value);
      };
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
  } finally { ws.close(); }
}

async function reload(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP reload timeout')), 5000);
      ws.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        clearTimeout(timeout);
        if (message.error) reject(new Error(message.error.message)); else resolve();
      };
      ws.send(JSON.stringify({ id: 1, method: 'Page.reload' }));
    });
  } finally { ws.close(); }
}

async function inspect() {
  const page = await getPage();
  const raw = await evaluate(page, `JSON.stringify({
    auto: window.TuTienAuto?.version || null,
    farm: window.TuTienStoneFarm?.version || null,
    ready: window.TuTienAuto?.report?.()?.snapshot?.ready === true,
    access: window.TuTienAuto?.report?.()?.access || null,
    character: !!document.querySelector('#hud-name')
  })`);
  return JSON.parse(raw || '{}');
}

(async () => {
  let state;
  for (let attempt = 0; attempt <= 3; attempt++) {
    state = await inspect();
    if (state.auto === '0.9.17' && state.farm === '2.0.27' && state.ready) {
      console.log(`Profile${String(profile).padStart(2, '0')}: scripts synced; character connection ready.`);
      process.exit(0);
    }
    if (attempt === 3) break;
    const page = await getPage();
    console.log(`Profile${String(profile).padStart(2, '0')}: connection not ready; reload ${attempt + 1}/3.`);
    await reload(page);
    await wait(9000);
  }
  console.error(JSON.stringify({
    profile, auto: state?.auto || null, farm: state?.farm || null,
    ready: state?.ready || false, character: state?.character || false,
    access: state?.access || null
  }));
  process.exitCode = 1;
})().catch(error => { console.error(`Profile${String(profile).padStart(2, '0')}: ${error.message}`); process.exitCode = 1; });
