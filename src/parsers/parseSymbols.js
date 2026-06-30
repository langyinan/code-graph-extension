/**
 * Extracts top-level symbols (functions + variables) from a file and the
 * intra-file usage edges between them (which function references which symbol).
 *
 * Returns: { symbols: Array<{name, kind:'function'|'variable', line}>,
 *            edges: Array<{from, to, line}> }
 *   symbol.line = the declaration line; edge.line = the usage line.
 *
 * Declarations are detected per-language by the shared declarations module;
 * usage edges are inferred by scanning each function's region for references
 * to other known symbols.
 */
import { functionDecls, variableDecls, lineAt } from './declarations.js';

export function parseSymbols(source, ext, { withSource = false } = {}) {
  const fns = functionDecls(source, ext).map(d => ({ ...d, kind: 'function' }));
  const vars = variableDecls(source, ext).map(d => ({ ...d, kind: 'variable' }));

  // Keep the first declaration of each name (functions win ties), ordered by position.
  const byName = new Map();
  for (const d of [...fns, ...vars].sort((a, b) => a.index - b.index)) {
    if (!byName.has(d.name)) byName.set(d.name, d);
  }
  const list = [...byName.values()].sort((a, b) => a.index - b.index);
  const names = new Set(list.map(d => d.name));
  const srcLines = withSource ? source.split('\n') : null;

  const edges = [];
  for (let i = 0; i < list.length; i++) {
    const cur = list[i];
    if (cur.kind !== 'function') continue;
    const end = i + 1 < list.length ? list[i + 1].index : source.length;
    const body = source.slice(cur.index, end);
    if (withSource) cur.body = body.replace(/\s+$/, ''); // source.level: keep the function text

    const used = new Map(); // name → first reference line
    const ref = /\b(\w+)\b/g;
    let r;
    while ((r = ref.exec(body)) !== null) {
      if (r[1] !== cur.name && names.has(r[1]) && !used.has(r[1])) {
        used.set(r[1], lineAt(source, cur.index + r.index));
      }
    }
    for (const [u, line] of used) {
      const edge = { from: cur.name, to: u, line };
      if (withSource) edge.code = (srcLines[line - 1] || '').trim();
      edges.push(edge);
    }
  }

  return {
    symbols: list.map(d => {
      const s = { name: d.name, kind: d.kind, line: lineAt(source, d.index), index: d.index };
      if (withSource && d.body) s.body = d.body;
      return s;
    }),
    edges,
  };
}
