import { fetchRepoTree } from '../src/github/fetchTree.js';
import { buildGraph } from '../src/graph/buildGraph.js';

// Long-lived port connection so the panel can receive progress updates.
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'graph-gen') return;

  port.onMessage.addListener(async msg => {
    if (msg.type !== 'GENERATE_GRAPH') return;
    const {
      owner, repo, ref, path, mode, apiKey,
      grouping = true,
      includeExternals = true,
      keepIsolated = true,
    } = msg.payload;

    try {
      port.postMessage({ type: 'status', text: 'Fetching repo tree…' });

      const tree = await fetchRepoTree({ owner, repo, ref, apiKey });
      const sourceFiles = tree.filter(n => isSupportedExtension(n.path));

      port.postMessage({
        type: 'status',
        text: `Found ${sourceFiles.length} source files — reading content…`,
      });

      const graph = await buildGraph({
        tree,
        owner,
        repo,
        ref,
        path,
        mode,
        apiKey,
        includeExternals,
        keepIsolated,
        onProgress(done, total) {
          port.postMessage({ type: 'progress', done, total });
        },
      });

      const linkBase = `https://github.com/${owner}/${repo}/blob/${ref}/`;
      port.postMessage({
        type: 'done',
        mermaid: graph.toMermaid({ linkBase, grouping }),
        stats: graph.stats(),
      });
    } catch (err) {
      port.postMessage({ type: 'error', message: err.message });
    }
  });
});

function isSupportedExtension(p) {
  return /\.(js|ts|jsx|tsx|py|go|rs|java|rb|php|cs|cpp|c|h)$/.test(p);
}
