import { fetchFileContent } from '../github/fetchTree.js';
import { parseImports } from '../parsers/parseImports.js';
import { parseCalls } from '../parsers/parseCalls.js';
import { Graph } from './Graph.js';
import { pruneGraph } from './pruneGraph.js';

const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', 'vendor']);
const MAX_FILE_BYTES = 150_000; // skip minified / generated files

export async function buildGraph({ tree, owner, repo, ref, path, mode, apiKey }) {
  const graph = new Graph();

  // Filter to source files inside the requested path
  const files = tree.filter(node => {
    if (path && !node.path.startsWith(path)) return false;
    const parts = node.path.split('/');
    if (parts.some(p => SKIPPED_DIRS.has(p))) return false;
    if (node.size > MAX_FILE_BYTES) return false;
    return isSupportedExtension(node.path);
  });

  // Add all file nodes first so edges can reference them even before their
  // content is parsed.
  for (const f of files) {
    graph.addNode({ id: f.path, label: shortLabel(f.path), type: 'file', path: f.path });
  }

  // Parse each file for imports / calls
  await Promise.all(
    files.map(async f => {
      try {
        const content = await fetchFileContent({ owner, repo, ref, path: f.path, apiKey });
        const ext = extOf(f.path);

        const imports = parseImports(content, ext, f.path);
        for (const imp of imports) {
          const resolved = resolveImport(imp, f.path, files);
          if (resolved) graph.addEdge({ from: f.path, to: resolved, type: 'import' });
        }

        if (mode === 'calls') {
          const calls = parseCalls(content, ext);
          for (const call of calls) {
            graph.addNode({ id: `${f.path}::${call.caller}`, label: call.caller, type: 'function', path: f.path });
            graph.addNode({ id: `${f.path}::${call.callee}`, label: call.callee, type: 'function', path: f.path });
            graph.addEdge({ from: `${f.path}::${call.caller}`, to: `${f.path}::${call.callee}`, type: 'call' });
          }
        }
      } catch (err) {
        console.warn(`[code-graph] Skipping ${f.path}: ${err.message}`);
      }
    })
  );

  return pruneGraph(graph);
}

function isSupportedExtension(filePath) {
  return ['.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.rb', '.php', '.cs', '.cpp', '.c', '.h'].includes(extOf(filePath));
}

function extOf(p) {
  const m = p.match(/\.[^.]+$/);
  return m ? m[0] : '';
}

function shortLabel(p) {
  return p.split('/').slice(-2).join('/');
}

function resolveImport(importPath, fromFile, allFiles) {
  if (importPath.startsWith('.')) {
    const dir = fromFile.split('/').slice(0, -1).join('/');
    const candidates = [
      `${dir}/${importPath}`,
      `${dir}/${importPath}.js`,
      `${dir}/${importPath}.ts`,
      `${dir}/${importPath}/index.js`,
      `${dir}/${importPath}/index.ts`,
    ].map(p => p.replace(/\/\.\//g, '/').replace(/^\//, ''));
    return candidates.find(c => allFiles.some(f => f.path === c)) ?? null;
  }
  return null; // external package — not in this repo's tree
}
