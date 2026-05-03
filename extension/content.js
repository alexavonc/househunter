/**
 * PropertyGuru Shortlist scraper — content script.
 *
 * Pagination strategy (tried in order):
 * 1. Fetch-based: GET page=2,3,… as HTML and parse with DOMParser (works if SSR)
 * 2. Click-through: find the Next button, click it, wait for DOM update, repeat (works for SPA)
 */

(function () {
  'use strict';

  // ── Selector helpers ─────────────────────────────────────────────────────
  function first(el, ...selectors) {
    for (const sel of selectors) {
      const node = el.querySelector(sel);
      if (node) return node;
    }
    return null;
  }

  function text(node) {
    return node ? node.textContent.trim().replace(/\s+/g, ' ') : null;
  }

  function attr(node, a) {
    return node ? node.getAttribute(a) : null;
  }

  // ── Text-content leaf search — finds a leaf element whose text matches re ──
  function findByText(card, re) {
    for (const el of card.querySelectorAll('*')) {
      if (el.children.length === 0 && re.test(el.textContent.trim())) return el;
    }
    return null;
  }

  // ── Parse a single card element ──────────────────────────────────────────
  function parseCard(card) {
    // Title: try known selectors, then any heading, then first property-page link
    let titleNode = first(card,
      '[data-automation-id="listing-card-title"]',
      '[data-automation-id="listing-card-title"] a',
      '[data-automation-id="listing-name"]',
      '[data-automation-id="listing-name"] a',
      '.listing-title a', '.listing-card-title a',
      'h3.listing-name a', 'h4.listing-name a',
      'h2 a', 'h3 a', 'h4 a',
      'h2', 'h3', 'h4',
      '.listing-title', '.listing-card-title',
      '[class*="listingName"]', '[class*="ListingName"]',
      '[class*="title"]:not(head):not(button)',
    );
    // Last resort: first anchor that links to a property page and has real text
    if (!titleNode) {
      for (const a of card.querySelectorAll('a[href]')) {
        const t = a.textContent.trim();
        const href = a.getAttribute('href') || '';
        if (t.length > 2 && !a.querySelector('img') &&
            (href.includes('/property-for-') || href.includes('/listing/'))) {
          titleNode = a;
          break;
        }
      }
    }
    // Broadest fallback: first anchor with non-trivial text that isn't a UI label
    if (!titleNode) {
      for (const a of card.querySelectorAll('a[href]')) {
        const t = a.textContent.trim();
        if (t.length > 3 && !a.querySelector('img') && !/^(view|see|more|details|enquire|contact|shortlist|save)/i.test(t)) {
          titleNode = a;
          break;
        }
      }
    }
    const title = text(titleNode);

    let url = attr(titleNode, 'href') ||
              attr(first(card, 'a[href*="/property-for-"]'), 'href') ||
              attr(first(card, 'a[href*="/listing/"]'), 'href');
    if (url && !url.startsWith('http')) url = 'https://www.propertyguru.com.sg' + url;

    const priceNode = first(card,
      '[data-automation-id="listing-card-price"]',
      '.price span', '.price', '.listing-price',
      '[class*="price"]:not([class*="psf"])',
    );
    const price = text(priceNode);

    // Price-per-sqft: try selectors, then text containing "psf"
    let psfNode = first(card,
      '[data-automation-id="listing-card-psf"]',
      '.price-psf', '[class*="psf"]',
    );
    if (!psfNode) psfNode = findByText(card, /psf/i);
    const pricePerSqft = text(psfNode);

    // Size: try selectors, then text containing "sqft" or "sq ft"
    let sizeNode = first(card,
      '[data-automation-id="listing-floor-area"]',
      '[data-automation-id="listing-card-floor-area"]',
      '[data-automation-id="floorArea"]',
      '.listing-floor-area', '[class*="floor-area"]', '[class*="floorArea"]',
      '[class*="sqft"]', '[class*="area"]',
    );
    if (!sizeNode) sizeNode = findByText(card, /\d[\d,]*\s*sqft/i);
    const size = text(sizeNode);

    const addressNode = first(card,
      '[data-automation-id="listing-card-address"]',
      '.listing-location', '.listing-address',
      '[class*="location"]', '[class*="address"]',
    );
    const address = text(addressNode);

    const bedNode = first(card,
      '[data-automation-id="listing-card-bedroom"]',
      '[data-automation-id="listing-rooms"] span:first-child',
      '.listing-rooms span:first-child', '[class*="bedroom"]',
    );
    const bedrooms = text(bedNode);

    const bathNode = first(card,
      '[data-automation-id="listing-card-bathroom"]',
      '[data-automation-id="listing-rooms"] span:nth-child(2)',
      '.listing-rooms span:nth-child(2)', '[class*="bathroom"]',
    );
    const bathrooms = text(bathNode);

    const mrtNode = first(card,
      '[data-automation-id="listing-mrt"]',
      '.listing-mrt', '[class*="mrt"]', '[class*="MRT"]',
    );
    const mrtInfo = text(mrtNode);

    const listingId = card.dataset.listingId || card.dataset.id || attr(card, 'id') || null;

    // Image: prefer data-src (lazy-loaded) over src to avoid blank placeholders
    const imgNode = card.querySelector('img[data-src], img[data-original], img[src]');
    let imageUrl = null;
    if (imgNode) {
      const candidate = imgNode.getAttribute('data-src') ||
                        imgNode.getAttribute('data-original') ||
                        imgNode.getAttribute('src');
      if (candidate && !candidate.includes('1x1') && !candidate.includes('blank') &&
          !candidate.startsWith('data:') && !candidate.endsWith('.svg')) {
        imageUrl = candidate.startsWith('http') ? candidate
          : 'https://www.propertyguru.com.sg' + candidate;
      }
    }

    return { listingId, title, url, imageUrl, price, pricePerSqft, size, address, bedrooms, bathrooms, mrtInfo };
  }

  // ── Find listing cards in any document ───────────────────────────────────
  function findCards(doc) {
    const selectors = [
      '[data-listing-id]',
      '.listing-card',
      '[class*="ListingCard"]',
      '[class*="listing-card"]',
      'li[class*="listing"]',
      '.listing-item',
    ];
    for (const sel of selectors) {
      const cards = [...doc.querySelectorAll(sel)];
      if (cards.length > 0) return cards;
    }
    return [];
  }

  // ── Build paginated URL ───────────────────────────────────────────────────
  function pageUrl(n) {
    const u = new URL(window.location.href);
    u.searchParams.set('page', n);
    return u.toString();
  }

  // ── Fetch a page as parsed HTML ───────────────────────────────────────────
  async function fetchPage(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new DOMParser().parseFromString(await res.text(), 'text/html');
  }

  // ── Strategy 1: fetch-based pagination ───────────────────────────────────
  async function scrapeViaFetch(seenKeys, allListings) {
    // Probe page 2 — if it yields cards, the page is SSR and this strategy works
    let probePage;
    try { probePage = await fetchPage(pageUrl(2)); } catch { return false; }
    const probeCards = findCards(probePage);
    if (probeCards.length === 0) return false; // CSR — fetch returns empty shell

    // Collect page 2 results
    addCards(probeCards, seenKeys, allListings);
    window.__pgScrapeStatus = 'page-2';

    // Continue from page 3 onward
    for (let pg = 3; pg <= 50; pg++) {
      try {
        const doc = await fetchPage(pageUrl(pg));
        const cards = findCards(doc);
        if (cards.length === 0) break;
        const added = addCards(cards, seenKeys, allListings);
        if (added === 0) break; // all duplicates → done
        window.__pgScrapeStatus = `page-${pg}`;
      } catch {
        break;
      }
    }
    return true;
  }

  // ── Strategy 2: click-through pagination (SPA) ───────────────────────────
  function findNextBtn() {
    // Attribute-based
    const explicit = document.querySelector(
      '[data-automation-id="pagination-next"], ' +
      'a[rel="next"], ' +
      'a[aria-label="Next page"], a[aria-label="Next"], ' +
      'button[aria-label="Next page"], button[aria-label="Next"]'
    );
    if (explicit && !explicit.disabled && explicit.offsetParent !== null) return explicit;

    // Text/symbol-based inside pagination containers
    const containers = document.querySelectorAll(
      '.pagination, [class*="pagination"], nav[aria-label*="page" i]'
    );
    for (const container of containers) {
      const links = [...container.querySelectorAll('a, button')];
      for (const el of links) {
        const t = el.textContent.trim();
        if (/^(next|›|»|>|→)$/i.test(t) && !el.disabled && el.offsetParent !== null) {
          return el;
        }
      }
    }
    return null;
  }

  async function waitForNewCards(prevCount, timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 300));
      if (findCards(document).length !== prevCount) return true;
    }
    return false; // timed out — cards didn't change
  }

  async function scrapeViaClicks(seenKeys, allListings) {
    let page = 1;
    while (page <= 50) {
      const nextBtn = findNextBtn();
      if (!nextBtn) break;

      const prevCount = findCards(document).length;
      const prevTotal = allListings.length;

      nextBtn.click();
      page++;
      window.__pgScrapeStatus = `page-${page}`;

      // Wait up to 4 s for new cards to appear
      await waitForNewCards(prevCount);
      // Extra buffer for slow renders
      await new Promise(r => setTimeout(r, 800));

      const added = addCards(findCards(document), seenKeys, allListings);
      if (added === 0 && allListings.length === prevTotal) break; // nothing new
    }
  }

  // ── Deduplicating card collector ─────────────────────────────────────────
  function addCards(cards, seenKeys, out) {
    let added = 0;
    for (const card of cards) {
      const l = parseCard(card);
      const key = l.url || l.title || JSON.stringify(l);
      if (key && !seenKeys.has(key)) {
        seenKeys.add(key);
        out.push(l);
        added++;
      }
    }
    return added;
  }

  // ── Main ─────────────────────────────────────────────────────────────────
  async function scrape() {
    window.__pgScrapeStatus = 'running';
    window.__pgScrapedListings = null;

    const seenKeys = new Set();
    const allListings = [];

    // Always collect what's already on screen (page 1)
    addCards(findCards(document), seenKeys, allListings);
    window.__pgScrapeStatus = 'page-1';

    // Try fetch-based first; if the page is CSR fall back to click-through
    const fetchWorked = await scrapeViaFetch(seenKeys, allListings);
    if (!fetchWorked) {
      await scrapeViaClicks(seenKeys, allListings);
    }

    const listings = allListings.filter(l => l.title || l.price || l.url);
    window.__pgScrapedListings = listings;
    window.__pgScrapeStatus = 'done';
    return listings;
  }

  scrape();
  window.addEventListener('pg:scrape', () => scrape());
})();
