// Small accessibility handshake for committing garden actions through Chrome's
// native UI. No network, credentials, or arbitrary command execution.
A.createNativeActions = function ({ doc, logger, now = Date.now }) {
  let node = null, pending = null, serial = 0;
  const allowed = /^(Gieo Hạt .+|Vẫn đổi Gói Hạt .+|Bắt Đầu Phá Quan)$/;
  function cancel() { pending = null; if (node) node.hidden = true; }
  return {
    attach(root) {
      node = doc.createElement('button'); node.id = 'tta-native-action'; node.hidden = true;
      node.textContent = 'Đang xác nhận thao tác trong game…';
      node.addEventListener('click', () => { if (pending) logger.add('NATIVE_ACTION_DISPATCHED', { label: pending.label }); cancel(); });
      root.appendChild(node);
    },
    request(label) {
      if (!allowed.test(label) || !node) return false;
      if (pending) return pending.label === label;
      pending = { label, at: now(), id: now() + '-' + (++serial), timeout:label==='Bắt Đầu Phá Quan'?30000:5000 };
      node.setAttribute('aria-label', 'TTA_NATIVE|' + pending.id + '|' + label); node.hidden = false;
      logger.add('NATIVE_ACTION_REQUEST', { label }); return true;
    },
    intentional(e) {
      const b = e.target?.closest?.('button');
      return !!pending && now() - pending.at < pending.timeout && !!b && b.textContent.trim().startsWith(pending.label);
    },
    tick() {
      if (pending && now() - pending.at > pending.timeout) { const label = pending.label; cancel(); return 'Chưa xác nhận thao tác Chrome: ' + label; }
      return null;
    },
    cancel
  };
};
