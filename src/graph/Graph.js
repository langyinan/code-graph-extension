export class Graph {
  constructor() {
    this.nodes = new Map(); // id → node
    this.edges = [];        // { from, to, type }
  }

  addNode(node) {
    if (!this.nodes.has(node.id)) this.nodes.set(node.id, node);
  }

  addEdge(edge) {
    const key = `${edge.from}→${edge.to}`;
    if (!this._edgeSet) this._edgeSet = new Set();
    if (!this._edgeSet.has(key)) {
      this._edgeSet.add(key);
      this.edges.push(edge);
    }
  }

  toMermaid() {
    const lines = ['graph LR'];
    const sanitize = id => `"${id.replace(/"/g, "'")}"`;

    for (const [, node] of this.nodes) {
      const shape = node.type === 'function' ? `([${node.label}])` : `[${node.label}]`;
      lines.push(`  ${sanitize(node.id)}${shape}`);
    }

    for (const edge of this.edges) {
      const arrow = edge.type === 'import' ? '-->' : '-.->';
      lines.push(`  ${sanitize(edge.from)} ${arrow} ${sanitize(edge.to)}`);
    }

    return lines.join('\n');
  }

  stats() {
    return { nodes: this.nodes.size, edges: this.edges.length };
  }
}
