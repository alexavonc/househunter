const exportBtn = document.getElementById('exportBtn');
const statusEl = document.getElementById('status');
const warningEl = document.getElementById('warning');

const SHORTLIST_URL = 'propertyguru.com.sg/myactivities/shortlist';

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setStatus(msg, type = '') {
  statusEl.className = type;
  statusEl.innerHTML = msg;
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function init() {
  const tab = await getCurrentTab();
  if (!tab.url || !tab.url.includes(SHORTLIST_URL)) {
    warningEl.classList.add('visible');
    exportBtn.disabled = true;
  }
}

exportBtn.addEventListener('click', async () => {
  const tab = await getCurrentTab();

  exportBtn.disabled = true;
  setStatus('<span class="spinner"></span>Scraping listings…');

  try {
    // Inject the content script imperatively in case it hasn't run yet
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    }).catch(() => {
      // Already injected — ignore the error
    });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.__pgScrapedListings,
    });

    let listings = results?.[0]?.result;

    if (!listings || listings.length === 0) {
      // Try triggering a fresh scrape
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          window.__pgScrapedListings = null;
          window.dispatchEvent(new Event('pg:scrape'));
        },
      });

      // Wait briefly then retry
      await new Promise(r => setTimeout(r, 1500));

      const retryResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.__pgScrapedListings,
      });
      listings = retryResults?.[0]?.result;
    }

    if (!listings || listings.length === 0) {
      setStatus('No listings found. Make sure the shortlist page is fully loaded.', 'error');
      exportBtn.disabled = false;
      return;
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `propertyguru-shortlist-${timestamp}.json`;
    downloadJSON({ exportedAt: new Date().toISOString(), count: listings.length, listings }, filename);

    setStatus(`✓ Exported ${listings.length} listing${listings.length !== 1 ? 's' : ''}`, 'success');
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    console.error(err);
  } finally {
    exportBtn.disabled = false;
  }
});

init();
