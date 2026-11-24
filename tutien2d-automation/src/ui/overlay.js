A.createOverlay = function ({ doc, getStatus, exportLog, copyLog, debugToggle }) {
  const host = doc.createElement('div');
  host.id = 'tutien2d-diagnostic-panel';
  Object.assign(host.style, { position: 'fixed', right: '12px', top: '12px', zIndex: '2147483647', maxWidth: 'calc(100vw - 24px)' });
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host { color-scheme: dark; }
      section { width: 310px; max-width: calc(100vw - 28px); box-sizing: border-box; background: #152020f2; color: #eaf4ee; border: 1px solid #5b7869; border-radius: 10px; padding: 12px; font: 13px/1.5 system-ui,sans-serif; box-shadow: 0 5px 25px #0007; }
      header { display:flex; justify-content:space-between; align-items:center; gap:8px; }
      .badge { display:inline-block; padding:2px 6px; border-radius:5px; background:#30526b; color:#e3f3ff; font:700 10px/1.4 ui-monospace,monospace; }
      button { cursor:pointer; background:#304c40; color:white; border:1px solid #648673; border-radius:5px; padding:6px 9px; margin:3px 3px 3px 0; font:inherit; }
      p { margin:7px 0; overflow-wrap:anywhere; } .muted { color:#b6c9bc; font-size:12px; }
      label { display:block; margin:8px 0; } input { vertical-align:middle; }
      textarea { box-sizing:border-box; width:100%; height:120px; font:11px monospace; }
      [hidden] { display:none !important; }
    </style>
    <section aria-label="TuTien2D Diagnostic">
      <header><div><span class="badge">VIEW ONLY</span> <strong>TuTien2D · Trạng thái</strong></div><button id="fold" title="Thu gọn">−</button></header>
      <div id="body">
        <p id="status" aria-live="polite"></p>
        <p id="details" class="muted"></p>
        <p class="muted">Chế độ chỉ đọc: bảng này không tự di chuyển, đánh, làm nhiệm vụ hay tương tác với vật phẩm.</p>
        <p id="controls" class="muted"></p>
        <button id="copy">Copy Log</button><button id="export">Export JSON</button><button id="debug"></button>
        <p id="feedback" class="muted" aria-live="polite"></p>
        <textarea id="fallback" hidden readonly aria-label="Log để sao chép"></textarea>
      </div>
    </section>`;
  const $ = id => root.getElementById(id);
  let folded = false;
  $('fold').addEventListener('click', () => { folded = !folded; $('body').hidden = folded; $('fold').textContent = folded ? '+' : '−'; });
  $('export').addEventListener('click', () => exportLog());
  $('copy').addEventListener('click', async () => {
    try { await copyLog(); $('feedback').textContent = 'Đã sao chép log cục bộ.'; }
    catch (_) {
      $('fallback').value = exportLog(true); $('fallback').hidden = false;
      $('fallback').focus(); $('fallback').select();
      $('feedback').textContent = 'Clipboard không khả dụng. Nhấn Ctrl+C trong ô log.';
    }
  });
  $('debug').addEventListener('click', () => debugToggle());
  function render() {
    const s = getStatus(), snap = s.snapshot || {}, p = snap.player || {}, map = snap.map || {};
    $('status').textContent = snap.ready ? 'Đã đọc được trạng thái game.' : 'Đang chờ dữ liệu game.';
    $('details').textContent = `${map.name || map.id || 'Chưa có map'} · (${Math.round(p.x || 0)}, ${Math.round(p.y || 0)}) · ${s.logs} log cục bộ · ${s.debug ? 'Đang ghi nhận' : 'Đã dừng ghi nhận'}`;
    const c = snap.controls || {};
    $('controls').textContent = `Auto trong game: ${c.autoOn ? 'bật' : 'tắt'} · Dược Công: ${c.autoDC ? 'bật' : 'tắt'} · Tự đi: ${c.diNV ? 'bật' : 'tắt'}`;
    $('debug').textContent = s.debug ? 'Dừng ghi nhận' : 'Bật ghi nhận';
  }
  doc.documentElement.appendChild(host);
  render();
  return { host, render, remove() { host.remove(); } };
};
