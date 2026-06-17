// Popup toggle for the floating panel. Default: enabled.
const KEY = 'kdm.showPanel';
const cb = document.getElementById('panel');

chrome.storage.local.get(KEY, (r) => {
  cb.checked = r[KEY] !== false; // default on
});

cb.addEventListener('change', () => {
  chrome.storage.local.set({ [KEY]: cb.checked });
});
