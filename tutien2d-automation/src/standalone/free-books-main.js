const access = A.createGameAccess(window);
const events = [];
const logger = { add(event, data = {}) { events.push({ at: new Date().toISOString(), event, data }); if (events.length > 100) events.shift(); } };
const controller = A.createController();
const navigation = A.createNavigation({ getGame: () => access.get(), logger, controller });
const pools = [{ id: 'so_cap', label: 'Tàng Kinh Sơ Cấp', tab: 'Sơ Cấp' },
  { id: 'bi_dong', label: 'Tàng Kinh Bị Động', tab: 'Bị Động' }];
// Read-only status for the local profile monitor; never starts a draw.
window.TuTienFreeBooks = Object.freeze({ status() {
  const g = access.get();
  if (!g?.SceneWorld?.player || typeof g?.Gacha?.freeToday !== 'function' || typeof g?.Gacha?.soldOut !== 'function')
    return { ready: false, pools: [] };
  try {
    return { ready: true, pools: pools.map(pool => ({ id: pool.id,
      free: g.Gacha.freeToday(g, pool.id) === true, soldOut: g.Gacha.soldOut(g, pool.id) === true })) };
  } catch (_) { return { ready: false, pools: [] }; }
} });
let ui = null, running = false, state = 'IDLE', message = 'Chờ vào nhân vật.', started = 0, last = 0, pending = null;
let targetPool = null, lastVersion = '';
const now = () => Date.now();
function visible(node) { return !!node && !node.disabled && !!node.getClientRects().length; }
function phase(next, detail) {
  if (state !== next || message !== detail) logger.add('STATE', { state: next, message: detail });
  state = next; message = detail;
  if (ui) ui.status.textContent = detail;
}
function press(key) {
  for (const type of ['keydown', 'keyup']) document.dispatchEvent(new KeyboardEvent(type, { key, code: 'Key' + key.toUpperCase(), bubbles: true }));
  last = now();
}
function otherAutoRunning() {
  try {
    const s = window.TuTienAuto?.status?.();
    return !!(s?.automation?.running || s?.navigation?.running || s?.quests?.running || s?.intro?.running || s?.garden?.running);
  } catch (_) { return true; }
}
function stop(detail, result = 'STOPPED') {
  if (navigation.status().running) navigation.stop(detail);
  running = false; pending = null; targetPool = null; controller.reset();
  phase(result, detail);
  if (ui) { ui.start.disabled = false; ui.stop.disabled = true; }
}
function start() {
  if (running) return;
  const g = access.get(), w = g?.SceneWorld;
  if (!w?.player || !w.map?.data?.id) return phase('ERROR', 'Chưa đọc được nhân vật. Tắt script auto khác rồi tải lại trang.');
  if (otherAutoRunning() || w.autoDC || w.diNV) return phase('ERROR', 'Hãy dừng các chức năng auto khác trước.');
  if (!g.Gacha || typeof g.Gacha.freeToday !== 'function' || typeof g.Gacha.soldOut !== 'function' ||
      typeof g.Gacha.open !== 'function' || !g.GachaUI) return phase('ERROR', 'Chưa đọc được quầy bí tịch.');
  if (!g.Gacha.open(g)) return phase('ERROR', 'Game chưa mở quầy bí tịch; cần hoàn thành nhiệm vụ mở quầy.');
  running = true; state = 'PREPARE'; started = now(); last = 0; pending = null; targetPool = null;
  ui.start.disabled = true; ui.stop.disabled = false;
  phase('PREPARE', 'Đang kiểm tra lượt rút miễn phí.');
}
function available(g, pool) {
  return g.Gacha.freeToday(g, pool.id) === true && g.Gacha.soldOut(g, pool.id) === false;
}
function tick() {
  if (!running) return;
  try {
    const g = access.get(), w = g?.SceneWorld, p = w?.player;
    if (!p || p.downed || p.hp <= 0) return stop('Không đọc được nhân vật hoặc nhân vật đã gục.', 'ERROR');
    if (otherAutoRunning() || w.autoDC || w.diNV) return stop('Có chức năng auto khác đang chạy.', 'ERROR');
    if (now() - started > 300000) return stop('Chưa hoàn tất trong 5 phút.', 'ERROR');
    if (w.transitioning) return;
    if (pending) {
      if (!g.Gacha.freeToday(g, pending.id) && !g.GachaUI.rolling) {
        logger.add('DRAW_CONFIRMED', { pool: pending.id }); pending = null; targetPool = null; last = now();
      } else if (now() - pending.at > 30000) return stop('Chưa xác nhận lượt rút; đã dừng, không thử lại.', 'ERROR');
      return;
    }
    if (state === 'PREPARE') {
      if (w.autoOn) { if (now() - last >= 1500) press('t'); return; }
      if (p.flying) { if (now() - last >= 1500) press('f'); return; }
      if (p.state === 'sit') { if (now() - last >= 1500) press('q'); return; }
      if (g.HUD?.bagOpen) { if (now() - last >= 1500) press('b'); return; }
      if (g.HUD?.dialogOpen) { document.querySelector('#dialog-close')?.click(); return; }
      if (!p.hpMax || p.hp < p.hpMax * .35) return stop('HP thấp; hãy hồi máu trước khi đi.', 'ERROR');
      const pool = pools.find(item => available(g, item));
      if (!pool) return stop('Hai tủ không còn lượt miễn phí khả dụng hôm nay.', 'DONE');
      if (!navigation.start({ target: 'tan_vien', npcId: 'tang_kinh_lao_nhan', otherScriptsStopped: true })) {
        return stop(navigation.status().message || 'Không bắt đầu được đường tới Tàng Kinh Lão Nhân.', 'ERROR');
      }
      phase('TRAVEL', 'Đang tới Tàng Kinh Lão Nhân.'); return;
    }
    if (state === 'TRAVEL') {
      navigation.tick();
      if (navigation.status().running) return;
      if (navigation.status().state !== 'DONE') return stop(navigation.status().message || 'Không tới được Tàng Kinh Lão Nhân.', 'ERROR');
      phase('NPC', 'Đã tới gần Tàng Kinh Lão Nhân.'); last = 0; return;
    }
    const next = pools.find(item => available(g, item));
    if (!next) {
      if (g.GachaUI.open) { document.querySelector('#gacha-close')?.click(); return; }
      if (g.HUD?.dialogOpen) { document.querySelector('#dialog-close')?.click(); return; }
      return stop('Đã kiểm tra và rút các lượt miễn phí có thể dùng hôm nay.', 'DONE');
    }
    if (now() - last < 1200) return;
    if (g.GachaUI.open) {
      if (g.GachaUI.rolling) return;
      if (g.Gacha.activePoolId !== next.id) {
        const tab = [...document.querySelectorAll('#gacha-pools button')].find(b => visible(b) && b.textContent.trim() === next.tab);
        if (!tab) return stop('Không tìm được thẻ ' + next.label + '.', 'ERROR');
        tab.click(); last = now(); phase('POOL', 'Đã chọn ' + next.label + '.'); return;
      }
      const button = document.querySelector('#gacha-one');
      if (!visible(button) || !/^Rút 1\s*·\s*Miễn phí hôm nay$/i.test(button.textContent.trim()) || !available(g, next)) {
        return stop('Không xác nhận được lượt miễn phí; chưa bấm rút.', 'ERROR');
      }
      pending = { id: next.id, at: now() }; last = now();
      button.click(); phase('WAIT_DRAW', 'Đã yêu cầu lượt miễn phí ' + next.label + '; đang chờ game xác nhận.'); return;
    }
    if (g.HUD?.dialogOpen) {
      if (document.querySelector('#dialog-title')?.textContent.trim() !== 'Tàng Kinh Lão Nhân') return stop('Game mở hội thoại khác tại NPC.', 'ERROR');
      const button = [...document.querySelectorAll('#dialog-choices button')].find(b => visible(b) && b.textContent.trim().startsWith(next.label));
      if (!button) return stop('Không thấy tủ ' + next.label + ' trong hội thoại.', 'ERROR');
      button.click(); last = now(); targetPool = next.id; phase('OPEN_POOL', 'Đang mở ' + next.label + '.'); return;
    }
    if (state !== 'NPC' && state !== 'OPEN_POOL' && state !== 'WAIT_DRAW') return stop('Trạng thái rút bí tịch chưa xác định.', 'ERROR');
    const npc = w.map?.props?.find(o => o.id === 'tang_kinh_lao_nhan' && !o.hidden);
    if (!npc || w.map?.data?.id !== 'tan_vien') return stop('Không tìm thấy Tàng Kinh Lão Nhân.', 'ERROR');
    if (g.Quest?.stage === 15) {
      // The stage-15 NPC dialog is reserved for Yêu Cốt, even when the book
      // shop is already unlocked. Open the game's own UI only at the NPC.
      const target = A.findNpc(g, 'tang_kinh_lao_nhan');
      if (!target || Math.hypot(p.x - target.x, p.y - target.y) > Math.min(36, Math.max(20, target.r - 12)) + 3) {
        return stop('Chưa xác nhận nhân vật đã tới gần Tàng Kinh Lão Nhân.', 'ERROR');
      }
      if (!g.Gacha.open(g) || typeof g.GachaUI.show !== 'function') return stop('Quầy bí tịch chưa sẵn sàng.', 'ERROR');
      g.GachaUI.show(next.id);
      if (!g.GachaUI.open) return stop('Game chưa mở quầy bí tịch ở Giai đoạn 15.', 'ERROR');
      last = now(); phase('OPEN_POOL', 'Đã mở quầy bí tịch tại Lão Nhân.'); return;
    }
    const targeting = g.Targeting;
    if (!targeting || typeof targeting.current !== 'function' || typeof targeting.cycle !== 'function') return stop('Không đọc được mục tiêu tương tác.', 'ERROR');
    for (let i = 0; i < (targeting.list?.length || 0) * 2 + 4; i++) {
      const selected = targeting.current();
      if (selected?.obj === npc && selected.dist <= selected.r) { press('e'); phase('NPC', 'Đang mở hội thoại Tàng Kinh Lão Nhân.'); return; }
      targeting.cycle();
    }
    if (now() - last > 20000) return stop('Chưa tương tác được với Tàng Kinh Lão Nhân.', 'ERROR');
  } catch (error) { stop(String(error?.message || error), 'ERROR'); }
}
function mount() {
  const host = document.createElement('div'); host.id = 'tt-free-books';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>:host{position:fixed;top:120px;left:12px;z-index:2147483647;color-scheme:dark}section{box-sizing:border-box;width:285px;max-width:calc(100vw - 24px);background:#1d2b23;color:#effaf1;border:1px solid #809b85;border-radius:8px;padding:10px;font:13px/1.45 system-ui}header{display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:move;touch-action:none}header button{margin:0;padding:1px 7px}button{margin:4px 5px 0 0;padding:6px;border:1px solid #8ba391;border-radius:4px;background:#315542;color:inherit;cursor:pointer}button:disabled{opacity:.5}p{overflow-wrap:anywhere;margin:7px 0}</style><section><header id="drag" title="Kéo để di chuyển bảng"><strong>TuTien2D · Bí tịch miễn phí</strong><button id="fold" type="button" aria-label="Thu gọn bảng">−</button></header><div id="panel-body"><p id="status" role="status">Đang chờ nhân vật…</p><button id="start">Tự rút lượt miễn phí</button><button id="stop" disabled>Dừng</button><button id="log">Tải log JSON</button></div></section>`;
  document.documentElement.appendChild(host);
  const savedPositionKey = 'tutien2d_free_books_panel_position';
  const position = (left, top) => {
    const rect = host.getBoundingClientRect();
    host.style.left = Math.max(0, Math.min(left, Math.max(0, window.innerWidth - rect.width))) + 'px';
    host.style.top = Math.max(0, Math.min(top, Math.max(0, window.innerHeight - rect.height))) + 'px';
    host.style.right = 'auto';
  };
  try {
    const saved = JSON.parse(localStorage.getItem(savedPositionKey) || 'null');
    if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) position(saved.left, saved.top);
  } catch (_) { /* Keep the default position if storage is unavailable. */ }
  const drag = root.getElementById('drag'), fold = root.getElementById('fold'), body = root.getElementById('panel-body');
  let pointer = null;
  drag.addEventListener('pointerdown', event => {
    if (event.target === fold || event.button !== 0) return;
    const rect = host.getBoundingClientRect();
    pointer = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
    drag.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  drag.addEventListener('pointermove', event => {
    if (pointer?.id === event.pointerId) position(event.clientX - pointer.x, event.clientY - pointer.y);
  });
  const endDrag = event => {
    if (pointer?.id !== event.pointerId) return;
    pointer = null;
    try { localStorage.setItem(savedPositionKey, JSON.stringify({ left: parseFloat(host.style.left), top: parseFloat(host.style.top) })); } catch (_) {}
  };
  drag.addEventListener('pointerup', endDrag);
  drag.addEventListener('pointercancel', endDrag);
  fold.addEventListener('click', () => {
    body.hidden = !body.hidden;
    fold.textContent = body.hidden ? '+' : '−';
    fold.setAttribute('aria-label', body.hidden ? 'Mở bảng' : 'Thu gọn bảng');
  });
  ui = { host, status: root.getElementById('status'), start: root.getElementById('start'), stop: root.getElementById('stop') };
  ui.start.addEventListener('click', start);
  ui.stop.addEventListener('click', () => stop('Đã dừng theo yêu cầu.'));
  root.getElementById('log').addEventListener('click', () => {
    const data = JSON.stringify({ version: '1.0.4', state, message, access: access.diagnostics(), events }, null, 2);
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'tu-tien-bi-tich.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.addEventListener('pointerdown', event => { if (running && event.isTrusted && !event.composedPath().includes(host)) stop('Đã dừng vì bạn thao tác trong game.'); }, true);
  window.addEventListener('keydown', event => { if (running && event.isTrusted && /^(Escape|Key[WASDEQTF]|Arrow(Up|Down|Left|Right))$/.test(event.code)) stop('Đã dừng vì bạn thao tác bàn phím.'); }, true);
}
if (document.documentElement) mount(); else document.addEventListener('DOMContentLoaded', mount, { once: true });
setInterval(() => {
  if (!running && ui && state === 'IDLE') {
    const g = access.get(); const signature = g?.SceneWorld?.player && g.SceneWorld.map?.data?.id ? 'ready' : 'waiting';
    if (signature !== lastVersion) { lastVersion = signature; ui.status.textContent = signature === 'ready' ? 'Đã kết nối nhân vật. Bấm nút để tự rút.' : 'Đang chờ nhân vật…'; }
  }
  tick();
}, 250);
