// ponytail: no layout lib in this repo (no dagre/elkjs) — a plain BFS-depth
// layering is enough for a journey graph (a tree with occasional re-joins),
// so this stays hand-rolled instead of adding a dependency for one function.
const LEVEL_GAP = 220; // px between depths (rows for TB, columns for LR)
const NODE_GAP = 170;  // px between siblings at the same depth

/** id -> {x, y} for every node, laid out by BFS depth from root nodes
 * (nodes with no incoming edge). direction: 'TB' (top-to-bottom, default) or
 * 'LR' (left-to-right). */
export function layoutPositions(nodes, edges, direction = 'TB') {
  const incoming = new Map(nodes.map((n) => [n.id, 0]));
  edges.forEach((e) => incoming.set(e.target, (incoming.get(e.target) || 0) + 1));
  const children = new Map(nodes.map((n) => [n.id, []]));
  edges.forEach((e) => children.get(e.source)?.push(e.target));

  const depth = new Map();
  const queue = nodes.filter((n) => !incoming.get(n.id)).map((n) => [n.id, 0]);
  while (queue.length) {
    const [id, d] = queue.shift();
    if (depth.has(id) && depth.get(id) >= d) continue;
    depth.set(id, d);
    (children.get(id) || []).forEach((childId) => queue.push([childId, d + 1]));
  }
  nodes.forEach((n) => { if (!depth.has(n.id)) depth.set(n.id, 0); }); // disconnected node

  const levels = new Map();
  nodes.forEach((n) => {
    const d = depth.get(n.id);
    if (!levels.has(d)) levels.set(d, []);
    levels.get(d).push(n.id);
  });

  const positions = {};
  levels.forEach((ids, d) => {
    ids.forEach((id, i) => {
      positions[id] = direction === 'LR'
        ? { x: d * LEVEL_GAP, y: i * NODE_GAP }
        : { x: i * NODE_GAP, y: d * LEVEL_GAP };
    });
  });
  return positions;
}
