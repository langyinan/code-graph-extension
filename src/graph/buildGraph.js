import { fetchFileContent } from '../github/fetchTree.js';
import { parseImports } from '../parsers/parseImports.js';
import { parseCalls } from '../parsers/parseCalls.js';
import { parseSymbols } from '../parsers/parseSymbols.js';
import { addControlFlow } from './buildControlFlow.js';
import { Graph } from './Graph.js';
import { pruneGraph } from './pruneGraph.js';

const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', 'vendor']);
const MAX_FILE_BYTES = 150_000; // skip minified / generated files

export async function buildGraph({
  tree, owner, repo, ref, path, mode, apiKey, onProgress,
  includeExternals = true,
  keepIsolated = true,
  detail = 'medium', // 'low'=components, 'medium'=source files, 'high'=all files, 'symbols'=functions+variables, 'source'=symbols + code bodies
}) {
  const graph = new Graph();

  // 'high' detail includes every file (code + non-code); otherwise just source files.
  const files = tree.filter(node => {
    if (path && !node.path.startsWith(path)) return false;
    const parts = node.path.split('/');
    if (parts.some(p => SKIPPED_DIRS.has(p))) return false;
    if (node.size > MAX_FILE_BYTES) return false;
    return detail === 'high' ? true : isSupportedExtension(node.path);
  });

  const fileSet = new Set(files.map(f => f.path));

  // The symbol breakdown is a detail level that supersedes the import/call mode.
  // 'source' is the same breakdown plus each function's code body.
  // 'controlflow' renders each function as an if/loop flowchart.
  const cfgMode = detail === 'controlflow';
  const symbolMode = detail === 'symbols' || detail === 'source' || cfgMode;
  const withSource = detail === 'source';

  // In imports mode, add every file up front (grouped by directory) so even
  // files with no edges still appear. In calls/symbols mode the nodes are
  // functions/variables, added as they're discovered.
  if (mode !== 'calls' && !symbolMode) {
    for (const f of files) {
      graph.addNode({
        id: f.path,
        label: baseOf(f.path),
        type: 'file',
        path: f.path,
        group: dirOf(f.path),
      });
    }
  }

  let done = 0;
  const total = files.length;

  await Promise.all(
    files.map(async f => {
      // Non-code files (only present in 'high' detail) appear as nodes but have
      // nothing to parse — no need to fetch their content.
      if (!isSupportedExtension(f.path)) {
        done++;
        if (onProgress) onProgress(done, total);
        return;
      }
      try {
        const content = await fetchFileContent({ owner, repo, ref, path: f.path, apiKey });
        const ext = extOf(f.path);

        if (cfgMode) {
          addControlFlow(graph, content, ext, f.path);
        } else if (symbolMode) {
          addSymbols(graph, content, ext, f.path, withSource);
        } else if (mode === 'calls') {
          addCalls(graph, content, ext, f.path);
        } else {
          addImports(graph, content, ext, f.path, fileSet, includeExternals);
        }
      } catch (err) {
        console.warn(`[code-graph] Skipping ${f.path}: ${err.message}`);
      } finally {
        done++;
        if (onProgress) onProgress(done, total);
      }
    })
  );

  const result = detail === 'low' ? collapseToComponents(graph) : graph;
  return pruneGraph(result, { keepIsolated });
}

/**
 * Collapses file/function nodes into one node per top-level folder ("component"),
 * remapping edges between components and dropping intra-component edges. External
 * package nodes pass through unchanged. Root-level files stay as themselves.
 */
function collapseToComponents(graph) {
  const out = new Graph();
  const idFor = new Map();

  const toComponent = node => {
    if (node.type === 'external') return { ...node };
    const top = node.path.split('/')[0];
    if (node.path.includes('/')) {
      return { id: `dir:${top}`, label: `${top}/`, type: 'component', path: top };
    }
    return { id: node.path, label: node.path, type: 'file', path: node.path };
  };

  for (const [, node] of graph.nodes) {
    const cn = toComponent(node);
    idFor.set(node.id, cn.id);
    out.addNode(cn);
  }

  for (const e of graph.edges) {
    const from = idFor.get(e.from);
    const to = idFor.get(e.to);
    if (from && to && from !== to) out.addEdge({ from, to, type: e.type });
  }

  return out;
}

function addImports(graph, content, ext, filePath, fileSet, includeExternals) {
  const imports = parseImports(content, ext, filePath);
  for (const { spec, line } of imports) {
    if (!isValidSpecifier(spec)) continue; // guard against matches inside comments/strings
    const resolved = resolveImport(spec, filePath, fileSet);
    if (resolved) {
      graph.addEdge({ from: filePath, to: resolved, type: 'import', file: filePath, line });
    } else if (includeExternals && !spec.startsWith('.') && !spec.startsWith('/')) {
      // External (3rd-party / stdlib) dependency — show it as its own node.
      // Applies to every language, not just JS.
      const pkg = externalName(spec);
      if (!pkg) continue;
      const id = `ext:${pkg}`;
      graph.addNode({ id, label: pkg, type: 'external', group: 'dependencies' });
      graph.addEdge({ from: filePath, to: id, type: 'external', file: filePath, line });
    }
  }
}

function addCalls(graph, content, ext, filePath) {
  const calls = parseCalls(content, ext);
  for (const call of calls) {
    const caller = `${filePath}::${call.caller}`;
    const callee = `${filePath}::${call.callee}`;
    // Functions are grouped under a subgraph named after their file.
    graph.addNode({ id: caller, label: call.caller, type: 'function', path: filePath, group: filePath });
    graph.addNode({ id: callee, label: call.callee, type: 'function', path: filePath, group: filePath });
    graph.addEdge({ from: caller, to: callee, type: 'call', file: filePath, line: call.line });
  }
}

/** Real module specifiers are ASCII paths; rejects junk captured from comments (e.g. "…"). */
function isValidSpecifier(spec) {
  return /^[@\w./~-]+$/.test(spec);
}

function addSymbols(graph, content, ext, filePath, withSource) {
  const { symbols, edges } = parseSymbols(content, ext, { withSource });
  for (const s of symbols) {
    graph.addNode({
      id: `${filePath}::${s.name}`,
      label: s.name,
      type: s.kind === 'variable' ? 'variable' : 'function',
      path: filePath,
      group: filePath,   // cluster symbols under their file
      line: s.line,      // declaration line — shown on the node and linked to
      content: s.body,   // 'source' level: the function's code body
    });
  }
  for (const e of edges) {
    graph.addEdge({
      from: `${filePath}::${e.from}`,
      to: `${filePath}::${e.to}`,
      type: 'call',
      file: filePath,
      line: e.line,
      code: e.code,      // 'source' level: the actual line of code
    });
  }
}

/** Reduces a bare specifier to its package name: '@scope/pkg/x' → '@scope/pkg', 'lodash/y' → 'lodash'. */
function externalName(spec) {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
  return spec.split('/')[0];
}

function isSupportedExtension(filePath) {
  return ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.rb', '.php', '.cs', '.cpp', '.c', '.h'].includes(extOf(filePath));
}

function extOf(p) {
  const m = p.match(/\.[^.]+$/);
  return m ? m[0] : '';
}

function baseOf(p) {
  return p.split('/').pop();
}

function dirOf(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

const INDEX_EXTS = ['js', 'ts', 'jsx', 'tsx', 'mjs', 'cjs'];

function resolveImport(importPath, fromFile, fileSet) {
  if (!importPath.startsWith('.')) return null; // external package — handled separately

  const dir = fromFile.split('/').slice(0, -1).join('/');
  const base = normalizePath(`${dir}/${importPath}`);

  const candidates = [base];
  for (const ext of INDEX_EXTS) {
    candidates.push(`${base}.${ext}`);
    candidates.push(`${base}/index.${ext}`);
  }
  return candidates.find(c => fileSet.has(c)) ?? null;
}

/** Collapses `.` and `..` segments, e.g. src/graph/../github → src/github */
function normalizePath(p) {
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}
