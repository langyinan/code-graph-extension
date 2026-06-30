/**
 * Injected into every github.com page.
 * Detects repo pages, injects the "Code Graph" button into the nav,
 * and launches a right-docked, resizable panel (devtools-style) that
 * reflows the page content instead of covering it.
 */

(function () {
  'use strict';

  const MIN_WIDTH = 320;
  const DEFAULT_WIDTH = Math.round(window.innerWidth * 0.5); // half the screen
  const EXT_ORIGIN = chrome.runtime.getURL('').replace(/\/$/, '');
  let dock = null;
  let iframe = null;
  let lastHref = location.href;

  function isRepoPage() {
    return /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(location.href);
  }

  function parseRepoFromURL() {
    const m = location.href.match(/github\.com\/([^/]+)\/([^/]+?)(?:\/|$)/);
    if (!m) return null;
    return { owner: m[1], repo: m[2] };
  }

  function injectButton() {
    if (document.getElementById('code-graph-btn')) return;
    const topNav = document.querySelector('nav[aria-label="Repository"]') ||
                   document.querySelector('.UnderlineNav-body') ||
                   document.querySelector('[data-pjax="#repo-content-pjax-container"]');
    if (!topNav) return;

    const btn = document.createElement('button');
    btn.id = 'code-graph-btn';
    btn.className = 'code-graph-trigger-btn';
    btn.setAttribute('aria-label', 'Open Code Graph');
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="2"/><circle cx="13" cy="3" r="2"/><circle cx="13" cy="13" r="2"/><line x1="5" y1="8" x2="11" y2="3.5" stroke="currentColor" stroke-width="1.5"/><line x1="5" y1="8" x2="11" y2="12.5" stroke="currentColor" stroke-width="1.5"/></svg> Code Graph`;
    btn.addEventListener('click', togglePanel);
    topNav.appendChild(btn);
  }

  function togglePanel() {
    if (dock) closePanel();
    else openPanel();
  }

  function openPanel() {
    if (dock) return;

    const info = parseRepoFromURL();
    if (!info) return;

    const width = clampWidth(loadWidth() ?? DEFAULT_WIDTH);

    dock = document.createElement('div');
    dock.id = 'code-graph-dock';
    dock.style.width = `${width}px`;

    const resizer = document.createElement('div');
    resizer.id = 'code-graph-resizer';
    resizer.title = 'Drag to resize';
    resizer.addEventListener('mousedown', startResize);

    iframe = document.createElement('iframe');
    iframe.id = 'code-graph-panel';
    iframe.src = chrome.runtime.getURL('panel/panel.html') +
      `?owner=${info.owner}&repo=${info.repo}&ref=HEAD`;
    iframe.addEventListener('load', pushLocation); // send current folder once ready

    dock.append(resizer, iframe);
    document.body.appendChild(dock);

    document.documentElement.classList.add('code-graph-docked');
    applyWidth(width);

    // Remember the panel is open so it survives a full page reload (e.g. if a
    // click triggers a hard navigation rather than GitHub's soft navigation).
    try { sessionStorage.setItem('codeGraphPanelOpen', '1'); } catch {}
  }

  function closePanel() {
    if (dock) dock.remove();
    dock = null;
    iframe = null;
    document.documentElement.classList.remove('code-graph-docked');
    document.documentElement.style.marginRight = '';
    try { sessionStorage.removeItem('codeGraphPanelOpen'); } catch {}
  }

  /**
   * Navigate the main GitHub tab to `url` while keeping the docked panel open.
   * Clicking a synthesized same-origin <a> lets GitHub's client-side router
   * (Turbo) do a soft navigation, which swaps the page content but leaves our
   * dock (a direct child of <body>) in place. If that falls through to a hard
   * navigation, the sessionStorage flag above re-opens the panel on reload.
   */
  function navigateMain(url) {
    try {
      const a = document.createElement('a');
      a.href = url;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      location.assign(url);
    }
  }

  // ── "Follow current folder" support ──────────────────────────────────────────
  /**
   * Derives the folder the user is currently viewing from the GitHub URL.
   *   /owner/repo                      → root  (path '')
   *   /owner/repo/tree/<ref>/<dir>     → that directory
   *   /owner/repo/blob/<ref>/<dir>/f   → the file's directory
   * Note: assumes a single-segment ref; branch names containing "/" aren't disambiguated.
   */
  function parseLocation() {
    const m = location.pathname.match(/^\/([^/]+)\/([^/]+)(?:\/(tree|blob)\/([^/]+)\/(.*))?$/);
    if (!m) return null;
    const [, owner, repo, kind, ref, rest = ''] = m;
    let path = '';
    if (kind === 'tree') path = decodeURIComponent(rest.replace(/[?#].*$/, ''));
    else if (kind === 'blob') {
      path = decodeURIComponent(rest.replace(/[?#].*$/, '')).split('/').slice(0, -1).join('/');
    }
    return { type: 'CODE_GRAPH_LOCATION', owner, repo, ref: ref || 'HEAD', path };
  }

  function pushLocation() {
    if (!iframe || !iframe.contentWindow) return;
    const loc = parseLocation();
    if (loc) iframe.contentWindow.postMessage(loc, EXT_ORIGIN);
  }

  // Messages from the panel iframe.
  window.addEventListener('message', e => {
    if (e.source !== iframe?.contentWindow) return;
    if (e.data?.type === 'CODE_GRAPH_REQUEST_LOCATION') {
      pushLocation();
    } else if (e.data?.type === 'CODE_GRAPH_NAVIGATE' && typeof e.data.url === 'string') {
      navigateMain(e.data.url);
    }
  });

  /** Reflow the page so the panel sits beside the content, not over it. */
  function applyWidth(width) {
    if (dock) dock.style.width = `${width}px`;
    document.documentElement.style.marginRight = `${width}px`;
  }

  function clampWidth(w) {
    return Math.max(MIN_WIDTH, Math.min(w, window.innerWidth - 100));
  }

  // ── Resizing ───────────────────────────────────────────────────────────────
  function startResize(e) {
    e.preventDefault();

    // Transparent overlay captures mousemove/up even while the cursor is over
    // the iframe (which would otherwise swallow the events).
    const overlay = document.createElement('div');
    overlay.id = 'code-graph-drag-overlay';

    document.documentElement.classList.add('code-graph-resizing');

    const onMove = ev => applyWidth(clampWidth(window.innerWidth - ev.clientX));
    const onUp = () => {
      overlay.remove();
      document.documentElement.classList.remove('code-graph-resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (dock) saveWidth(parseInt(dock.style.width, 10));
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.appendChild(overlay);
  }

  // ── Width persistence ────────────────────────────────────────────────────────
  function saveWidth(w) {
    try { localStorage.setItem('codeGraphPanelWidth', String(w)); } catch {}
  }
  function loadWidth() {
    try {
      const v = parseInt(localStorage.getItem('codeGraphPanelWidth'), 10);
      return Number.isFinite(v) ? v : null;
    } catch { return null; }
  }

  // Re-inject button on GitHub's SPA navigation, and notify the panel when the
  // URL changes so "follow folder" can track it.
  const observer = new MutationObserver(() => {
    if (isRepoPage()) injectButton();
    if (location.href !== lastHref) {
      lastHref = location.href;
      if (dock) pushLocation();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  if (isRepoPage()) {
    injectButton();
    // Re-open the panel after a full reload if it was open before navigating.
    let wasOpen = false;
    try { wasOpen = sessionStorage.getItem('codeGraphPanelOpen') === '1'; } catch {}
    if (wasOpen) openPanel();
  }
})();
