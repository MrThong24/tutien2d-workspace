if (window.TuTienStoneFarm) return;
const access = A.createGameAccess(window);
const entries = [];
const logger = { add(event, data = {}) { entries.push({ at: new Date().toISOString(), event, data }); if (entries.length > 400) entries.shift(); } };
const controller = A.createController();
const navigation = A.createNavigation({ getGame: () => access.get(), logger, controller });
const stoneFarm = A.createStoneFarm({ getGame: () => access.get(), doc: document, host: window, controller, navigation, logger });
let ui = null, disposed = false, resumeStarted = Date.now(), lastResumeAttempt = 0;
let resumePending = false;
try { resumePending = sessionStorage.getItem('tutien_stone_farm_resume') === '1'; } catch (_) {}
function render() {
  if (!ui) return;
  const s = stoneFarm.status();
  ui.status.textContent = s.state + ' · ' + s.message;
  ui.data.textContent = 'Ví: ' + (s.balance ?? '—') + ' · Tăng trong phiên: ' + s.gained + ' · Tốc độ: ' + (s.perHour == null ? 'chờ đo' : s.perHour + '/giờ') +
    ' · Hôm nay: ' + (s.day ? s.day.earned + '/' + s.day.limit : '—') + ' · Bãi: ' + (s.targetMap || s.map || '—');
  ui.start.disabled = s.running; ui.stop.disabled = !s.running;
}
function start() { resumePending = false; const ok = stoneFarm.start({ otherScriptsStopped: true }); render(); return ok; }
function stop(reason) { resumePending = false; const result = stoneFarm.stop(reason || 'Đã dừng theo yêu cầu.'); render(); return result; }
function report() { return { schema: 'tutien2d-stone-farm-v1', version: '1.0.0', exportedAt: new Date().toISOString(), farm: stoneFarm.status(), access: access.diagnostics(), events: entries.slice() }; }
const api = Object.freeze({ version: '1.0.0', status: () => stoneFarm.status(), start, stop, report });
window.TuTienStoneFarm = api;
function mount() {
  if (disposed || ui || !document.documentElement) return;
  const host = document.createElement('div'); host.id = 'tt-stone-farm';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>:host{position:fixed;right:12px;top:260px;z-index:2147483647;color-scheme:dark;font:12px/1.4 system-ui;color:#eef7ef}section{box-sizing:border-box;width:310px;max-width:calc(100vw - 24px);padding:10px;background:#1a2b22;border:1px solid #7d9c82;border-radius:7px;box-shadow:0 3px 12px #0008}header{display:flex;justify-content:space-between;align-items:center;gap:5px}p{margin:6px 0;overflow-wrap:anywhere}button{padding:6px 8px;margin:3px 3px 0 0;background:#315a40;color:#fff;border:1px solid #87a991;border-radius:4px;cursor:pointer}button:disabled{opacity:.45}#fold{margin:0;padding:2px 8px}</style><section><header><strong>TuTien2D · Farm Linh Thạch</strong><button id="fold" aria-label="Thu gọn">−</button></header><div id="body"><p id="status">Đang chờ game…</p><p id="data"></p><button id="start">Bắt đầu farm</button><button id="stop">Dừng</button><button id="log">Tải log JSON</button></div></section>`;
  document.documentElement.appendChild(host);
  ui = { host, status: root.getElementById('status'), data: root.getElementById('data'), start: root.getElementById('start'), stop: root.getElementById('stop') };
  ui.start.addEventListener('click', start); ui.stop.addEventListener('click', () => stop());
  root.getElementById('fold').addEventListener('click', () => { const body = root.getElementById('body'); body.hidden = !body.hidden; root.getElementById('fold').textContent = body.hidden ? '+' : '−'; });
  root.getElementById('log').addEventListener('click', () => { const url = URL.createObjectURL(new Blob([JSON.stringify(report(), null, 2)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'tutien-farm-linh-thach.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); });
  render();
}
function manualKey(event) { if (event.isTrusted && stoneFarm.status().running && ['Escape','KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyT','KeyR','KeyQ','KeyE','Enter','Space','KeyB','KeyI','KeyF'].includes(event.code)) stop('Đã dừng vì bạn thao tác bàn phím.'); }
function manualPointer(event) { if (event.isTrusted && stoneFarm.status().running && !event.composedPath().includes(ui?.host)) stop('Đã dừng vì bạn thao tác trong game.'); }
function pageHide() { if (stoneFarm.status().running) stoneFarm.stop('Trang tải lại; chờ tiếp tục.', 'STOPPED', true); }
window.addEventListener('keydown', manualKey, true); document.addEventListener('pointerdown', manualPointer, true); window.addEventListener('pagehide', pageHide);
if (document.documentElement) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
const timer = setInterval(() => {
  if (disposed) return;
  if (resumePending && Date.now() - lastResumeAttempt >= 2000) {
    lastResumeAttempt = Date.now();
    if (Date.now() - resumeStarted > 60000) { resumePending = false; stop('Không thể tiếp tục farm sau 60 giây; hãy kiểm tra game.'); }
    else if (access.get()?.SceneWorld?.player && access.get()?.Gateway?.ready && stoneFarm.start({ otherScriptsStopped: true })) resumePending = false;
  }
  stoneFarm.tick(); render();
}, 250);
