// Read game-provided drop exclusions and map data; do not infer guaranteed drops.
A.stoneFarmEnemy = function (game, enemy, mapId) {
  const def = enemy?.def || game?.ENEMY_DEFS?.[enemy?.type];
  const player = game?.SceneWorld?.player;
  if (!enemy?.type || !def || !player || def.isBoss || def.human || def.tieuXa || def.khongNhan) return false;
  if (enemy.requireStage && (!Number.isInteger(game?.Quest?.stage) || game.Quest.stage < enemy.requireStage)) return false;
  const hp = Number(def.hp ?? enemy.hpMax), damage = Number(def.contactDmg);
  if (!Number.isFinite(hp) || hp <= 0 || !Number.isFinite(damage) || damage < 0 || !Number.isFinite(player.hpMax) || player.hpMax <= 0) return false;
  if (hp > player.hpMax * 4 || damage > player.hpMax * .22) return false;
  if (typeof game?.Loot?.quaiBoLinhThach !== 'function') return false;
  try {
    // Fixed stone drops are a separate branch in Loot; the exclusion applies to random drops.
    const excluded = game.Loot.quaiBoLinhThach({ type: enemy.type, mapId: mapId || enemy.mapId, def }, game);
    if (excluded !== true && excluded !== false) return false;
    const fixed = Number(def.stones || 0) > 0 && !Number.isFinite(enemy.stoneChance) && !enemy.stoneRate;
    return !excluded || fixed;
  } catch (_) { return false; }
};

A.stoneFarmCandidates = function (game, excluded = new Set()) {
  const current = game?.SceneWorld?.map?.data?.id;
  if (!current) return [];
  const maps = A.maps(game.MapData), result = [];
  for (const [id, map] of maps) {
    if (excluded.has(id) || map.scope !== 'shared' || !Array.isArray(map.enemies)) continue;
    const route = A.mapRoute(game.MapData, current, id);
    if (!Array.isArray(route)) continue;
    // The Linh Thạch mine contains a boss and its guards, but this farm mode
    // must only target Thạch Ma. Filter the spawn table before the boss check.
    const spawns = map.enemies.filter(e =>
      (id !== 'mo_linh_thach' || e.type === 'thach_ma') &&
      (!e.requireStage || (Number.isInteger(game.Quest?.stage) && game.Quest.stage >= e.requireStage)));
    // The built-in combat engine may switch targets between ticks. Avoid maps with active bosses.
    if (spawns.some(e => game.ENEMY_DEFS?.[e.type]?.isBoss)) continue;
    const eligible = spawns.filter(e => A.stoneFarmEnemy(game, { ...e, stoneRate: e.stoneRate || map.stoneRate }, id));
    if (!eligible.length) continue;
    const hp = Math.min(...eligible.map(e => Number(game.ENEMY_DEFS[e.type].hp)));
    result.push({ id, name: map.name || id, hops: route.length, types: [...new Set(eligible.map(e => e.type))], hp });
  }
  result.sort((a, b) => a.hops - b.hops || a.hp - b.hp || a.id.localeCompare(b.id));
  return result;
};
