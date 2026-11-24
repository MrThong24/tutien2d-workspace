A.findNpc = function (game, id) {
  const props = game?.SceneWorld?.map?.props;
  const prop = Array.isArray(props) && props.find(p => p.id === id && p.type === 'npc' && !p.hidden);
  if (!prop || !Number.isFinite(prop.x) || !Number.isFinite(prop.y)) return null;
  const tile = game?.CONFIG?.TILE;
  if (!Number.isFinite(tile) || tile <= 0) return null;
  // Targeting and SceneWorld's own autoDC both interact at prop.y - TILE/2.
  return { id: prop.id, x: prop.x, y: prop.y - tile / 2, r: Number.isFinite(prop.r) ? prop.r : 40 };
};
