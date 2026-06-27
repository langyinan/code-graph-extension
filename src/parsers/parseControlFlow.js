/**
 * Heuristic control-flow extractor for brace-based languages.
 * Given a function body, returns a flowchart { nodes, edges }:
 *   nodes: { id, label, kind: 'start'|'end'|'process'|'decision'|'jump' }
 *   edges: { from, to, label }
 *
 * It recognises if / else if / else, for, while, do, and switch is treated as a
 * plain statement. Statement/branch bodies may be braced or single-line.
 * Returns null for unsupported languages or when no body block is found.
 */
const BRACE_LANGS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.java', '.cs', '.go', '.rs', '.php',
  '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh',
]);

export function supportsControlFlow(ext) {
  return BRACE_LANGS.has(ext);
}

/** Parse a function body into its statement AST (or null if unsupported). */
export function parseFunctionAst(funcBody, ext) {
  if (!BRACE_LANGS.has(ext)) return null;
  const s = stripToSpaces(funcBody);
  const open = s.indexOf('{');
  if (open === -1) return null;
  const close = matchBrace(s, open);
  if (close === -1) return null;
  return parseStmts(s, funcBody, open + 1, close);
}

/** Blank out comments and string contents (offsets preserved) — for call scanning. */
export function stripCode(src) {
  return stripToSpaces(src);
}

export function parseControlFlow(funcBody, ext, funcName = 'start') {
  const ast = parseFunctionAst(funcBody, ext);
  return ast ? emitCFG(ast, funcName) : null;
}

// ── Lexer-lite: blank out comments and string contents, preserve offsets ─────
function stripToSpaces(src) {
  const out = src.split('');
  const n = src.length;
  const blank = (a, b) => { for (let k = a; k < b && k < n; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { let j = i + 2; while (j < n && src[j] !== '\n') j++; blank(i, j); i = j; }
    else if (c === '/' && d === '*') { let j = i + 2; while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j++; j = Math.min(n, j + 2); blank(i, j); i = j; }
    else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === c) break; j++; }
      blank(i + 1, j);
      i = j + 1;
    } else i++;
  }
  return out.join('');
}

function matchBrace(s, open) { return matchPair(s, open, '{', '}'); }
function matchParen(s, open) { return matchPair(s, open, '(', ')'); }
function matchPair(s, open, oc, cc) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === oc) depth++;
    else if (s[i] === cc) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function skipWs(s, i, end) { while (i < end && /\s/.test(s[i])) i++; return i; }

function keywordAt(s, i) {
  const m = /^(else if|if|for|while|do|else)\b/.exec(s.slice(i, i + 8));
  return m ? m[1] : null;
}

function mkStmt(text) {
  const t = text.trim();
  if (/^(return|break|continue|throw|goto)\b/.test(t) || t === 'return') {
    return { t: 'jump', text: t, ret: /^(return|throw)\b/.test(t) };
  }
  return { t: 'stmt', text: t };
}

// ── Recursive-descent over statements ────────────────────────────────────────
function parseStmts(s, orig, i, end) {
  const stmts = [];
  while (i < end) {
    i = skipWs(s, i, end);
    if (i >= end || s[i] === '}') break;
    if (s[i] === ';') { i++; continue; }
    if (s[i] === '{') { const c = matchBrace(s, i); stmts.push(...parseStmts(s, orig, i + 1, c < 0 ? end : c)); i = (c < 0 ? end : c) + 1; continue; }

    const kw = keywordAt(s, i);
    if (kw === 'if' || kw === 'else if') {
      const r = parseIf(s, orig, i, end);
      stmts.push(r.node); i = r.next; continue;
    }
    if (kw === 'for' || kw === 'while') {
      const r = parseLoop(s, orig, i, end, kw);
      stmts.push(r.node); i = r.next; continue;
    }
    if (kw === 'do') {
      const r = parseDo(s, orig, i, end);
      stmts.push(r.node); i = r.next; continue;
    }
    // simple statement up to the next top-level ';'
    let j = i, depth = 0;
    while (j < end) {
      const ch = s[j];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth--; }
      else if (ch === ';' && depth === 0) break;
      j++;
    }
    stmts.push(mkStmt(orig.slice(i, j)));
    i = s[j] === ';' ? j + 1 : j;
  }
  return stmts;
}

function parseBranchBody(s, orig, i, end) {
  i = skipWs(s, i, end);
  if (s[i] === '{') { const c = matchBrace(s, i); return { body: parseStmts(s, orig, i + 1, c < 0 ? end : c), next: (c < 0 ? end : c) + 1 }; }
  // single (unbraced) statement — may itself be a control structure
  const kw = keywordAt(s, i);
  if (kw === 'if' || kw === 'else if') { const r = parseIf(s, orig, i, end); return { body: [r.node], next: r.next }; }
  if (kw === 'for' || kw === 'while') { const r = parseLoop(s, orig, i, end, kw); return { body: [r.node], next: r.next }; }
  let j = i, depth = 0;
  while (j < end) {
    const ch = s[j];
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth--; }
    else if (ch === ';' && depth === 0) break;
    j++;
  }
  return { body: [mkStmt(orig.slice(i, j))], next: s[j] === ';' ? j + 1 : j };
}

function readCond(s, orig, i) {
  i = skipWs(s, i, s.length);
  if (s[i] !== '(') return { cond: '', next: i };
  const c = matchParen(s, i);
  return { cond: orig.slice(i + 1, c).trim(), next: c + 1 };
}

function parseIf(s, orig, i, end) {
  i += keywordAt(s, i) === 'else if' ? 'else if'.length : 'if'.length;
  const { cond, next } = readCond(s, orig, i);
  const then = parseBranchBody(s, orig, next, end);
  const node = { t: 'if', cond, then: then.body, elifs: [], els: null };
  let k = skipWs(s, then.next, end);
  while (keywordAt(s, k) === 'else if' || keywordAt(s, k) === 'else') {
    if (keywordAt(s, k) === 'else if') {
      k += 'else if'.length;
      const ec = readCond(s, orig, k);
      const eb = parseBranchBody(s, orig, ec.next, end);
      node.elifs.push({ cond: ec.cond, body: eb.body });
      k = skipWs(s, eb.next, end);
    } else {
      k += 'else'.length;
      const eb = parseBranchBody(s, orig, k, end);
      node.els = eb.body;
      k = eb.next;
      break;
    }
  }
  return { node, next: k };
}

function parseLoop(s, orig, i, end, kw) {
  i += kw.length;
  const { cond, next } = readCond(s, orig, i);
  const body = parseBranchBody(s, orig, next, end);
  return { node: { t: 'loop', kind: kw, cond, body: body.body }, next: body.next };
}

function parseDo(s, orig, i, end) {
  i += 'do'.length;
  const body = parseBranchBody(s, orig, i, end);
  let k = skipWs(s, body.next, end);
  let cond = '';
  if (keywordAt(s, k) === 'while') { k += 'while'.length; const r = readCond(s, orig, k); cond = r.cond; k = r.next; if (s[k] === ';') k++; }
  return { node: { t: 'loop', kind: 'do', cond, body: body.body }, next: k };
}

// ── AST → control-flow graph ─────────────────────────────────────────────────
function emitCFG(ast, funcName) {
  const nodes = [];
  const edges = [];
  let id = 0;
  const add = (label, kind) => { const nid = `c${id++}`; nodes.push({ id: nid, label: label || kind, kind }); return nid; };
  const link = (from, to, label) => edges.push({ from, to, label });

  const start = add(funcName, 'start');
  const end = add('end', 'end');

  function emit(list, preds) {
    for (const node of list) {
      if (node.t === 'stmt' || node.t === 'jump') {
        const nid = add(node.text, node.t === 'jump' ? 'jump' : 'process');
        preds.forEach(p => link(p.from, nid, p.label));
        if (node.t === 'jump') { if (node.ret) link(nid, end); preds = []; }
        else preds = [{ from: nid }];
      } else if (node.t === 'if') {
        const d = add(node.cond, 'decision');
        preds.forEach(p => link(p.from, d, p.label));
        let exits = emit(node.then, [{ from: d, label: 'yes' }]);
        let lastNo = { from: d, label: 'no' };
        for (const e of node.elifs) {
          const ed = add(e.cond, 'decision');
          link(lastNo.from, ed, lastNo.label);
          exits = exits.concat(emit(e.body, [{ from: ed, label: 'yes' }]));
          lastNo = { from: ed, label: 'no' };
        }
        if (node.els) exits = exits.concat(emit(node.els, [lastNo]));
        else exits.push(lastNo);
        preds = exits;
      } else if (node.t === 'loop') {
        const label = `${node.kind}${node.cond ? ' (' + node.cond + ')' : ''}`;
        const d = add(label, 'decision');
        preds.forEach(p => link(p.from, d, p.label));
        const bodyExits = emit(node.body, [{ from: d, label: 'loop' }]);
        bodyExits.forEach(b => link(b.from, d, b.label)); // back-edge to the condition
        preds = [{ from: d, label: 'done' }];
      }
    }
    return preds;
  }

  const finalPreds = emit(ast, [{ from: start }]);
  finalPreds.forEach(p => link(p.from, end, p.label));

  // Drop the end node if nothing reaches it (e.g. flow only exits via returns
  // that we couldn't attribute), to avoid an orphan.
  if (!edges.some(e => e.to === end)) {
    const idx = nodes.findIndex(n => n.id === end);
    if (idx !== -1) nodes.splice(idx, 1);
  }
  return { nodes, edges };
}
