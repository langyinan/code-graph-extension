/**
 * Removes clutter while keeping the graph comprehensive:
 *   - File and external nodes are always kept (even with no edges), so the
 *     graph reflects the whole repo.
 *   - Isolated function nodes (no call edges) are dropped.
 *   - As a safety valve, very large graphs are capped at MAX_NODES by degree.
 */
const MAX_NODES = 400;

export function pruneGraph(graph, { keepIsolated = true } = {}) {
  const connected = new Set();
  for (const e of graph.edges) {
    connected.add(e.from);
    connected.add(e.to);
  }

  for (const [id, node] of graph.nodes) {
    // With keepIsolated, file/external nodes survive even with no edges.
    const keepAlways = keepIsolated && (node.type === 'file' || node.type === 'external');
    if (!keepAlways && !connected.has(id)) graph.nodes.delete(id);
  }

  if (graph.nodes.size > MAX_NODES) {
    const degree = new Map();
    for (const e of graph.edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    const top = [...graph.nodes.keys()]
      .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))
      .slice(0, MAX_NODES);
    const keep = new Set(top);
    for (const [id] of graph.nodes) {
      if (!keep.has(id)) graph.nodes.delete(id);
    }
    graph.edges = graph.edges.filter(e => keep.has(e.from) && keep.has(e.to));
  }

  return graph;
}
