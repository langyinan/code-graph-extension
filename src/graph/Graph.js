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
  toMermaid({ linkBase, linkBaseDir, grouping = true, orient = 'LR' } = {}) {
    const lines = [`graph ${orient}`];

    // Mermaid v11 node IDs must be simple alphanumeric tokens.
    // We assign each node a stable numeric alias and quote only the label.
    const idMap = new Map();
    let counter = 0;
    const alias = id => {
      if (!idMap.has(id)) idMap.set(id, `N${counter++}`);
      return idMap.get(id);
    };
    const safeLabel = str => str.replace(/"/g, '#quot;').replace(/</g, '#lt;').replace(/>/g, '#gt;');

    // Thorough escaping for embedding arbitrary source code in a Mermaid label
    // (handles #, &, quotes, angle brackets via numeric/entity codes).
    const escapeCode = s => s
      .replace(/#/g, '#35;')
      .replace(/&/g, '#amp;')
      .replace(/"/g, '#quot;')
      .replace(/</g, '#lt;')
      .replace(/>/g, '#gt;');
    const MAX_CODE_LINES = 14;
    const MAX_CODE_COLS = 80;
    const codeBlock = text => {
      const all = text.split('\n');
      const shown = all.slice(0, MAX_CODE_LINES).map(l => {
        let s = l.replace(/\t/g, '  ');
        if (s.length > MAX_CODE_COLS) s = s.slice(0, MAX_CODE_COLS) + '…';
        return escapeCode(s);
      });
      return shown.join('<br/>') + (all.length > MAX_CODE_LINES ? '<br/>…' : '');
    };
    const truncate = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

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

    const CFG_TYPES = new Set(['start', 'end', 'process', 'decision', 'jump']);
    const shapeFor = node => {
      // Control-flow nodes: code-escaped, distinct flowchart shapes.
      if (CFG_TYPES.has(node.type)) {
        const t = escapeCode(truncate(node.label, 60));
        if (node.type === 'decision') return `{"${t}"}`;          // diamond
        if (node.type === 'start' || node.type === 'end') return `(["${t}"])`; // terminal
        return `["${t}"]`;                                        // process / jump
      }
      // 'source' level: show the function's code body inside the node, in a
      // monospace code section. 'symbols' level: just the declaration line.
      let lbl;
      if (node.content) {
        lbl = `<b>${safeLabel(node.label)}</b> <small>L${node.line}</small>` +
          `<br/><code class='cg-code'>${codeBlock(node.content)}</code>`;
      } else if (node.line) {
        lbl = `${safeLabel(node.label)}<br/><small>L${node.line}</small>`;
      } else {
        lbl = safeLabel(node.label);
      }
      // Square nodes for easy display; type is conveyed by color (see classDefs).
      if (node.type === 'external') return `{{"${lbl}"}}`;     // hexagon — external dep
      if (node.type === 'component') return `[["${lbl}"]]`;    // folder
      return `["${lbl}"]`;                                     // file / function / variable
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

    // Edges. Label each edge with the referenced symbol (the target's name) and
    // record a link to the exact source line (keyed by Mermaid's edge DOM id)
    // for click handling.
    const edgeLinks = {};
    const arrowFor = type => (type === 'import' || type === 'flow' ? '-->' : '-.->');
    for (const edge of this.edges) {
      const a = alias(edge.from);
      const b = alias(edge.to);
      const arrow = arrowFor(edge.type);
      if (edge.label) {
        // Control-flow branch labels (yes/no/loop/done).
        lines.push(`  ${a} ${arrow}|"${safeLabel(edge.label)}"| ${b}`);
      } else if (linkBase && edge.file && edge.line) {
        // 'source' level labels edges with the actual code line; otherwise with
        // the referenced symbol's name.
        const target = this.nodes.get(edge.to);
        const label = edge.code
          ? `<code class='cg-code'>${escapeCode(truncate(edge.code, 60))}</code>`
          : safeLabel(target ? target.label : `L${edge.line}`);
        lines.push(`  ${a} ${arrow}|"${label}"| ${b}`);
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

    // Style control-flow nodes. Class names are prefixed because some words
    // (e.g. "end") are reserved in Mermaid.
    const classOf = (type, className, style) => {
      const ids = [...this.nodes.values()].filter(n => n.type === type).map(n => alias(n.id));
      if (ids.length) {
        lines.push(`  classDef ${className} ${style};`);
        lines.push(`  class ${ids.join(',')} ${className};`);
      }
    };
    classOf('decision', 'cfgDecision', 'fill:#fff8c5,stroke:#bf8700,color:#4d3800');
    classOf('start', 'cfgStart', 'fill:#dafbe1,stroke:#1a7f37,color:#0a3622');
    classOf('end', 'cfgEnd', 'fill:#ffebe9,stroke:#cf222e,color:#5c0011');
    classOf('jump', 'cfgJump', 'fill:#ffebe9,stroke:#cf222e,color:#5c0011');

    // Click-to-open links (requires mermaid securityLevel: 'loose').
    // Components link to the folder (tree URL); everything else to the file (blob URL).
    if (linkBase) {
      for (const [id, node] of this.nodes) {
        if (!node.path) continue;
        const base = node.type === 'component' ? (linkBaseDir || linkBase) : linkBase;
        let url = base + node.path.split('/').map(encodeURIComponent).join('/');
        if (node.line) url += `#L${node.line}`; // jump to the declaration line
        lines.push(`  click ${alias(id)} href "${url}" _blank`);
      }
    }

    return { mermaid: lines.join('\n'), edgeLinks };
  }

  stats() {
    return { nodes: this.nodes.size, edges: this.edges.length };
  }
}
