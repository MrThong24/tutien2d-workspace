// Translate the limited HUD and saved garden data into the 0.9.1 reader shape.
// Saved data and local time are not authoritative game state.
A.readGardenFromHud = function (saved, hud, now = Date.now()) {
  if (!saved || !saved.bag || !saved.farm || typeof saved.farm !== 'object' || Array.isArray(saved.farm) || !hud?.ready) return null;
  const realm = /^luyện khí tầng\s+(\d+)$/i.exec(hud.realm || '');
  if (!realm || saved.realm !== `luyen_khi_${realm[1]}`) return null;
  const seeds = {
    hat_linh_diep: 'linh_diep', hat_huyet_thao: 'huyet_thao',
    hat_linh_ngoc: 'linh_ngoc_diep', hat_xich_duong: 'xich_duong_thao',
    hat_bich_van: 'bich_van_diep', hat_long_huyet: 'long_huyet_thao'
  };
  const pillInfo = {
    'Tụ Khí Đan': ['tu_khi_dan', 'linh_diep', 'huyet_thao', 2],
    'Luyện Khí Đan': ['luyen_khi_dan', 'linh_ngoc_diep', 'xich_duong_thao', 4],
    'Phá Cảnh Đan': ['pha_canh_dan', 'bich_van_diep', 'long_huyet_thao', 5]
  };
  const count = id => {
    const value = saved.bag[id] ?? 0;
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  };
  const lines = Array.isArray(hud.breakthrough) ? hud.breakthrough : [];
  const line = lines.find(row => pillInfo[row.label]);
  let goal = null;
  if (line) {
    const [id, first, second, water] = pillInfo[line.label];
    const needed = Number(line.need), current = Number(line.current), pillCount = count(id);
    if (!Number.isSafeInteger(needed) || needed < 1 || !Number.isSafeInteger(current) || current < 0 ||
        pillCount === null || Math.min(pillCount, needed) !== current) return null;
    const outstanding = Math.max(0, needed - current);
    const materials = [[first, 3], [second, 3], ['linh_thuy', water]].map(([material, qty]) => ({
      id: material, qty, have: count(material), required: qty * outstanding
    }));
    if (materials.some(m => m.have === null)) return null;
    goal = { id, name: line.label, need: needed, have: current, materials };
  }
  const plots = Array.from({ length: 10 }, (_, i) => {
    const id = `plot_${i + 1}`, plot = saved.farm[id];
    if (!plot) return { id, seed: null, crop: null, ready: false, dry: false, remaining: 0 };
    if (typeof plot.seed !== 'string' || !Number.isFinite(plot.at) || !Number.isFinite(plot.dur) || plot.dur <= 0 || typeof plot.wet !== 'boolean') return null;
    const remaining = Math.max(0, Math.ceil((plot.at + plot.dur - now) / 1000));
    return { id, seed: plot.seed, crop: seeds[plot.seed] || null,
      ready: remaining === 0, dry: !plot.wet && remaining > 0, remaining };
  });
  if (plots.some(plot => !plot)) return null;
  const bagSeeds = Object.entries(seeds).map(([id, crop]) => ({ id, crop, qty: count(id) }));
  if (bagSeeds.some(seed => seed.qty === null)) return null;
  const experience = lines.find(row => row.label === 'Đạo Hạnh');
  return { plots, seeds: bagSeeds.filter(seed => seed.qty > 0), goal,
    experience: { current: Number(experience?.current) || 0, target: Number(experience?.need) || 0,
      full: hud.experienceFull === true || experience?.done === true },
    observedEnemy: hud.enemy || null,
    // No HUD-equivalent exists for server time, live plots, water access or all mobs.
    confidence: { plots: 'saved-unverified', time: 'local-unverified', enemies: 'only-current-target', water: 'unknown' }
  };
};
