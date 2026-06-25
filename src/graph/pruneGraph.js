/**
 * Removes isolated nodes (no edges) and caps the graph at MAX_NODES
 * to keep Mermaid rendering tractable.
 */
const MAX_NODES = 120;

export function pruneGraph(graph) {
  const connected = new Set();
  for (const e of graph.edges) {
    connected.add(e.from);
    connected.add(e.to);
  }

  // Keep only connected nodes
  for (const [id] of graph.nodes) {
    if (!connected.has(id)) graph.nodes.delete(id);
  }

  // If still too large, keep the highest-degree nodes
  if (graph.nodes.size > MAX_NODES) {
    const degree = new Map();
    for (const e of graph.edges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    const top = [...degree.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_NODES)
      .map(([id]) => id);
    const keep = new Set(top);
    for (const [id] of graph.nodes) {
      if (!keep.has(id)) graph.nodes.delete(id);
    }
    graph.edges = graph.edges.filter(e => keep.has(e.from) && keep.has(e.to));
  }

  return graph;
}
