const GH_API = 'https://api.github.com';

/**
 * Returns the full recursive file tree for a repo via the Git Trees API.
 * Falls back to the Contents API for repos where the trees endpoint is
 * unavailable (e.g. empty repos or very large trees that exceed the API limit).
 */
export async function fetchRepoTree({ owner, repo, ref = 'HEAD', apiKey }) {
  const headers = buildHeaders(apiKey);

  // Resolve ref → SHA so we can use the trees endpoint
  const commitRes = await ghFetch(
    `${GH_API}/repos/${owner}/${repo}/commits/${ref}`,
    headers
  );
  const sha = commitRes.commit.tree.sha;

  const treeRes = await ghFetch(
    `${GH_API}/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    headers
  );

  if (treeRes.truncated) {
    console.warn('[code-graph] Tree truncated — large repos may show partial graphs');
  }

  return treeRes.tree.filter(node => node.type === 'blob');
}

export async function fetchFileContent({ owner, repo, ref, path, apiKey }) {
  const raw = await fetch(
    `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`,
    { headers: buildHeaders(apiKey) }
  );
  if (!raw.ok) throw new Error(`Failed to fetch ${path}: ${raw.status}`);
  return raw.text();
}

function buildHeaders(apiKey) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (apiKey) h['Authorization'] = `Bearer ${apiKey}`;
  return h;
}

async function ghFetch(url, headers) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API error ${res.status} for ${url}: ${body}`);
  }
  return res.json();
}
