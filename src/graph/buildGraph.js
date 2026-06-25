import { fetchFileContent } from '../github/fetchTree.js';
import { parseImports } from '../parsers/parseImports.js';
import { parseCalls } from '../parsers/parseCalls.js';
import { Graph } from './Graph.js';
import { pruneGraph } from './pruneGraph.js';

const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', 'vendor']);
const MAX_FILE_BYTES = 150_000; // skip minified / generated files
const JS_EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

export async function buildGraph({
  tree, owner, repo, ref, path, mode, apiKey, onProgress,
  includeExternals = true,
  keepIsolated = true,
}) {
  const graph = new Graph();

  // Filter to source files inside the requested path
  const files = tree.filter(node => {
    if (path && !node.path.startsWith(path)) return false;
    const parts = node.path.split('/');
    if (parts.some(p => SKIPPED_DIRS.has(p))) return false;
    if (node.size > MAX_FILE_BYTES) return false;
    return isSupportedExtension(node.path);
  });

  const fileSet = new Set(files.map(f => f.path));

  // In imports mode, add every file up front (grouped by directory) so even
  // files with no edges still appear. In calls mode the nodes are functions,
  // added as they're discovered.
  if (mode !== 'calls') {
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
      try {
        const content = await fetchFileContent({ owner, repo, ref, path: f.path, apiKey });
        const ext = extOf(f.path);

        if (mode === 'calls') {
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

  return pruneGraph(graph, { keepIsolated });
}

function addImports(graph, content, ext, filePath, fileSet, includeExternals) {
  const imports = parseImports(content, ext, filePath);
  for (const imp of imports) {
    if (!isValidSpecifier(imp)) continue; // guard against matches inside comments/strings
    const resolved = resolveImport(imp, filePath, fileSet);
    if (resolved) {
      graph.addEdge({ from: filePath, to: resolved, type: 'import' });
    } else if (includeExternals && JS_EXTS.has(ext) && !imp.startsWith('.')) {
      // External (npm / 3rd-party) package — show it as its own node.
      const pkg = externalName(imp);
      if (!pkg) continue;
      const id = `ext:${pkg}`;
      graph.addNode({ id, label: pkg, type: 'external', group: 'node_modules' });
      graph.addEdge({ from: filePath, to: id, type: 'external' });
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
    graph.addEdge({ from: caller, to: callee, type: 'call' });
  }
}

/** Real module specifiers are ASCII paths; rejects junk captured from comments (e.g. "…"). */
function isValidSpecifier(spec) {
  return /^[@\w./~-]+$/.test(spec);
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
