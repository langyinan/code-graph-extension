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
   * @param {string} [opts.linkBase] If set, file/function nodes get a `click … href`
   *   directive opening `linkBase + node.path` (e.g. the file's GitHub blob URL).
   * @param {string} [opts.linkBaseDir] Used instead of linkBase for `component`
   *   nodes, which point to a folder (GitHub tree URL) rather than a file.
   * @param {boolean} [opts.grouping] Emit directory subgraphs when true.
   */
  toMermaid({ linkBase, linkBaseDir, grouping = true } = {}) {
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
      if (node.type === 'variable') return `("${lbl}")`; // rounded rect — grows with text, can't clip like a circle
      if (node.type === 'external') return `{{"${lbl}"}}`;
      if (node.type === 'component') return `[["${lbl}"]]`;
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

    // Edges. When an edge has a source line, label it "L<n>" and record a link
    // to that exact line (keyed by Mermaid's edge DOM id) for click handling.
    const edgeLinks = {};
    const arrowFor = type => (type === 'import' ? '-->' : '-.->');
    for (const edge of this.edges) {
      const a = alias(edge.from);
      const b = alias(edge.to);
      const arrow = arrowFor(edge.type);
      if (linkBase && edge.file && edge.line) {
        lines.push(`  ${a} ${arrow}|"L${edge.line}"| ${b}`);
        const url = linkBase + edge.file.split('/').map(encodeURIComponent).join('/') + `#L${edge.line}`;
        edgeLinks[`L_${a}_${b}_0`] = url;
      } else {
        lines.push(`  ${a} ${arrow} ${b}`);
      }
    }

    // Style external (3rd-party) nodes distinctly.
    const externals = [...this.nodes.values()].filter(n => n.type === 'external').map(n => alias(n.id));
    if (externals.length) {
      lines.push('  classDef external fill:#fff3cd,stroke:#d39e00,color:#5c4400;');
      lines.push(`  class ${externals.join(',')} external;`);
    }

    // Style component (folder) nodes distinctly.
    const components = [...this.nodes.values()].filter(n => n.type === 'component').map(n => alias(n.id));
    if (components.length) {
      lines.push('  classDef component fill:#ddf4ff,stroke:#0969da,color:#0a3069;');
      lines.push(`  class ${components.join(',')} component;`);
    }

    // Style variable nodes distinctly.
    const variables = [...this.nodes.values()].filter(n => n.type === 'variable').map(n => alias(n.id));
    if (variables.length) {
      lines.push('  classDef variable fill:#dafbe1,stroke:#1a7f37,color:#0a3622;');
      lines.push(`  class ${variables.join(',')} variable;`);
    }

    // Click-to-open links (requires mermaid securityLevel: 'loose').
    // Components link to the folder (tree URL); everything else to the file (blob URL).
    if (linkBase) {
      for (const [id, node] of this.nodes) {
        if (!node.path) continue;
        const base = node.type === 'component' ? (linkBaseDir || linkBase) : linkBase;
        const url = base + node.path.split('/').map(encodeURIComponent).join('/');
        lines.push(`  click ${alias(id)} href "${url}" _blank`);
      }
    }

    return { mermaid: lines.join('\n'), edgeLinks };
  }

  stats() {
    return { nodes: this.nodes.size, edges: this.edges.length };
  }
}
