A.pick = function (obj, keys) {
  const result = {};
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string') result[key] = value.slice(0, 180);
    else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || value === null) result[key] = value;
  }
  return result;
};
A.readState = function (game, doc) {
  const w = game?.SceneWorld, map = w?.map, q = game?.Quest;
  const list = (items, keys, max = 200) => Array.isArray(items) ? items.slice(0, max).map(p => A.pick(p, keys)) : [];
  const text = selector => (doc?.querySelector(selector)?.textContent || '').trim().slice(0, 300);
  const dialog = doc?.querySelector('#dialog');
  const dialogOpen = !!game?.HUD?.dialogOpen;
  return {
    available: !!game, ready: !!(w?.player && map?.data?.id),
    map: A.pick(map?.data, ['id', 'name', 'width', 'height']),
    tile: game?.CONFIG?.TILE ?? null,
    player: A.pick(w?.player, ['x', 'y', 'state', 'hp', 'hpMax', 'mp', 'mpMax', 'downed', 'flying', 'sitLocked', 'realmId', 'realm', 'exp', 'expMax', 'meditateBonusExp']),
    controls: { autoOn: w?.autoOn === true, autoDC: !!w?.autoDC, diNV: !!w?.diNV, transitioning: !!w?.transitioning,
      chopping: !!w?.chopping, fishing: !!w?.fishing, brewing: !!w?.brewing,
      brewingState: A.pick(w?.brewing, ['t', 'make']) },
    gardenObjects: map?.data?.id === 'vuon_ca_nhan' ? list([...(map.props || []), ...(map.flatProps || [])], ['id', 'type', 'x', 'y', 'r']) : [],
    materialDrops: list(w?.drops?.filter(d => d.materialId), ['task', 'materialId', 'state', 'x', 'y', 'gy']),
    pickupRadius: Number.isFinite(game?.Loot?.PICK_R) ? game.Loot.PICK_R : null,
    caption: text('#ritual-caption'),
    modules: ['SceneWorld', 'Pathfinder', 'MapData', 'Quest', 'Farm', 'Targeting'].filter(k => !!game?.[k]),
    portals: list(map?.portals, ['tx', 'ty', 'toMap', 'byHand', 'cooldownSec']),
    npc: list(map?.props?.filter(p => p.type === 'npc'), ['id', 'name', 'tx', 'ty', 'x', 'y', 'r', 'hidden']),
    enemies: list(w?.enemies, ['id', 'dead', 'hp', 'x', 'y']),
    questDrops: list(w?.drops?.filter(d=>['yeu_cot','doc_dang_doc_dich','manh_bi_tich_ha'].includes(d.itemId)), ['itemId','state','x','y','gy','asked']),
    quest: { stage: q?.stage ?? null, objectives: list(q?.objectives?.(), ['text','cur','max','done']), seed: A.pick(q?.seedQuest, ['active', 'task', 'round']),
      builtInAuto: typeof w?.autoDCStart === 'function' && typeof q?.autoSeedStep === 'function' },
    dialog: { open: dialogOpen, present: !!dialog, title: dialogOpen ? text('#dialog-title') : '',
      buttons: dialogOpen ? Array.from(doc?.querySelectorAll('#dialog button') || []).slice(0, 30).map(b => ({
        id: b.id || '', label: (b.textContent || '').trim().slice(0, 180), disabled: !!b.disabled,
        visible: !!b.getClientRects().length
      })) : [] }
  };
};
