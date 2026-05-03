/**
 * PropertyGuru Shortlist scraper — content script.
 *
 * Phase 1: Collect all listing cards across all pages (fetch-based or click-through).
 * Phase 2: Fetch each individual listing's detail page (in batches of 3) to get
 *          the real title, size, psf, and MRT distance info from PropertyGuru directly.
 */

(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────────────
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

  function findByText(el, re) {
    for (const node of el.querySelectorAll('*')) {
      if (node.children.length === 0 && re.test(node.textContent.trim())) return node;
    }
    return null;
  }

  // ── Parse a shortlist card (basic info only) ─────────────────────────────
  function parseCard(card) {
    // URL — most important, used to fetch detail page
    const linkNode = first(card,
      'a[href*="/property-for-"]',
      'a[href*="/listing/"]',
      'a[href]',
    );
    let url = attr(linkNode, 'href');
    if (url && !url.startsWith('http')) url = 'https://www.propertyguru.com.sg' + url;

    // Price
    const priceNode = first(card,
      '[data-automation-id="listing-card-price"]',
      '.price span', '.price', '.listing-price',
      '[class*="price"]:not([class*="psf"])',
    );
    const price = text(priceNode);

    // Address
    const addressNode = first(card,
      '[data-automation-id="listing-card-address"]',
      '.listing-location', '.listing-address',
      '[class*="location"]', '[class*="address"]',
    );
    const address = text(addressNode);

    // Beds / baths
    const bedNode = first(card,
      '[data-automation-id="listing-card-bedroom"]',
      '.listing-rooms span:first-child', '[class*="bedroom"]',
    );
    const bathNode = first(card,
      '[data-automation-id="listing-card-bathroom"]',
      '.listing-rooms span:nth-child(2)', '[class*="bathroom"]',
    );

    // Image
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

    const listingId = card.dataset.listingId || card.dataset.id || attr(card, 'id') || null;

    return {
      listingId,
      url,
      imageUrl,
      price,
      address,
      bedrooms: text(bedNode),
      bathrooms: text(bathNode),
      // These are filled in Phase 2 from the detail page:
      title: null,
      pricePerSqft: null,
      size: null,
      mrtInfo: null,
    };
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

  // ── Detail page scraper ───────────────────────────────────────────────────
  async function fetchDetail(url) {
    if (!url) return null;
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return null;
      const doc = new DOMParser().parseFromString(await res.text(), 'text/html');

      // Title / project name
      const titleNode = first(doc,
        'h1[class*="title" i]',
        'h1[class*="name" i]',
        '[data-automation-id="listing-name"]',
        '[data-automation-id="listing-title"]',
        '.project-name', '.listing-name',
        'h1',
      );
      const title = text(titleNode);

      // Size — look for text containing "sqft"
      const sizeNode = first(doc,
        '[data-automation-id="listing-floor-area"]',
        '[data-automation-id="listing-sqft"]',
        '[class*="floor-area"]', '[class*="floorArea"]', '[class*="sqft"]',
      ) || findByText(doc, /\d[\d,]*\s*sqft/i);
      // Extract just the number+sqft part (the node might have extra text)
      let size = null;
      if (sizeNode) {
        const m = sizeNode.textContent.match(/[\d,]+\s*sqft/i);
        size = m ? m[0].trim() : text(sizeNode);
      }

      // Price per sqft
      const psfNode = first(doc,
        '[data-automation-id="listing-card-psf"]',
        '[data-automation-id="listing-psf"]',
        '.price-psf', '[class*="psf"]',
      ) || findByText(doc, /psf/i);
      const pricePerSqft = text(psfNode);

      // MRT info — PropertyGuru shows e.g. "180 m (2 mins) from NE16/STC Sengkang MRT"
      const mrtNode = first(doc,
        '[data-automation-id="listing-mrt"]',
        '.listing-mrt', '[class*="mrt"]',
      ) || findByText(doc, /\d+\s*m.*MRT/i) || findByText(doc, /from.*MRT/i);
      const mrtInfo = text(mrtNode);

      return { title, size, pricePerSqft, mrtInfo };
    } catch {
      return null;
    }
  }

  // ── Phase 2: enrich listings with detail page data ───────────────────────
  async function enrichListings(listings) {
    const BATCH = 3;
    for (let i = 0; i < listings.length; i += BATCH) {
      const batch = listings.slice(i, i + BATCH);
      const details = await Promise.all(batch.map(l => fetchDetail(l.url)));
      details.forEach((d, j) => {
        if (d) Object.assign(listings[i + j], d);
      });
      window.__pgScrapeStatus = `details-${Math.min(i + BATCH, listings.length)}-of-${listings.length}`;
      if (i + BATCH < listings.length) await new Promise(r => setTimeout(r, 300));
    }
  }

  // ── Deduplicating collector ───────────────────────────────────────────────
  function addCards(cards, seen, out) {
    let added = 0;
    for (const card of cards) {
      const l = parseCard(card);
      const key = l.url || l.price + l.address;
      if (key && !seen.has(key)) { seen.add(key); out.push(l); added++; }
    }
    return added;
  }

  // ── Page URL builder ─────────────────────────────────────────────────────
  function pageUrl(n) {
    const u = new URL(window.location.href);
    u.searchParams.set('page', n);
    return u.toString();
  }

  async function fetchPage(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return new DOMParser().parseFromString(await res.text(), 'text/html');
  }

  // ── Strategy 1: fetch-based pagination ───────────────────────────────────
  async function scrapeViaFetch(seen, out) {
    let probePage;
    try { probePage = await fetchPage(pageUrl(2)); } catch { return false; }
    const probeCards = findCards(probePage);
    if (probeCards.length === 0) return false;

    addCards(probeCards, seen, out);
    window.__pgScrapeStatus = 'page-2';

    for (let pg = 3; pg <= 50; pg++) {
      try {
        const doc = await fetchPage(pageUrl(pg));
        const cards = findCards(doc);
        if (cards.length === 0) break;
        if (addCards(cards, seen, out) === 0) break;
        window.__pgScrapeStatus = `page-${pg}`;
      } catch { break; }
    }
    return true;
  }

  // ── Strategy 2: click-through pagination ─────────────────────────────────
  function findNextBtn() {
    const explicit = document.querySelector(
      '[data-automation-id="pagination-next"], a[rel="next"], ' +
      'a[aria-label="Next page"], a[aria-label="Next"], ' +
      'button[aria-label="Next page"], button[aria-label="Next"]'
    );
    if (explicit && !explicit.disabled && explicit.offsetParent !== null) return explicit;

    for (const container of document.querySelectorAll('.pagination, [class*="pagination"], nav[aria-label*="page" i]')) {
      for (const el of container.querySelectorAll('a, button')) {
        const t = el.textContent.trim();
        if (/^(next|›|»|>|→)$/i.test(t) && !el.disabled && el.offsetParent !== null) return el;
      }
    }
    return null;
  }

  async function scrapeViaClicks(seen, out) {
    let page = 1;
    while (page <= 50) {
      const nextBtn = findNextBtn();
      if (!nextBtn) break;
      const prevCount = findCards(document).length;
      nextBtn.click();
      page++;
      window.__pgScrapeStatus = `page-${page}`;
      const start = Date.now();
      while (Date.now() - start < 4000 && findCards(document).length === prevCount) {
        await new Promise(r => setTimeout(r, 300));
      }
      await new Promise(r => setTimeout(r, 800));
      if (addCards(findCards(document), seen, out) === 0) break;
    }
  }

  // ── Main ─────────────────────────────────────────────────────────────────
  async function scrape() {
    window.__pgScrapeStatus = 'running';
    window.__pgScrapedListings = null;

    const seen = new Set();
    const listings = [];

    // Phase 1: collect cards across all pages
    addCards(findCards(document), seen, listings);
    window.__pgScrapeStatus = 'page-1';

    const fetchWorked = await scrapeViaFetch(seen, listings);
    if (!fetchWorked) await scrapeViaClicks(seen, listings);

    // Phase 2: enrich each listing from its detail page
    window.__pgScrapeStatus = `details-0-of-${listings.length}`;
    await enrichListings(listings);

    const result = listings.filter(l => l.url || l.price);
    window.__pgScrapedListings = result;
    window.__pgScrapeStatus = 'done';
    return result;
  }

  scrape();
  window.addEventListener('pg:scrape', () => scrape());
})();
