import { parseSymbols } from '../parsers/parseSymbols.js';
import { parseFunctionAst, stripCode } from '../parsers/parseControlFlow.js';

const MAX_CFG_NODES = 1500; // safety cap so deep inlining can't explode

/**
 * Builds a control-flow graph where a call to another in-file function nests
 * that function's flowchart inside the caller's block (inlining the call
 * hierarchy), while sequential statements chain as usual.
 */
export function addControlFlow(graph, content, ext, filePath) {
  const { symbols } = parseSymbols(content, ext, { withSource: true });
  const bodies = new Map();
  for (const s of symbols) if (s.kind === 'function' && s.body) bodies.set(s.name, s.body);
  if (!bodies.size) return;

  const astCache = new Map();
  const astOf = name => {
    if (!astCache.has(name)) astCache.set(name, parseFunctionAst(bodies.get(name), ext));
    return astCache.get(name);
  };
  const names = [...bodies.keys()];

  // Roots = functions not called by any other in-file function (entry points).
  const calledByOthers = new Set();
  for (const [name, body] of bodies) {
    const stripped = stripCode(body);
    for (const other of names) {
      if (other !== name && callRe(other).test(stripped)) calledByOthers.add(other);
    }
  }
  let roots = names.filter(n => !calledByOthers.has(n));
  if (!roots.length) roots = names; // mutual recursion — show everything as roots

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

  function emit(list, preds, group, stack, nested, returns) {
    for (const node of list) {
      if (capped) break;
      if (node.t === 'stmt' || node.t === 'jump') {
        const calls = node.t === 'stmt' ? calledFuncs(node.text, names, bodies) : [];
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
