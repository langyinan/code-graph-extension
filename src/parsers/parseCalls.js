/**
 * Extracts intra-file function call edges via regex heuristics.
 * Returns: Array<{ caller: string, callee: string }>
 *
 * This is intentionally lightweight — it catches the common case
 * (named function bodies calling other named functions) without
 * a full AST. For deeper analysis, the roadmap includes a
 * tree-sitter WASM backend.
 */
export function parseCalls(source, ext) {
  switch (ext) {
    case '.js':
    case '.jsx':
    case '.ts':
    case '.tsx':
      return parseJSCalls(source);
    case '.py':
      return parsePythonCalls(source);
    default:
      return [];
  }
}

function parseJSCalls(src) {
  const edges = [];
  // Find function declarations / arrow functions assigned to const
  const fnDef = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g;
  const functions = [];
  let m;
  while ((m = fnDef.exec(src)) !== null) {
    functions.push({ name: m[1] || m[2], start: m.index });
  }

  for (let i = 0; i < functions.length; i++) {
    const caller = functions[i];
    const end = functions[i + 1]?.start ?? src.length;
    const body = src.slice(caller.start, end);
    const callRe = /(\w+)\s*\(/g;
    let c;
    while ((c = callRe.exec(body)) !== null) {
      const callee = c[1];
      if (callee !== caller.name && functions.some(f => f.name === callee)) {
        edges.push({ caller: caller.name, callee });
      }
    }
  }
  return edges;
}

function parsePythonCalls(src) {
  const edges = [];
  const defRe = /^def\s+(\w+)\s*\(/gm;
  const functions = [];
  let m;
  while ((m = defRe.exec(src)) !== null) {
    functions.push({ name: m[1], start: m.index });
  }

  for (let i = 0; i < functions.length; i++) {
    const caller = functions[i];
    const end = functions[i + 1]?.start ?? src.length;
    const body = src.slice(caller.start, end);
    const callRe = /(\w+)\s*\(/g;
    let c;
    while ((c = callRe.exec(body)) !== null) {
      const callee = c[1];
      if (callee !== caller.name && functions.some(f => f.name === callee)) {
        edges.push({ caller: caller.name, callee });
      }
    }
  }
  return edges;
}
