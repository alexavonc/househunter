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

// Poll until the content script signals it's done (or timeout)
async function waitForScrape(tabId, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({ status: window.__pgScrapeStatus, listings: window.__pgScrapedListings }),
    });
    const { status, listings } = results?.[0]?.result ?? {};
    if (status === 'done' && Array.isArray(listings)) return listings;
    await new Promise(r => setTimeout(r, 600));
  }
  // Timeout — return whatever we have
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__pgScrapedListings,
  });
  return results?.[0]?.result ?? [];
}

exportBtn.addEventListener('click', async () => {
  const tab = await getCurrentTab();

  exportBtn.disabled = true;
  setStatus('<span class="spinner"></span>Scraping all pages…');

  try {
    // Reset state and re-trigger a fresh scrape
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        window.__pgScrapedListings = null;
        window.__pgScrapeStatus = null;
      },
    });

    // Inject content script (idempotent — ignore error if already injected)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    }).catch(() => {});

    // Trigger scrape and wait for completion
    const listings = await waitForScrape(tab.id, 60000);

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
