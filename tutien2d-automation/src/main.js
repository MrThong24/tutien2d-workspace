if (window.TuTienAuto) return;
const access = A.createGameAccess(window);
const logger = A.createLogger(300);
let debug = true, ui = null, lastSignature = '', lastSample = 0, disposed = false;
let snapshot = A.readState(access.get(), document);
logger.add('LOADED', { mode: 'read-only' });

function sample(force = false) {
  snapshot = A.readState(access.get(), document);
  const signature = JSON.stringify(snapshot);
  if (debug && (force || signature !== lastSignature)) {
    logger.add('STATE_CHANGED', snapshot);
    lastSignature = signature;
  }
  lastSample = Date.now();
}
function status() {
  return { mode: 'read-only', debug, disposed, logs: logger.size(), snapshot };
}
function report() {
  sample();
  return { schema: 'tutien2d-diagnostic-v1', mode: 'read-only', version: '1.0.0',
    exportedAt: new Date().toISOString(), snapshot, records: logger.records() };
}
function exportLog(textOnly = false) {
  const text = JSON.stringify(report(), null, 2);
  if (textOnly) return text;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'tutien2d-diagnostic-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  document.documentElement.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return text;
}
const timer = setInterval(() => {
  if (disposed) return;
  try {
    sample();
    if (ui && Date.now() - lastSample < 1500) ui.render();
  } catch (error) { logger.add('DIAGNOSTIC_ERROR', { message: error.message }); }
}, 1000);
function mount() {
  if (disposed || ui || !document.documentElement) return;
  ui = A.createOverlay({ doc: document, getStatus: status, exportLog,
    copyLog: () => navigator.clipboard.writeText(exportLog(true)),
    debugToggle: () => { debug = !debug; if (debug) sample(true); ui?.render(); } });
}
const api = Object.freeze({
  mode: 'read-only',
  status: () => JSON.parse(JSON.stringify(status())),
  report,
  exportLog,
  stopAutoDebug: () => { debug = false; },
  dispose: () => {
    disposed = true; clearInterval(timer); ui?.remove(); ui = null;
    if (window.TuTienAuto === api) delete window.TuTienAuto;
    return true;
  }
});
Object.defineProperty(window, 'TuTienAuto', { value: api, configurable: true });
if (document.documentElement) mount();
else new MutationObserver(() => { if (document.documentElement) mount(); }).observe(document, { childList: true, subtree: true });
