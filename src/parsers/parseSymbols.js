/**
 * Extracts top-level symbols (functions + variables) from a file and the
 * intra-file usage edges between them (which function references which symbol).
 *
 * Returns: { symbols: Array<{name, kind:'function'|'variable'}>,
 *            edges: Array<{from, to}> }
 *
 * Declarations are detected per-language by the shared declarations module;
 * usage edges are inferred by scanning each function's region for references
 * to other known symbols.
 */
import { functionDecls, variableDecls, lineAt } from './declarations.js';

export function parseSymbols(source, ext) {
  const fns = functionDecls(source, ext).map(d => ({ ...d, kind: 'function' }));
  const vars = variableDecls(source, ext).map(d => ({ ...d, kind: 'variable' }));

  // Keep the first declaration of each name (functions win ties), ordered by position.
  const byName = new Map();
  for (const d of [...fns, ...vars].sort((a, b) => a.index - b.index)) {
    if (!byName.has(d.name)) byName.set(d.name, d);
  }
  const list = [...byName.values()].sort((a, b) => a.index - b.index);
  const names = new Set(list.map(d => d.name));

  const edges = [];
  for (let i = 0; i < list.length; i++) {
    const cur = list[i];
    if (cur.kind !== 'function') continue;
    const end = i + 1 < list.length ? list[i + 1].index : source.length;
    const body = source.slice(cur.index, end);
    const used = new Map(); // name → first reference line
    const ref = /\b(\w+)\b/g;
    let r;
    while ((r = ref.exec(body)) !== null) {
      if (r[1] !== cur.name && names.has(r[1]) && !used.has(r[1])) {
        used.set(r[1], lineAt(source, cur.index + r.index));
      }
    }
    for (const [u, line] of used) edges.push({ from: cur.name, to: u, line });
  }

  return { symbols: list.map(d => ({ name: d.name, kind: d.kind })), edges };
}
