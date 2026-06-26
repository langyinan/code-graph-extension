/**
 * Local test: generates a Mermaid graph for a GitHub repo and opens it in the browser.
 *
 * Usage:
 *   node test/generate.mjs [owner/repo] [ref]
 *
 * Environment:
 *   GITHUB_TOKEN  — optional, avoids rate-limiting on large repos
 *
 * Examples:
 *   node test/generate.mjs
 *   node test/generate.mjs langyinan/code-graph-extension
 *   GITHUB_TOKEN=ghp_xxx node test/generate.mjs facebook/react
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── CLI args ─────────────────────────────────────────────────────────────────
const [, , repoArg = 'langyinan/code-graph-extension', refArg = 'HEAD', modeArg = 'imports', detailArg = 'medium'] = process.argv;
const [owner, repo] = repoArg.split('/');
const ref = refArg;
const mode = modeArg;     // 'imports' | 'calls'
const detail = detailArg; // 'low' | 'medium' | 'high'
const apiKey = process.env.GITHUB_TOKEN || null;

if (!owner || !repo) {
  console.error('Usage: node test/generate.mjs [owner/repo] [ref] [imports|calls] [low|medium|high]');
  process.exit(1);
}

// ── Import core modules (no chrome APIs required) ────────────────────────────
const { fetchRepoTree } = await import('../src/github/fetchTree.js');
const { buildGraph }    = await import('../src/graph/buildGraph.js');

console.log(`\n[code-graph] Fetching tree for ${owner}/${repo}@${ref} …`);
const tree = await fetchRepoTree({ owner, repo, ref, apiKey });
console.log(`[code-graph] Tree: ${tree.length} blobs`);

let done = 0;
const graph = await buildGraph({
  tree, owner, repo, ref,
  path: undefined,   // whole repo
  mode,
  detail,
  apiKey,
  onProgress(d, total) {
    done = d;
    process.stdout.write(`\r[code-graph] Reading files… ${d}/${total}   `);
  },
});
console.log(`\n[code-graph] Done — ${graph.stats().nodes} nodes, ${graph.stats().edges} edges`);

const linkBase = `https://github.com/${owner}/${repo}/blob/${ref}/`;
const linkBaseDir = `https://github.com/${owner}/${repo}/tree/${ref}/`;
const { mermaid: mermaidSrc, edgeLinks } = graph.toMermaid({ linkBase, linkBaseDir });

// ── Write standalone HTML viewer ─────────────────────────────────────────────
// Relative, forward-slashed path so it loads reliably under file://
const mermaidVendor = '../vendor/mermaid.min.js';
const outPath = resolve(__dir, 'output.html');

const html = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Code Graph — ${owner}/${repo}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #f6f8fa; }
    header { padding: 12px 20px; background: #24292f; color: #fff; display: flex; align-items: center; gap: 12px; }
    header h1 { font-size: 15px; font-weight: 600; margin: 0; }
    #stats { font-size: 12px; color: #adb5bd; }
    #graph { padding: 20px; overflow: auto; min-height: 300px; }
    #graph svg { max-width: none; height: auto; }
    pre { background: #fff; border: 1px solid #d0d7de; border-radius: 6px; padding: 16px; font-size: 12px; overflow: auto; white-space: pre-wrap; }
    #toggle { margin: 0 20px 10px; background: none; border: 1px solid #d0d7de; border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
    #err { color: #cf222e; padding: 0 20px; font-family: monospace; white-space: pre-wrap; }
  </style>
</head>
<body>
  <header>
    <h1>Code Graph — ${owner}/${repo}</h1>
    <span id="stats">${graph.stats().nodes} nodes · ${graph.stats().edges} edges · ${ref}</span>
  </header>
  <div id="graph"><div id="diagram"></div></div>
  <div id="err"></div>
  <button id="toggle" onclick="document.getElementById('src').style.display=document.getElementById('src').style.display==='none'?'block':'none'">Toggle source</button>
  <pre id="src" style="display:none;margin:0 20px 20px">${mermaidSrc.replace(/</g, '&lt;')}</pre>
  <script src="${mermaidVendor}"></script>
  <script>
    // Source is embedded as a JSON string to avoid any HTML/quote escaping issues.
    const source = ${JSON.stringify(mermaidSrc)};
    const edgeLinks = ${JSON.stringify(edgeLinks)};
    mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose', maxTextSize: 500000 });
    (async () => {
      try {
        const { svg } = await mermaid.render('codeGraph', source);
        const diagram = document.getElementById('diagram');
        diagram.innerHTML = svg;
        diagram.querySelectorAll('[data-id^="L_"]').forEach(el => {
          const href = edgeLinks[el.getAttribute('data-id')];
          if (!href) return;
          el.style.cursor = 'pointer';
          el.addEventListener('click', () => window.open(href, '_blank'));
        });
      } catch (e) {
        document.getElementById('err').textContent = 'Mermaid render error: ' + (e && e.message ? e.message : e);
        console.error(e);
      }
    })();
  </script>
</body>
</html>`;

writeFileSync(outPath, html, 'utf8');
console.log(`[code-graph] Wrote ${outPath}`);

// Also write a Markdown file for VS Code Mermaid preview
const mdPath = resolve(__dir, 'output.md');
const md = `# Code Graph — ${owner}/${repo}\n\n_${graph.stats().nodes} nodes · ${graph.stats().edges} edges · ${ref}_\n\n\`\`\`mermaid\n${mermaidSrc}\n\`\`\`\n`;
writeFileSync(mdPath, md, 'utf8');
console.log(`[code-graph] Wrote ${mdPath}`);

// Open the Markdown file in VS Code
try {
  execSync(`code --reuse-window "${mdPath}"`);
  console.log('[code-graph] Opened in VS Code — use Ctrl+Shift+V to preview.');
} catch {
  console.log('[code-graph] Open manually in VS Code:', mdPath);
}
