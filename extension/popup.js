const exportBtn = document.getElementById('exportBtn');
const pauseBtn  = document.getElementById('pauseBtn');
const statusEl  = document.getElementById('status');
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
  } else {
    // Check if a scrape is already running
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ status: window.__pgScrapeStatus, paused: window.__pgPaused }),
    }).catch(() => null);
    const { status, paused } = results?.[0]?.result ?? {};
    if (status && status !== 'done') {
      // Resume the scrape UI
      exportBtn.disabled = true;
      pauseBtn.style.display = 'block';
      pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause';
      setStatus('<span class="spinner"></span>Scrape in progress…');
      pollUntilDone(tab.id);
    }
  }
}

// ── Pause / Resume ────────────────────────────────────────────────────────────

let currentTabId = null;

pauseBtn.addEventListener('click', async () => {
  if (!currentTabId) return;
  const results = await chrome.scripting.executeScript({
    target: { tabId: currentTabId },
    func: () => window.__pgPaused,
  });
  const isPaused = results?.[0]?.result;

  if (isPaused) {
    // Resume
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: () => { window.__pgPaused = false; },
    });
    pauseBtn.textContent = '⏸ Pause';
    setStatus('<span class="spinner"></span>Resuming…');
  } else {
    // Pause
    await chrome.scripting.executeScript({
      target: { tabId: currentTabId },
      func: () => { window.__pgPaused = true; },
    });
    pauseBtn.textContent = '▶ Resume';
    setStatus('⏸ Paused — click Resume to continue');
  }
});

// ── Poll until scrape done ────────────────────────────────────────────────────

async function pollUntilDone(tabId, timeoutMs = 300000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({
        status: window.__pgScrapeStatus,
        paused: window.__pgPaused,
        listings: window.__pgScrapedListings,
      }),
    }).catch(() => null);

    const { status, paused, listings } = results?.[0]?.result ?? {};
    if (status === 'done' && listings) return listings;

    if (paused) {
      // Keep showing paused state — don't overwrite the button text
    } else if (status?.startsWith('page-')) {
      const pg = status.split('-')[1];
      setStatus(`<span class="spinner"></span>Scraping page ${pg}…`);
    } else if (status?.startsWith('details-')) {
      const [, done, , total] = status.split('-');
      setStatus(`<span class="spinner"></span>Fetching listing details ${done}/${total}`);
    }

    await new Promise(r => setTimeout(r, 700));
  }
  // Timeout — return whatever we have
  const r = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__pgScrapedListings,
  }).catch(() => null);
  return r?.[0]?.result ?? [];
}

// ── Export button ─────────────────────────────────────────────────────────────

exportBtn.addEventListener('click', async () => {
  const tab = await getCurrentTab();
  currentTabId = tab.id;

  exportBtn.disabled = true;
  pauseBtn.style.display = 'block';
  pauseBtn.textContent = '⏸ Pause';
  setStatus('<span class="spinner"></span>Starting scrape…');

  try {
    // Reset state
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => { window.__pgScrapedListings = null; window.__pgScrapeStatus = null; window.__pgPaused = false; },
    });

    // Inject content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    }).catch(() => {});

    const listings = await pollUntilDone(tab.id);

    pauseBtn.style.display = 'none';

    if (!listings || listings.length === 0) {
      setStatus('No listings found. Make sure the page is fully loaded.', 'error');
      exportBtn.disabled = false;
      return;
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    downloadJSON({ exportedAt: new Date().toISOString(), count: listings.length, listings },
      `propertyguru-shortlist-${timestamp}.json`);
    setStatus(`✓ Exported ${listings.length} listing${listings.length !== 1 ? 's' : ''}`, 'success');
  } catch (err) {
    setStatus(`Error: ${err.message}`, 'error');
    pauseBtn.style.display = 'none';
  } finally {
    exportBtn.disabled = false;
  }
});

init();
