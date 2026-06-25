import { fetchRepoTree } from '../src/github/fetchTree.js';
import { buildGraph } from '../src/graph/buildGraph.js';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GENERATE_GRAPH') {
    handleGenerateGraph(msg.payload).then(sendResponse).catch(err =>
      sendResponse({ error: err.message })
    );
    return true; // keep channel open for async response
  }
});

async function handleGenerateGraph({ owner, repo, ref, path, mode, apiKey }) {
  const tree = await fetchRepoTree({ owner, repo, ref, apiKey });
  const graph = await buildGraph({ tree, owner, repo, ref, path, mode, apiKey });
  return { mermaid: graph.toMermaid(), stats: graph.stats() };
}
