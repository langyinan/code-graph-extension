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

  /**
   * @param {object} [opts]
   * @param {string} [opts.linkBase] If set, each node gets a `click … href`
   *   directive opening `linkBase + node.path` (e.g. the file on GitHub).
   */
  toMermaid({ linkBase, grouping = true } = {}) {
    const lines = ['graph LR'];

    // Mermaid v11 node IDs must be simple alphanumeric tokens.
    // We assign each node a stable numeric alias and quote only the label.
    const idMap = new Map();
    let counter = 0;
    const alias = id => {
      if (!idMap.has(id)) idMap.set(id, `N${counter++}`);
      return idMap.get(id);
    };
    const safeLabel = str => str.replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');

    // Build a tree from each node's `group` path (e.g. "src/graph") so we can
    // emit nested subgraphs for directory grouping.
    const root = { children: new Map(), nodes: [] };
    for (const [, node] of this.nodes) {
      const segs = node.group ? node.group.split('/') : [];
      let cur = root;
      for (const seg of segs) {
        if (!cur.children.has(seg)) cur.children.set(seg, { children: new Map(), nodes: [] });
        cur = cur.children.get(seg);
      }
      cur.nodes.push(node);
    }

    const shapeFor = node => {
      const lbl = safeLabel(node.label);
      if (node.type === 'function') return `(["${lbl}"])`;
      if (node.type === 'external') return `{{"${lbl}"}}`;
      return `["${lbl}"]`;
    };

    if (grouping) {
      let sgCounter = 0;
      const emit = (group, depth) => {
        const pad = '  '.repeat(depth);
        for (const node of group.nodes) {
          lines.push(`${pad}${alias(node.id)}${shapeFor(node)}`);
        }
        for (const [name, child] of group.children) {
          lines.push(`${pad}subgraph S${sgCounter++}["${safeLabel(name)}"]`);
          emit(child, depth + 1);
          lines.push(`${pad}end`);
        }
      };
      emit(root, 1);
    } else {
      // Flat layout — no directory subgraphs.
      for (const [id, node] of this.nodes) {
        lines.push(`  ${alias(id)}${shapeFor(node)}`);
      }
    }

    const arrowFor = type => (type === 'import' ? '-->' : '-.->');
    for (const edge of this.edges) {
      lines.push(`  ${alias(edge.from)} ${arrowFor(edge.type)} ${alias(edge.to)}`);
    }

    // Style external (3rd-party) nodes distinctly.
    const externals = [...this.nodes.values()].filter(n => n.type === 'external').map(n => alias(n.id));
    if (externals.length) {
      lines.push('  classDef external fill:#fff3cd,stroke:#d39e00,color:#5c4400;');
      lines.push(`  class ${externals.join(',')} external;`);
    }

    // Click-to-open links (requires mermaid securityLevel: 'loose').
    if (linkBase) {
      for (const [id, node] of this.nodes) {
        if (!node.path) continue;
        const url = linkBase + node.path.split('/').map(encodeURIComponent).join('/');
        lines.push(`  click ${alias(id)} href "${url}" _blank`);
      }
    }

    return lines.join('\n');
  }

  stats() {
    return { nodes: this.nodes.size, edges: this.edges.length };
  }
}
