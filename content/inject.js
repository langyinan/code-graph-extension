/**
 * Injected into every github.com page.
 * Detects repo pages, injects the "Code Graph" button into the nav,
 * and launches the panel iframe on click.
 */

(function () {
  'use strict';

  let panelIframe = null;

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
    if (panelIframe) {
      panelIframe.remove();
      panelIframe = null;
      return;
    }

    const info = parseRepoFromURL();
    if (!info) return;

    panelIframe = document.createElement('iframe');
    panelIframe.id = 'code-graph-panel';
    panelIframe.src = chrome.runtime.getURL('panel/panel.html') +
      `?owner=${info.owner}&repo=${info.repo}&ref=HEAD`;
    document.body.appendChild(panelIframe);
  }

  // Re-inject button on GitHub's SPA navigation
  const observer = new MutationObserver(() => {
    if (isRepoPage()) injectButton();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  if (isRepoPage()) injectButton();
})();
