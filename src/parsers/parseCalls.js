/**
 * Extracts intra-file function call edges via regex heuristics.
 * Returns: Array<{ caller: string, callee: string }>
 *
 * Function declarations are detected per-language by the shared declarations
 * module; call edges are inferred by scanning each function's region for
 * `name(` references to other known functions in the same file.
 */
import { functionDecls, lineAt } from './declarations.js';

// Languages where method calls commonly omit parentheses (e.g. Ruby `helper`).
const PAREN_OPTIONAL = new Set(['.rb']);

export function parseCalls(source, ext) {
  const fns = functionDecls(source, ext).sort((a, b) => a.index - b.index);
  if (fns.length < 2) return [];

  const names = new Set(fns.map(f => f.name));
  const bare = PAREN_OPTIONAL.has(ext);
  const edges = [];

  for (let i = 0; i < fns.length; i++) {
    const caller = fns[i];
    const end = i + 1 < fns.length ? fns[i + 1].index : source.length;
    const body = source.slice(caller.index, end);

    const seen = new Set();
    const callRe = bare ? /\b(\w+)\b/g : /(\w+)\s*\(/g;
    let c;
    while ((c = callRe.exec(body)) !== null) {
      const callee = c[1];
      if (callee !== caller.name && names.has(callee) && !seen.has(callee)) {
        seen.add(callee);
        edges.push({ caller: caller.name, callee, line: lineAt(source, caller.index + c.index) });
      }
    }
  }
  return edges;
}
