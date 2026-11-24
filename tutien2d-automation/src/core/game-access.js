// Capture the namespace before main.js deletes window.PNTT. No game methods run here.
A.createGameAccess = function (host) {
  let retained = null;
  const keep = value => {
    if (value && typeof value === 'object') retained = value;
    return value;
  };
  try {
    keep(host.gameDebug);
    keep(host.PNTT);
    const previous = Object.getOwnPropertyDescriptor(host, 'PNTT');
    if (!previous || previous.configurable) {
      let current = host.PNTT;
      Object.defineProperty(host, 'PNTT', {
        configurable: true,
        enumerable: previous?.enumerable ?? true,
        get() {
          const value = previous?.get ? previous.get.call(host) : current;
          return value && typeof value === 'object' ? keep(value) : current;
        },
        set(value) {
          keep(value);
          if (previous?.set) previous.set.call(host, value);
          current = value;
        }
      });
    }
  } catch (_) { /* A pre-existing capture can still supply gameDebug. */ }
  return {
    get() {
      // PNTT is authoritative. Some older helper scripts leave gameDebug
      // pointing at an earlier object, so only use it as a fallback.
      try { const pntt = host.PNTT; if (pntt && typeof pntt === 'object') return keep(pntt); } catch (_) {}
      try { const debug = host.gameDebug; if (debug && typeof debug === 'object') return keep(debug); } catch (_) {}
      return retained;
    }
  };
};
