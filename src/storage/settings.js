export function getStoredApiKey() {
  return new Promise(resolve => {
    chrome.storage.local.get('githubApiKey', ({ githubApiKey }) => {
      resolve(githubApiKey || null);
    });
  });
}
