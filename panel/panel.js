import { getStoredApiKey } from '../src/storage/settings.js';

const params = new URLSearchParams(location.search);
const owner = params.get('owner');
const repo = params.get('repo');
let ref = params.get('ref') || 'HEAD';

const statusBar = document.getElementById('status-bar');
const progressBar = document.getElementById('progress-bar');
const progressFill = document.getElementById('progress-fill');
const graphPlaceholder = document.getElementById('graph-placeholder');
const graphContainer = document.getElementById('graph-container');
const graphViewport = document.getElementById('graph-viewport');
const graphLegend = document.getElementById('graph-legend');
const mermaidOutput = document.getElementById('mermaid-output');
const modeSelect = document.getElementById('mode-select');
const detailSelect = document.getElementById('detail-select');
const pathFilter = document.getElementById('path-filter');
const refreshBtn = document.getElementById('refresh-btn');
const copyBtn = document.getElementById('copy-btn');
const downloadBtn = document.getElementById('download-btn');
const toggleGrouping = document.getElementById('toggle-grouping');
const toggleExternals = document.getElementById('toggle-externals');
const toggleIsolated = document.getElementById('toggle-isolated');
const toggleFollow = document.getElementById('toggle-follow');

// Latest folder reported by the content script (the page the user is viewing).
let latestLocation = null;

document.getElementById('panel-title').textContent = `${owner}/${repo}`;

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  maxTextSize: 1_000_000,
  // Match the panel body font so Mermaid's text measurement matches the rendered
  // (foreignObject) font — otherwise labels get clipped.
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  // Roomier layout — don't conserve space.
  flowchart: { nodeSpacing: 55, rankSpacing: 70, padding: 14, useMaxWidth: false },
});

let currentMermaid = '';
let currentEdgeLinks = {};
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
  const detail = detailSelect.value;
  const grouping = toggleGrouping.checked;
  const includeExternals = toggleExternals.checked;
  const keepIsolated = toggleIsolated.checked;

  updateLegend({ mode, detail, includeExternals });

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
      currentEdgeLinks = msg.edgeLinks || {};
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
    payload: { owner, repo, ref, path, mode, apiKey, detail, grouping, includeExternals, keepIsolated },
  });
}

async function renderMermaid(source) {
  mermaidOutput.textContent = source;
  mermaidOutput.removeAttribute('data-processed');
  graphPlaceholder.style.display = 'none';
  mermaidOutput.style.display = 'block';
  // Render at 1:1 — an ancestor transform skews Mermaid's getBoundingClientRect
  // text measurement, which shrinks node boxes and clips the labels.
  graphViewport.style.transform = 'none';
  await mermaid.run({ nodes: [mermaidOutput] });
  attachEdgeLinks(mermaidOutput.querySelector('svg'));
  setupPanZoom();
}

// Mermaid can't make edges clickable natively, so we wire it up after render:
// each edge path / label carries data-id="L_<from>_<to>_0", which maps to the
// GitHub line URL recorded in edgeLinks.
function attachEdgeLinks(svg) {
  if (!svg) return;
  svg.querySelectorAll('[data-id^="L_"]').forEach(el => {
    const href = currentEdgeLinks[el.getAttribute('data-id')];
    if (!href) return;
    el.classList.add('cg-edge-link');
    if (!el.querySelector(':scope > title')) {
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      t.textContent = 'Open source line';
      el.appendChild(t);
    }
    el.addEventListener('click', e => {
      e.stopPropagation();
      window.open(href, '_blank', 'noopener');
    });
  });
}

// ── Pan / zoom / drag ────────────────────────────────────────────────────────
const view = { scale: 1, x: 0, y: 0 };

function applyTransform() {
  graphViewport.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

function setupPanZoom() {
  const svg = mermaidOutput.querySelector('svg');
  if (!svg) return;

  // Pin the SVG to its natural pixel size so the CSS transform (not a squished
  // width:100%) controls scale — keeps text crisp at any zoom.
  const vb = svg.viewBox.baseVal;
  const naturalW = vb && vb.width ? vb.width : svg.clientWidth;
  const naturalH = vb && vb.height ? vb.height : svg.clientHeight;
  if (naturalW && naturalH) {
    svg.setAttribute('width', naturalW);
    svg.setAttribute('height', naturalH);
  }
  svg.style.maxWidth = 'none';

  // Fit to the container width initially (clamped), so big graphs are visible.
  const avail = graphContainer.clientWidth - 32;
  view.scale = naturalW ? Math.min(1, Math.max(0.15, avail / naturalW)) : 1;
  view.x = 0;
  view.y = 0;
  applyTransform();
}

function zoomAt(clientX, clientY, factor) {
  const rect = graphContainer.getBoundingClientRect();
  const mx = clientX - rect.left;
  const my = clientY - rect.top;
  // Keep the point under the cursor fixed while scaling.
  const wx = (mx - view.x) / view.scale;
  const wy = (my - view.y) / view.scale;
  view.scale = Math.min(8, Math.max(0.1, view.scale * factor));
  view.x = mx - wx * view.scale;
  view.y = my - wy * view.scale;
  applyTransform();
}

graphContainer.addEventListener('wheel', e => {
  if (mermaidOutput.style.display === 'none') return;
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
}, { passive: false });

// Drag to pan. Suppress the click that follows a real drag so node links
// don't fire when you were just panning.
let dragging = false;
let moved = false;
let panOffsetX = 0;
let panOffsetY = 0;
let downX = 0;
let downY = 0;

graphContainer.addEventListener('mousedown', e => {
  if (mermaidOutput.style.display === 'none') return;
  dragging = true;
  moved = false;
  downX = e.clientX;
  downY = e.clientY;
  panOffsetX = e.clientX - view.x;
  panOffsetY = e.clientY - view.y;
  graphContainer.classList.add('grabbing');
});

window.addEventListener('mousemove', e => {
  if (!dragging) return;
  if (Math.abs(e.clientX - downX) > 3 || Math.abs(e.clientY - downY) > 3) moved = true;
  view.x = e.clientX - panOffsetX;
  view.y = e.clientY - panOffsetY;
  applyTransform();
});

window.addEventListener('mouseup', () => {
  dragging = false;
  graphContainer.classList.remove('grabbing');
});

graphContainer.addEventListener('click', e => {
  if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; }
}, true);

document.getElementById('zoom-in').addEventListener('click', () => centerZoom(1.2));
document.getElementById('zoom-out').addEventListener('click', () => centerZoom(1 / 1.2));
document.getElementById('zoom-reset').addEventListener('click', setupPanZoom);

function centerZoom(factor) {
  const rect = graphContainer.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
}

function setStatus(msg, isError = false) {
  statusBar.textContent = msg;
  statusBar.style.color = isError ? '#cf222e' : 'inherit';
}

// Swatch colors mirror the classDefs in Graph.js (and Mermaid's default node fill).
const LEGEND = {
  file: ['#ECECFF', '#9370DB', 'File'],
  function: ['#ECECFF', '#9370DB', 'Function'],
  variable: ['#dafbe1', '#1a7f37', 'Variable'],
  external: ['#fff3cd', '#d39e00', 'External dependency'],
  component: ['#ddf4ff', '#0969da', 'Folder / component'],
  decision: ['#fff8c5', '#bf8700', 'Condition (if/loop)'],
  process: ['#ECECFF', '#9370DB', 'Statement'],
  terminal: ['#dafbe1', '#1a7f37', 'Start / end'],
};

function updateLegend({ mode, detail, includeExternals }) {
  const keys = [];
  const symbolView = detail === 'symbols' || detail === 'source';
  if (detail === 'controlflow') {
    keys.push('decision', 'process', 'terminal');
  } else if (detail === 'low') {
    keys.push('component');
  } else if (symbolView) {
    keys.push('function', 'variable');
  } else if (mode === 'calls') {
    keys.push('function');
  } else {
    keys.push('file');
  }
  if (includeExternals && !symbolView && detail !== 'controlflow' && mode !== 'calls') keys.push('external');

  graphLegend.innerHTML = keys.map(k => {
    const [fill, stroke, label] = LEGEND[k];
    return `<span class="legend-item"><span class="legend-swatch" style="background:${fill};border-color:${stroke}"></span>${label}</span>`;
  }).join('');
  graphLegend.style.display = keys.length ? 'flex' : 'none';
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
detailSelect.addEventListener('change', generate);
toggleGrouping.addEventListener('change', generate);
toggleExternals.addEventListener('change', generate);
toggleIsolated.addEventListener('change', generate);

// ── Follow current GitHub folder ─────────────────────────────────────────────
let lastApplied = null;

function applyLocation() {
  if (!latestLocation) return;
  const path = latestLocation.path || '';
  const newRef = latestLocation.ref || ref;
  const key = `${newRef}::${path}`;
  if (key === lastApplied) return; // already showing this folder
  lastApplied = key;
  pathFilter.value = path;
  ref = newRef;
  generate();
}

window.addEventListener('message', e => {
  if (e.origin !== 'https://github.com') return;
  const d = e.data;
  if (!d || d.type !== 'CODE_GRAPH_LOCATION') return;
  if (d.owner !== owner || d.repo !== repo) return; // different repo — ignore
  latestLocation = d;
  if (toggleFollow.checked) applyLocation();
});

toggleFollow.addEventListener('change', () => {
  pathFilter.readOnly = toggleFollow.checked;
  pathFilter.style.opacity = toggleFollow.checked ? '0.55' : '';
  if (toggleFollow.checked) {
    lastApplied = null;
    if (latestLocation) applyLocation();
    else window.parent.postMessage({ type: 'CODE_GRAPH_REQUEST_LOCATION' }, '*');
  }
});

// Ask the page for the current folder up front, so toggling on is instant.
window.parent.postMessage({ type: 'CODE_GRAPH_REQUEST_LOCATION' }, '*');

generate();
