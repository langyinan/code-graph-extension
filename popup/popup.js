const input = document.getElementById('api-key-input');
const saveBtn = document.getElementById('save-btn');
const saveStatus = document.getElementById('save-status');

chrome.storage.local.get('githubApiKey', ({ githubApiKey }) => {
  if (githubApiKey) input.value = githubApiKey;
});

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set({ githubApiKey: input.value.trim() }, () => {
    saveStatus.textContent = 'Saved!';
    setTimeout(() => (saveStatus.textContent = ''), 2000);
  });
});
