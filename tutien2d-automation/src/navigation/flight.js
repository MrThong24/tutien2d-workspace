// Toggle through the normal F input; all eligibility checks below are read-only.
A.createFlight = function ({ getGame, doc, host, logger, now = Date.now }) {
  let pending = null, blockedUntil = 0;
  function toggle(desired) {
    pending = { desired, since: now() };
    for (const type of ['keydown', 'keyup']) doc.dispatchEvent(new host.KeyboardEvent(type, {
      key: 'f', code: 'KeyF', bubbles: true
    }));
    logger.add('FLIGHT_REQUEST', { flying: desired });
  }
  function update(target, allow = true) {
    const g = getGame(), w = g?.SceneWorld, p = w?.player;
    if (!p) return { waiting: false, changed: false };
    if (pending) {
      if (!!p.flying === pending.desired) {
        logger.add('FLIGHT_CONFIRMED', { flying: !!p.flying });
        pending = null; return { waiting: false, changed: true };
      }
      if (now() - pending.since < 2500) return { waiting: true, changed: false };
      const wanted = pending.desired; pending = null; blockedUntil = now() + 60000;
      logger.add('FLIGHT_DENIED', { flying: wanted });
      if (!wanted && p.flying) throw Error('Chưa hạ được phi hành; dừng trước khi tương tác.');
      return { waiting: false, changed: false };
    }
    const distance = target ? Math.hypot(p.x - target.x, p.y - target.y) : 0;
    const restricted = !allow || p.tieuXa > 0 || g.Quest?.seedTaskInfo?.()?.kind === 'escort';
    const noFly = typeof g.Player?.inNoFlyZone === 'function' && g.Player.inNoFlyZone(p, w.map);
    if (p.flying && (restricted || noFly || distance < 100)) {
      p.setPath?.([]); toggle(false); return { waiting: true, changed: false };
    }
    if (!p.flying && !restricted && !noFly && distance >= 180 && now() >= blockedUntil &&
        typeof g.Player?.canFly === 'function' && g.Player.canFly(p) &&
        !g.HUD?.dialogOpen && !g.HUD?.bagOpen && !w.menuOpen && !w.transitioning &&
        !(g.HacThi?.camBay && g.HacThi.camBay(g, w.map.data.id))) {
      p.setPath?.([]); toggle(true); return { waiting: true, changed: false };
    }
    return { waiting: false, changed: false };
  }
  return {
    update,
    reset() { pending = null; blockedUntil = 0; },
    status() { return { flying: !!getGame()?.SceneWorld?.player?.flying, pending: pending?.desired ?? null }; },
    ground() { blockedUntil = now() + 60000; return update(null, false); },
    pathAllowed(g, path) {
      const p = g.SceneWorld.player, map = g.SceneWorld.map;
      if (!p.flying || !g.Player?.flyOverTerrain?.()) return true;
      if (typeof map.rectFlyBlocked !== 'function') return false;
      const cfg = g.CONFIG.PLAYER;
      let last = p;
      for (const end of path) {
        const steps = Math.max(1, Math.ceil(Math.hypot(end.x - last.x, end.y - last.y) / 4));
        for (let i = 0; i <= steps; i++) {
          const x = last.x + (end.x - last.x) * i / steps, y = last.y + (end.y - last.y) * i / steps;
          if (map.rectFlyBlocked(x - cfg.HITBOX_W / 2, y - cfg.HITBOX_H, x + cfg.HITBOX_W / 2, y)) return false;
        }
        last = end;
      }
      return true;
    }
  };
};
