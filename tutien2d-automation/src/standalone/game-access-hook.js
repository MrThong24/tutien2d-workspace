// Cooperate with the CONFIG hook used by TuTien2D Auto 0.9.7.
A.createGameAccess = function (host) {
  const candidates = [];
  let configHook = 'unavailable', hook = 'not-installed';
  const keep = value => {
    if (value && typeof value === 'object' && !candidates.includes(value)) candidates.push(value);
    return value;
  };
  try {
    keep(host.gameDebug); keep(host.PNTT);
    const proto = host.Object.prototype;
    const previous = Object.getOwnPropertyDescriptor(proto, 'CONFIG');
    const compatible = !previous || (previous.configurable && typeof previous.set === 'function' &&
      /HITBOX_W/.test(Function.prototype.toString.call(previous.set)) &&
      /\.NAME/.test(Function.prototype.toString.call(previous.set)));
    if (compatible) {
      let active = true;
      const restore = () => {
        if (Object.getOwnPropertyDescriptor(proto, 'CONFIG')?.set !== setter) return;
        if (previous) Object.defineProperty(proto, 'CONFIG', previous);
        else delete proto.CONFIG;
      };
      const setter = function (value) {
        // Restore first so the earlier hook can clean itself up normally.
        restore();
        if (previous?.set) previous.set.call(this, value);
        else Object.defineProperty(this, 'CONFIG', { value, writable: true, enumerable: true, configurable: true });
        const match = value && value.NAME === 'Tu Tiên 2D' && value.TILE === 32 &&
          value.PLAYER && Number.isFinite(value.PLAYER.HITBOX_W);
        if (match) {
          keep(this); active = false; configHook = 'captured';
          // 0.9.7 already looks for gameDebug; publish only if the name is unused.
          if (typeof host.gameDebug === 'undefined') {
            try { Object.defineProperty(host, 'gameDebug', { value: this, writable: true, configurable: true }); }
            catch (_) { /* The standalone script has its own reference. */ }
          }
        } else if (active && (!previous || Object.getOwnPropertyDescriptor(proto, 'CONFIG')?.set === previous.set)) {
          Object.defineProperty(proto, 'CONFIG', { configurable: true, enumerable: false, get: previous?.get, set: setter });
        }
      };
      Object.defineProperty(proto, 'CONFIG', { configurable: true, enumerable: false, get: previous?.get, set: setter });
      configHook = previous ? 'chained' : 'installed';
      host.setTimeout(() => { active = false; restore(); if (configHook !== 'captured') configHook = 'expired'; }, 30000);
    } else configHook = 'occupied';
    hook = 'available';
  } catch (_) { configHook = 'error'; }
  return {
    get() {
      try { keep(host.PNTT); keep(host.gameDebug); } catch (_) {}
      const list = [...candidates].reverse();
      return list.find(value => value?.SceneWorld?.player && value?.SceneWorld?.map?.data?.id) ||
        list.find(value => value?.SceneWorld) || list[0] || null;
    },
    diagnostics() {
      try { keep(host.PNTT); keep(host.gameDebug); } catch (_) {}
      return { hook, configHook, candidates: candidates.map(value => ({ player: !!value?.SceneWorld?.player,
        map: !!value?.SceneWorld?.map?.data?.id, farm: !!value?.Farm, quest: !!value?.Quest })) };
    }
  };
};
