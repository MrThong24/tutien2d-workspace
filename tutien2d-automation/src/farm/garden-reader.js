A.readGarden = function (g) {
  const farm = g?.Farm, inv = g?.Inventory, q = g?.Quest;
  if (!farm || typeof inv?.count !== 'function') return null;
  const count = id => inv.count(id);
  const plots = Array.from({ length: farm.PLOT_COUNT || 10 }, (_, i) => {
    const id = 'plot_' + (i + 1), plot = farm.plot(id);
    return { id, seed: plot?.seed || null, ready: farm.ready(id), dry: farm.canWater(id),
      remaining: plot ? farm.remain(id) : 0, crop: plot ? farm.seedDef(plot.seed)?.crop : null };
  });
  const rule = g.Breakthrough?.ruleOf?.(g.SceneWorld?.player) || {};
  const recipe = q?.brewList?.().find(r => r.id === rule.item);
  const check = g.Breakthrough?.check?.(g.SceneWorld?.player);
  const p=g.SceneWorld?.player;
  const exp=Number(p?.exp ?? g.Progress?.exp)||0;
  const expMax=Number(p?.expMax)||0;
  const full=typeof q?.daoHanhFull==='function'?q.daoHanhFull():expMax>0&&exp>=expMax;
  return { plots, water: farm.hasWaterAccess(), duocCong: g.Progress?.duocCong || 0,
    experience: {current:exp,target:expMax,full},
    breakthrough: check ? { ready: !!check.ready, blocked: check.blocked || null, next: check.next?.id || null, nextName:check.next?.name||null,
      conditions: (check.lines||[]).map(line => ({ label: line.label, current: line.current, target: line.target, done: line.done })) } : null,
    seeds: farm.seedsInBag().map(row => ({ id: row.def.seed, crop: row.def.crop, qty: row.qty })),
    goal: recipe ? { id: recipe.id, name: recipe.name, need: rule.qty || 1, have: count(recipe.id),
      materials: recipe.recipe.map(m => ({ id: m.id||m.any?.[0], qty: m.qty, have: q.recipeHave?q.recipeHave(m):count(m.id),
        name:m.label||g.ITEMS?.[m.id]?.name||m.id, required:m.qty*Math.max(0,(rule.qty||1)-count(recipe.id)) })) } : null };
};
