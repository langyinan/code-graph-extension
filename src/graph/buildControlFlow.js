import { parseSymbols } from '../parsers/parseSymbols.js';
import { parseFunctionAst, stripCode, extractFunctionBody } from '../parsers/parseControlFlow.js';

const MAX_CFG_NODES = 1500; // safety cap so deep inlining can't explode

/**
 * Builds a control-flow graph where a call to another in-file function nests
 * that function's flowchart inside the caller's block (inlining the call
 * hierarchy), while sequential statements chain as usual.
 */
export function addControlFlow(graph, content, ext, filePath, { mergeBlocks = true, inlineCalls = true } = {}) {
  const { symbols } = parseSymbols(content, ext);
  const bodies = new Map();
  for (const s of symbols) {
    if (s.kind !== 'function' || s.index == null) continue;
    // Brace-match the full body from the declaration; parseSymbols' own slice
    // stops at the first nested symbol and would truncate functions that
    // contain inner consts/functions to just their signature line.
    const body = extractFunctionBody(content, s.index, ext);
    if (body) bodies.set(s.name, body);
  }
  if (!bodies.size) return;

  const astCache = new Map();
  const astOf = name => {
    if (!astCache.has(name)) astCache.set(name, parseFunctionAst(bodies.get(name), ext));
    return astCache.get(name);
  };
  const names = [...bodies.keys()];

  // Roots = the functions we render as their own flowchart. With inlining on,
  // only entry points (functions not called by any other in-file function) are
  // roots; their callees get nested inline. With inlining off, every function is
  // its own independent chart and calls stay as plain statement nodes.
  let roots;
  if (inlineCalls) {
    const calledByOthers = new Set();
    for (const [name, body] of bodies) {
      const stripped = stripCode(body);
      for (const other of names) {
        if (other !== name && callRe(other).test(stripped)) calledByOthers.add(other);
      }
    }
    roots = names.filter(n => !calledByOthers.has(n));
    if (!roots.length) roots = names; // mutual recursion — show everything as roots
  } else {
    roots = names;
  }

  let count = 0;
  let capped = false;
  const nid = () => `cf${count++}`;
  const addNode = (label, type, group) => {
    if (count >= MAX_CFG_NODES) { capped = true; return null; }
    const id = nid();
    graph.addNode({ id, label, type, group, path: filePath });
    return id;
  };
  const addEdge = (from, to, label) => {
    if (from && to) graph.addEdge({ from, to, type: 'flow', label: label || undefined });
  };

  // Render a function's flowchart into `group`; returns { entry, exits }.
  function renderFn(name, group, stack, isRoot) {
    const start = addNode(name, 'start', group);
    const ast = astOf(name);
    if (!ast || !start) return { entry: start, exits: start ? [{ from: start }] : [] };

    const returns = [];
    const nested = new Map(); // F -> { entry, exits } already inlined under this group
    const fall = emit(ast, [{ from: start }], group, new Set(stack).add(name), nested, returns);
    const exits = [...returns, ...fall];

    if (isRoot) {
      const end = addNode('end', 'end', group);
      exits.forEach(p => addEdge(p.from, end, p.label));
      return { entry: start, exits: [] };
    }
    return { entry: start, exits };
  }

  // In-file functions a statement calls (only when inlining is enabled).
  const callsOf = node =>
    inlineCalls && node.t === 'stmt' ? calledFuncs(node.text, names, bodies) : [];

  // A plain statement = a `stmt` with no in-file call to inline. Runs of these
  // can be collapsed into one block node to cut node/edge clutter.
  const isPlainStmt = node => node.t === 'stmt' && callsOf(node).length === 0;

  function emit(list, preds, group, stack, nested, returns) {
    for (let i = 0; i < list.length; i++) {
      if (capped) break;
      const node = list[i];
      if (node.t === 'stmt' || node.t === 'jump') {
        const calls = callsOf(node);
        if (calls.length) {
          for (const F of calls) {
            if (stack.has(F)) { // recursion — render as a plain node, don't inline
              const pn = addNode(`${node.text}`, 'process', group);
              preds.forEach(p => addEdge(p.from, pn, p.label));
              preds = pn ? [{ from: pn }] : preds;
            } else if (nested.has(F)) { // already inlined here — re-enter the block
              const blk = nested.get(F);
              preds.forEach(p => addEdge(p.from, blk.entry, p.label));
              preds = blk.exits;
            } else {
              const r = renderFn(F, `${group}/${F}`, stack, false);
              nested.set(F, r);
              preds.forEach(p => addEdge(p.from, r.entry, p.label));
              preds = r.exits;
            }
          }
        } else if (mergeBlocks && isPlainStmt(node)) {
          // Collapse this and any following plain statements into one block node.
          const texts = [node.text];
          while (i + 1 < list.length && isPlainStmt(list[i + 1])) texts.push(list[++i].text);
          const pn = addNode(texts.join('\n'), 'process', group);
          preds.forEach(p => addEdge(p.from, pn, p.label));
          preds = pn ? [{ from: pn }] : preds;
        } else {
          const pn = addNode(node.text, node.t === 'jump' ? 'jump' : 'process', group);
          preds.forEach(p => addEdge(p.from, pn, p.label));
          if (node.t === 'jump') { if (node.ret && pn) returns.push({ from: pn }); preds = []; }
          else preds = pn ? [{ from: pn }] : preds;
        }
      } else if (node.t === 'if') {
        const d = addNode(node.cond, 'decision', group);
        preds.forEach(p => addEdge(p.from, d, p.label));
        let exits = emit(node.then, [{ from: d, label: 'yes' }], group, stack, nested, returns);
        let lastNo = { from: d, label: 'no' };
        for (const e of node.elifs) {
          const ed = addNode(e.cond, 'decision', group);
          addEdge(lastNo.from, ed, lastNo.label);
          exits = exits.concat(emit(e.body, [{ from: ed, label: 'yes' }], group, stack, nested, returns));
          lastNo = { from: ed, label: 'no' };
        }
        if (node.els) exits = exits.concat(emit(node.els, [lastNo], group, stack, nested, returns));
        else exits.push(lastNo);
        preds = exits;
      } else if (node.t === 'loop') {
        const label = `${node.kind}${node.cond ? ' (' + node.cond + ')' : ''}`;
        const d = addNode(label, 'decision', group);
        preds.forEach(p => addEdge(p.from, d, p.label));
        const bodyExits = emit(node.body, [{ from: d, label: 'loop' }], group, stack, nested, returns);
        bodyExits.forEach(b => addEdge(b.from, d, b.label)); // back-edge to condition
        preds = [{ from: d, label: 'done' }];
      }
    }
    return preds;
  }

  for (const root of roots) {
    if (capped) break;
    renderFn(root, `${filePath}/${root}`, new Set(), true);
  }
}

function escapeReg(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function callRe(name) { return new RegExp(`(?:^|[^\\w.$])${escapeReg(name)}\\s*\\(`); }

/** In-file functions called in a statement, in textual order. */
function calledFuncs(text, names, bodies) {
  const hits = [];
  for (const F of names) {
    const m = callRe(F).exec(text);
    if (m) hits.push({ F, idx: m.index });
  }
  hits.sort((a, b) => a.idx - b.idx);
  return hits.map(h => h.F);
}
