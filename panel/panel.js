import { getStoredApiKey } from '../src/storage/settings.js';

const params = new URLSearchParams(location.search);
const owner = params.get('owner');
const repo = params.get('repo');
const ref = params.get('ref') || 'HEAD';

const statusBar = document.getElementById('status-bar');
const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const graphPlaceholder = document.getElementById('graph-placeholder');
const mermaidOutput = document.getElementById('mermaid-output');
const modeSelect = document.getElementById('mode-select');
const pathFilter = document.getElementById('path-filter');
const refreshBtn = document.getElementById('refresh-btn');
const copyBtn = document.getElementById('copy-btn');
const downloadBtn = document.getElementById('download-btn');
const toggleGrouping = document.getElementById('toggle-grouping');
const toggleExternals = document.getElementById('toggle-externals');
const toggleIsolated = document.getElementById('toggle-isolated');

document.getElementById('panel-title').textContent = `${owner}/${repo}`;

mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose', maxTextSize: 200000 });

let currentMermaid = '';
let activePort = null;

async function generate() {
  if (activePort) {
    activePort.disconnect();
    activePort = null;
  }

  setStatus('Connecting…');
  setProgress(0);
  progressBar.style.display = 'block';
  graphPlaceholder.style.display = 'flex';
  graphPlaceholder.querySelector('p').textContent = 'Loading graph…';
  mermaidOutput.style.display = 'none';
  mermaidOutput.removeAttribute('data-processed');
  mermaidOutput.textContent = '';

  const apiKey = await getStoredApiKey();
  const mode = modeSelect.value;
  const path = pathFilter.value.trim() || undefined;
  const grouping = toggleGrouping.checked;
  const includeExternals = toggleExternals.checked;
  const keepIsolated = toggleIsolated.checked;

  const port = chrome.runtime.connect({ name: 'graph-gen' });
  activePort = port;

  port.onMessage.addListener(async msg => {
    if (msg.type === 'status') {
      setStatus(msg.text);
    } else if (msg.type === 'progress') {
      setStatus(`Reading files… ${msg.done} / ${msg.total}`);
      setProgress(msg.done / msg.total);
    } else if (msg.type === 'done') {
      progressBar.style.display = 'none';
      currentMermaid = msg.mermaid;
      setStatus(`${msg.stats.nodes} nodes · ${msg.stats.edges} edges`);
      await renderMermaid(currentMermaid);
      activePort = null;
    } else if (msg.type === 'error') {
      progressBar.style.display = 'none';
      setStatus(`Error: ${msg.message}`, true);
      graphPlaceholder.querySelector('p').textContent = msg.message;
      activePort = null;
    }
  });

  port.onDisconnect.addListener(() => {
    if (activePort) {
      setStatus('Connection lost — try refreshing.', true);
      activePort = null;
    }
  });

  port.postMessage({
    type: 'GENERATE_GRAPH',
    payload: { owner, repo, ref, path, mode, apiKey, grouping, includeExternals, keepIsolated },
  });
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

function setProgress(ratio) {
  progressFill.style.width = `${Math.round(ratio * 100)}%`;
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
toggleGrouping.addEventListener('change', generate);
toggleExternals.addEventListener('change', generate);
toggleIsolated.addEventListener('change', generate);

generate();
