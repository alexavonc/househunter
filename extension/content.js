/**
 * PropertyGuru Shortlist scraper — content script.
 *
 * Handles traditional page-number pagination by fetching each subsequent
 * page as HTML, parsing it with DOMParser, and combining all results.
 * Also falls back to clicking a "Load More" button if pagination is absent.
 */

(function () {
  'use strict';

  // ── Selector fallback helper ─────────────────────────────────────────────
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

  // ── Parse a single card element ──────────────────────────────────────────
  function parseCard(card) {
    const titleNode = first(card,
      '.listing-title a',
      'h3.listing-name a',
      '[data-automation-id="listing-name"] a',
      'h3 a',
      '.listing-title',
    );
    const title = text(titleNode);

    let url = attr(titleNode, 'href') || attr(first(card, 'a[href*="/property-for-"]'), 'href');
    if (url && !url.startsWith('http')) {
      url = 'https://www.propertyguru.com.sg' + url;
    }

    const priceNode = first(card,
      '[data-automation-id="listing-card-price"]',
      '.price span',
      '.price',
      '.listing-price',
      '[class*="price"]:not([class*="psf"])',
    );
    const price = text(priceNode);

    const psfNode = first(card,
      '[data-automation-id="listing-card-psf"]',
      '.price-psf',
      '[class*="psf"]',
    );
    const pricePerSqft = text(psfNode);

    const sizeNode = first(card,
      '[data-automation-id="listing-floor-area"]',
      '[data-automation-id="listing-card-floor-area"]',
      '.listing-floor-area',
      '[class*="floor-area"]',
      '[class*="floorArea"]',
    );
    const size = text(sizeNode);

    const addressNode = first(card,
      '[data-automation-id="listing-card-address"]',
      '.listing-location',
      '.listing-address',
      '[class*="location"]',
      '[class*="address"]',
    );
    const address = text(addressNode);

    const bedNode = first(card,
      '[data-automation-id="listing-card-bedroom"]',
      '[data-automation-id="listing-rooms"] span:first-child',
      '.listing-rooms span:first-child',
      '[class*="bedroom"]',
    );
    const bedrooms = text(bedNode);

    const bathNode = first(card,
      '[data-automation-id="listing-card-bathroom"]',
      '[data-automation-id="listing-rooms"] span:nth-child(2)',
      '.listing-rooms span:nth-child(2)',
      '[class*="bathroom"]',
    );
    const bathrooms = text(bathNode);

    const mrtNode = first(card,
      '[data-automation-id="listing-mrt"]',
      '.listing-mrt',
      '[class*="mrt"]',
      '[class*="MRT"]',
    );
    const mrtInfo = text(mrtNode);

    const listingId = card.dataset.listingId || card.dataset.id || attr(card, 'id') || null;

    return { listingId, title, url, price, pricePerSqft, size, address, bedrooms, bathrooms, mrtInfo };
  }

  // ── Find all listing cards in a document (current page or fetched HTML) ──
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

  // ── Detect total page count from pagination controls ─────────────────────
  function detectTotalPages(doc) {
    // Look for pagination links like ?page=N or page number buttons
    const paginationSelectors = [
      '[data-automation-id="pagination"]',
      '.pagination',
      '[class*="pagination"]',
      'nav[aria-label*="pagination" i]',
    ];

    for (const sel of paginationSelectors) {
      const nav = doc.querySelector(sel);
      if (!nav) continue;

      // Grab all links/buttons with a page number
      const items = [...nav.querySelectorAll('a, button, span')];
      let max = 1;
      for (const item of items) {
        const n = parseInt(item.textContent.trim(), 10);
        if (!isNaN(n) && n > max) max = n;
        // Also check href for ?page=N
        const href = item.getAttribute('href') || '';
        const m = href.match(/[?&]page=(\d+)/i);
        if (m) {
          const pg = parseInt(m[1], 10);
          if (pg > max) max = pg;
        }
      }
      if (max > 1) return max;
    }
    return 1;
  }

  // ── Build a page URL from the current URL + page number ──────────────────
  function pageUrl(pageNum) {
    const url = new URL(window.location.href);
    url.searchParams.set('page', pageNum);
    return url.toString();
  }

  // ── Fetch a page and return its parsed document ───────────────────────────
  async function fetchPage(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const html = await res.text();
    return new DOMParser().parseFromString(html, 'text/html');
  }

  // ── Fallback: click "Load More" button if no pagination found ────────────
  async function clickLoadMore() {
    const loadMoreSelectors = [
      'button[data-automation-id="load-more"]',
      'button.load-more',
      'a.load-more',
      '[class*="load-more"]',
      'button[class*="loadMore"]',
    ];
    let clicked = 0;
    while (true) {
      let btn = null;
      for (const sel of loadMoreSelectors) {
        btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) break;
        btn = null;
      }
      if (!btn) break;
      const prevCount = findCards(document).length;
      btn.click();
      await new Promise(r => setTimeout(r, 2000));
      const newCount = findCards(document).length;
      clicked++;
      if (newCount <= prevCount || clicked > 20) break;
    }
  }

  // ── Main scrape function ─────────────────────────────────────────────────
  async function scrape() {
    window.__pgScrapeStatus = 'running';

    // Scrape current page first
    const totalPages = detectTotalPages(document);
    const page1Cards = findCards(document);
    const allListings = page1Cards.map(parseCard);

    if (totalPages > 1) {
      // Fetch remaining pages in sequence
      for (let pg = 2; pg <= totalPages; pg++) {
        try {
          const doc = await fetchPage(pageUrl(pg));
          const cards = findCards(doc);
          if (cards.length === 0) break; // no more listings
          cards.map(parseCard).forEach(l => allListings.push(l));
        } catch (e) {
          console.warn('[PG Scraper] Failed to fetch page', pg, e);
          break;
        }
      }
    } else {
      // No pagination detected — try load-more button
      await clickLoadMore();
      // Re-scrape in case new cards appeared
      const updatedCards = findCards(document);
      if (updatedCards.length > allListings.length) {
        allListings.length = 0;
        updatedCards.map(parseCard).forEach(l => allListings.push(l));
      }
    }

    const listings = allListings.filter(l => l.title || l.price || l.url);
    window.__pgScrapedListings = listings;
    window.__pgScrapeStatus = 'done';
    return listings;
  }

  scrape();
  window.addEventListener('pg:scrape', () => scrape());
})();
