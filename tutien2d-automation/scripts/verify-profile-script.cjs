const profile = Number(process.argv[2]);
const expected = process.argv[3];
if (!Number.isInteger(profile) || profile < 1 || profile > 20 || !expected) throw Error('Usage: verify-profile-script.cjs <profile> <version>');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readVersion() {
  const pages = await (await fetch(`http://127.0.0.1:${19300 + profile}/json/list`, { signal: AbortSignal.timeout(2500) })).json();
  const page = pages.find(p => p.type === 'page' && /^https:\/\/(www\.)?(tutien2d\.com|tutienpixel\.online)\//.test(p.url));
  if (!page) return null;
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  try {
    const packet = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('CDP evaluate timeout')), 3500);
      ws.onmessage = event => { const message = JSON.parse(event.data); if (message.id === 1) { clearTimeout(timer); resolve(message); } };
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'window.TuTienStoneFarm?.version || null', returnByValue: true } }));
    });
    return packet.result?.result?.value || null;
  } finally { ws.close(); }
}

(async () => {
  let actual = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    try { actual = await readVersion(); } catch (_) {}
    if (actual === expected) {
      console.log(`Profile${String(profile).padStart(2, '0')}: Auto quái ${actual} is active.`);
      return;
    }
    await wait(1000);
  }
  console.error(`Profile${String(profile).padStart(2, '0')}: expected Auto quái ${expected}, but found ${actual || 'not loaded'}.`);
  process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
