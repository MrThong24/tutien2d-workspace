if (window.TuTienStoneFarm?.version === '2.0.29') return;
if (window.TuTienStoneFarm) {
  try { window.TuTienStoneFarm.stop?.('Replacing an older Auto quái version.'); } catch (_) {}
}
const access = A.createGameAccess(window);
const entries = [];
const logger = { add(event, data = {}) { entries.push({ at: new Date().toISOString(), event, data }); if (entries.length > 400) entries.shift(); } };
const controller = A.createController();
const navigation = A.createNavigation({ getGame: () => access.get(), logger, controller });
const farm = A.createStoneFarm({ getGame: () => access.get(), doc: document, host: window, controller, navigation, logger });
const resumeKey = 'tutien_combat_pipeline_resume';
const mapKey = 'tutien_combat_pipeline_map', zoneKey = 'tutien_combat_pipeline_zone';
let startedName = '', resumePending = false, resumeAt = Date.now();
try { resumePending = sessionStorage.getItem(resumeKey) === '1'; } catch (_) {}
function stop(reason = 'Đã dừng Auto farm.', result = 'STOPPED', preserve = false) {
  resumePending = false;
  farm.stop(reason, result, preserve);
  if (!preserve) { try { sessionStorage.removeItem(resumeKey); sessionStorage.removeItem(mapKey); sessionStorage.removeItem(zoneKey); } catch (_) {} }
  return false;
}
function status() {
  const f = farm.status();
  return { ...f, phase: f.state, preferredMapId: f.preferredMapId || null, preferredZoneId: f.preferredZoneId || null };
}
function availableMaps() { try { return A.stoneFarmCandidates(access.get()).map(({id,name}) => ({id,name})); } catch (_) { return []; } }
function start(options = {}) {
  if (farm.status().running) return false;
  const g = access.get(), name = (document.getElementById('hud-name')?.textContent || '').trim();
  if (!g?.SceneWorld?.player || !g?.Gateway?.ready || !name) return stop('Chưa đọc được nhân vật hoặc kết nối game.', 'ERROR');
  const mapId = options.mapId || '', zoneId = options.zoneId == null ? 0 : Number(options.zoneId);
  if (!farm.start({ otherScriptsStopped: true, mapId, zoneId })) return false;
  startedName = name;
  try { sessionStorage.setItem(resumeKey, '1'); sessionStorage.setItem(mapKey, mapId); sessionStorage.setItem(zoneKey, String(zoneId || 0)); } catch (_) {}
  return true;
}
function tick() {
  if (resumePending) {
    if (Date.now() - resumeAt >= 120000) { resumePending = false; stop('Không thể tiếp tục Auto farm sau khi tải lại trang quá 120 giây.', 'ERROR'); return; }
    const game = access.get();
    const character = (document.getElementById('hud-name')?.textContent || '').trim();
    if (!game?.SceneWorld?.player || !game?.Gateway?.connected || !game?.Gateway?.ready || !character) return;
    let mapId = '', zoneId = 0;
    try { mapId = sessionStorage.getItem(mapKey) || ''; zoneId = Number(sessionStorage.getItem(zoneKey)) || 0; } catch (_) {}
    resumePending = false;
    start({ mapId, zoneId });
  }
  if (!farm.status().running) return;
  const name = (document.getElementById('hud-name')?.textContent || '').trim();
  if (name && startedName && name !== startedName) { stop('Nhân vật đã thay đổi.', 'ERROR'); return; }
  farm.tick();
  if (!farm.status().running) {
    try { sessionStorage.removeItem(resumeKey); sessionStorage.removeItem(mapKey); sessionStorage.removeItem(zoneKey); } catch (_) {}
  }
}
window.TuTienStoneFarm = Object.freeze({ version: '2.0.29', start, stop, status, maps: availableMaps,
  report: () => ({ schema: 'tutien2d-combat-pipeline-v1', version: '2.0.29', status: status(), access: access.diagnostics(), events: entries.slice() }) });
function manual(event) { if (farm.status().running && event.isTrusted) stop('Đã dừng vì bạn thao tác trong game.'); }
document.addEventListener('pointerdown', manual, true);
window.addEventListener('keydown', event => { if (/^(Escape|Key[WASDEQTF]|Arrow(Up|Down|Left|Right))$/.test(event.code)) manual(event); }, true);
window.addEventListener('pagehide', () => { if (farm.status().running) stop('Trang tải lại; chờ tiếp tục.', 'STOPPED', true); });
setInterval(tick, 250);
