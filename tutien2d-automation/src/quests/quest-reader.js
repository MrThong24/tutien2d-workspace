A.readDuocCong = function (game) {
  const q = game?.Quest;
  if (typeof q?.seedTaskList !== 'function') return { available: false, tasks: [], active: null };
  const handlers = new Set(['linh_chi', 'cau_ca', 'ho_tong_chau', 'truc_gia', 'duoc_moc']);
  const tasks = q.seedTaskList().map(row => ({
    id: row.def.id, name: row.def.shortName || row.def.name,
    kind: row.def.kind, runsLeft: row.runsLeft, locked: !!row.locked,
    status: row.locked ? 'LOCKED' : row.exhausted ? 'EXHAUSTED' : handlers.has(row.def.id) ? 'READY' : 'NEEDS_ADAPTER',
    reason: row.locked ? 'Chưa đủ điều kiện nhân vật' : row.exhausted ? 'Hết lượt hôm nay' :
      handlers.has(row.def.id) ? '' : 'Chưa có bộ thực thi đã kiểm chứng cho hoạt động này'
  }));
  const info = q.seedTaskInfo();
  return { available: true, tasks, active: info ? { id: info.id, name: info.shortName || info.name, supported: handlers.has(info.id),
    progress: q.seedQuestProgress(), need: info.need ?? null, complete: q.seedQuestComplete(), round: q.seedQuest.round } : null };
};
