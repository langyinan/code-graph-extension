export function getStoredApiKey() {
  return new Promise(resolve => {
    chrome.storage.local.get('githubApiKey', ({ githubApiKey }) => {
      resolve(githubApiKey || null);
    });
  });
}

// Panel UI preferences (theme, edge style, toggles, …) persisted under a single
// key so they survive reloads.
const PREFS_KEY = 'panelPrefs';

export function getStoredPrefs() {
  return new Promise(resolve => {
    chrome.storage.local.get(PREFS_KEY, result => {
      resolve(result[PREFS_KEY] || {});
    });
  });
}

export function setStoredPrefs(prefs) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [PREFS_KEY]: prefs }, resolve);
  });
}
