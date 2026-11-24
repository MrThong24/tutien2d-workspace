// Conditions come from the game's read-only checker. Payment and ascension use
// only its normal stone dialog, and success requires a real realm change.
A.createAscension = function ({ getGame, doc, logger, now = Date.now }) {
  let pending = null, blockedRealm = null;
  return {
    active: () => !!pending,
    status: () => pending ? { state: 'WAIT_CONFIRMATION', from: pending.from, to: pending.to } : { state: 'CHECK_CONDITIONS' },
    reset() { pending = null; blockedRealm = null; },
    tick(interactWithStone) {
      const g = getGame(), w = g?.SceneWorld, p = w?.player;
      if (!p || typeof g.Breakthrough?.check !== 'function') return false;
      if (pending) {
        if (p.realmId !== pending.from) {
          if (p.realmId !== pending.to) throw Error('Cảnh giới thay đổi ngoài bước đột phá dự kiến.');
          logger.add('ASCENSION_CONFIRMED', { from: pending.from, to: p.realmId });
          pending = null; return false;
        }
        if (now() - pending.at > 120000) throw Error('Chưa xác nhận đột phá sau 2 phút; dừng để tránh dùng đan lặp.');
        return true;
      }
      const check = g.Breakthrough.check(p);
      if (!check.ready || check.blocked || !check.next) return false;
      // Foundation uses its own encounter rather than the ordinary ascension ritual.
      if (p.realmId === 'luyen_khi_13') {
        if (blockedRealm !== p.realmId) logger.add('ASCENSION_SPECIAL_REQUIRED', { realm: p.realmId, next: check.next.id });
        blockedRealm = p.realmId; return false;
      }
      if (g.HUD?.dialogOpen) {
        if (doc.querySelector('#dialog-title')?.textContent.trim() !== 'Đột Phá Cảnh Giới') return false;
        const button = doc.querySelector('#dialog-action');
        if (!button || button.disabled || !button.getClientRects().length || button.textContent.trim() !== 'Bắt Đầu Phá Quan') return false;
        // The game's dialog deliberately suppresses clicks during its first
        // 500ms. Wait for that guard to pass before invoking the normal button
        // callback; an early .click() silently leaves the modal untouched.
        const openedAt = Number(g.HUD._dialogOpenedAt) || 0;
        if (openedAt && Date.now() - openedAt < 600) return true;
        const latest = g.Breakthrough.check(p);
        if (!latest.ready || latest.blocked || latest.next?.id !== check.next.id) return false;
        // The standard dialog callback closes the modal and sends the game's
        // expected breakthrough action. Verify it ran before latching a request.
        button.click();
        if (g.HUD.dialogOpen) return true;
        pending = { from: p.realmId, to: check.next.id, at: now() };
        logger.add('ASCENSION_REQUEST', { from: pending.from, to: pending.to });
        return true;
      }
      interactWithStone(); return true;
    }
  };
};
