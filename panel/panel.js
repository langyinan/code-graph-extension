import { getStoredApiKey } from '../src/storage/settings.js';

const params = new URLSearchParams(location.search);
const owner = params.get('owner');
const repo = params.get('repo');
const ref = params.get('ref') || 'HEAD';

const statusBar = document.getElementById('status-bar');
const graphPlaceholder = document.getElementById('graph-placeholder');
const mermaidOutput = document.getElementById('mermaid-output');
const modeSelect = document.getElementById('mode-select');
const pathFilter = document.getElementById('path-filter');
const refreshBtn = document.getElementById('refresh-btn');
const copyBtn = document.getElementById('copy-btn');
const downloadBtn = document.getElementById('download-btn');

document.getElementById('panel-title').textContent = `${owner}/${repo}`;

mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose', maxTextSize: 100000 });

let currentMermaid = '';

async function generate() {
  setStatus('Fetching repo tree…');
  graphPlaceholder.style.display = 'flex';
  mermaidOutput.style.display = 'none';
  mermaidOutput.removeAttribute('data-processed');
  mermaidOutput.textContent = '';

  const apiKey = await getStoredApiKey();
  const mode = modeSelect.value;
  const path = pathFilter.value.trim() || undefined;

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GENERATE_GRAPH',
      payload: { owner, repo, ref, path, mode, apiKey },
    });

    if (response.error) throw new Error(response.error);

    currentMermaid = response.mermaid;
    setStatus(`${response.stats.nodes} nodes · ${response.stats.edges} edges`);
    await renderMermaid(currentMermaid);
  } catch (err) {
    setStatus(`Error: ${err.message}`, true);
    graphPlaceholder.querySelector('p').textContent = err.message;
  }
}

async function renderMermaid(source) {
  mermaidOutput.textContent = source;
  mermaidOutput.removeAttribute('data-processed');
  graphPlaceholder.style.display = 'none';
  mermaidOutput.style.display = 'block';
  await mermaid.run({ nodes: [mermaidOutput] });
}

function setStatus(msg, isError = false) {
  statusBar.textContent = msg;
  statusBar.style.color = isError ? '#cf222e' : 'inherit';
}

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(currentMermaid).then(() => setStatus('Copied to clipboard.'));
});

downloadBtn.addEventListener('click', () => {
  const svg = mermaidOutput.querySelector('svg');
  if (!svg) return;
  const blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `${repo}-graph.svg`,
  });
  a.click();
});

refreshBtn.addEventListener('click', generate);
modeSelect.addEventListener('change', generate);

generate();
