async function inspect(index) {
  const port = 19300 + index, base = `http://127.0.0.1:${port}`;
  try {
    const targets = await (await fetch(base + '/json/list', { signal: AbortSignal.timeout(2500) })).json();
    const page = targets.find(t => t.type === 'page' && /^https:\/\/(www\.)?tutien2d\.com\//.test(t.url));
    if (!page) return { profile: index, error: 'Không thấy tab game' };
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { const t = setTimeout(() => reject(Error('Timeout')), 3000); ws.onopen = () => { clearTimeout(t); resolve(); }; ws.onerror = () => { clearTimeout(t); reject(Error('Không kết nối được tab game')); }; });
    const result = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(Error('Timeout')), 3000); ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) { clearTimeout(t); resolve(m.result?.result?.value); } }; ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { returnByValue: true, expression: `(() => { const s = window.TuTienAuto?.status?.(); return { main: window.TuTienAuto?.version || null, farm: window.TuTienStoneFarm?.version || null, books: !!document.getElementById('tt-free-books'), mainPanel: !!document.querySelector('#tutien-auto-overlay, #tt-auto-overlay'), detail: window.TuTienStoneFarm?.status?.(), active: !!window.TuTienStoneFarm?.status?.()?.running || ['automation','intro','quests','garden','navigation'].some(k=>s?.[k]?.running) }; })()` } })); });
    ws.close(); return { profile: index, ...result };
  } catch (e) { return { profile: index, error: e.message }; }
}
Promise.all(Array.from({ length: 10 }, (_, i) => inspect(i + 1))).then(rows => console.log(JSON.stringify(rows, null, 2)));
