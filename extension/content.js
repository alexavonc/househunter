/**
 * PropertyGuru Shortlist scraper — content script.
 *
 * PropertyGuru renders listing cards with these key selectors (as of 2024-25):
 *   Listing card wrapper : .listing-card  OR  [data-listing-id]
 *   Project / title      : .listing-title a, h3.listing-name a
 *   Price                : .price, .listing-price span
 *   Price per sqft       : .price-psf, [data-automation-id="listing-card-psf"]
 *   Size                 : .listing-floor-area, [data-automation-id="listing-floor-area"]
 *   Address              : .listing-location, .listing-address
 *   Beds                 : [data-automation-id="listing-card-bedroom"], .listing-rooms span:first-child
 *   Baths                : [data-automation-id="listing-card-bathroom"], .listing-rooms span:nth-child(2)
 *   MRT                  : .listing-mrt, [data-automation-id="listing-mrt"]
 *   Listing URL          : .listing-title a[href], h3.listing-name a[href]
 *
 * Because the DOM may change, we cascade through multiple selector candidates.
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
    // Title / project name
    const titleNode = first(card,
      '.listing-title a',
      'h3.listing-name a',
      '[data-automation-id="listing-name"] a',
      'h3 a',
      '.listing-title',
    );
    const title = text(titleNode);

    // Listing URL
    let url = attr(titleNode, 'href') || attr(first(card, 'a[href*="/property-for-"]'), 'href');
    if (url && !url.startsWith('http')) {
      url = 'https://www.propertyguru.com.sg' + url;
    }

    // Price
    const priceNode = first(card,
      '[data-automation-id="listing-card-price"]',
      '.price span',
      '.price',
      '.listing-price',
      '[class*="price"]:not([class*="psf"])',
    );
    const price = text(priceNode);

    // Price per sqft
    const psfNode = first(card,
      '[data-automation-id="listing-card-psf"]',
      '.price-psf',
      '[class*="psf"]',
    );
    const pricePerSqft = text(psfNode);

    // Size / floor area
    const sizeNode = first(card,
      '[data-automation-id="listing-floor-area"]',
      '[data-automation-id="listing-card-floor-area"]',
      '.listing-floor-area',
      '[class*="floor-area"]',
      '[class*="floorArea"]',
    );
    const size = text(sizeNode);

    // Address / district
    const addressNode = first(card,
      '[data-automation-id="listing-card-address"]',
      '.listing-location',
      '.listing-address',
      '[class*="location"]',
      '[class*="address"]',
    );
    const address = text(addressNode);

    // Bedrooms
    const bedNode = first(card,
      '[data-automation-id="listing-card-bedroom"]',
      '[data-automation-id="listing-rooms"] span:first-child',
      '.listing-rooms span:first-child',
      '[class*="bedroom"]',
    );
    const bedrooms = text(bedNode);

    // Bathrooms
    const bathNode = first(card,
      '[data-automation-id="listing-card-bathroom"]',
      '[data-automation-id="listing-rooms"] span:nth-child(2)',
      '.listing-rooms span:nth-child(2)',
      '[class*="bathroom"]',
    );
    const bathrooms = text(bathNode);

    // MRT info
    const mrtNode = first(card,
      '[data-automation-id="listing-mrt"]',
      '.listing-mrt',
      '[class*="mrt"]',
      '[class*="MRT"]',
    );
    const mrtInfo = text(mrtNode);

    // Listing ID (from data attr if available)
    const listingId = card.dataset.listingId || card.dataset.id || attr(card, 'id') || null;

    return {
      listingId,
      title,
      url,
      price,
      pricePerSqft,
      size,
      address,
      bedrooms,
      bathrooms,
      mrtInfo,
    };
  }

  // ── Find all listing cards ───────────────────────────────────────────────
  function findCards() {
    const selectors = [
      '[data-listing-id]',
      '.listing-card',
      '[class*="ListingCard"]',
      '[class*="listing-card"]',
      'li[class*="listing"]',
      '.listing-item',
    ];
    for (const sel of selectors) {
      const cards = [...document.querySelectorAll(sel)];
      if (cards.length > 0) return cards;
    }
    return [];
  }

  // ── Handle "Load More" / pagination ─────────────────────────────────────
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
        if (btn && btn.offsetParent !== null) break; // visible
        btn = null;
      }
      if (!btn) break;
      const prevCount = findCards().length;
      btn.click();
      // Wait for new cards to render
      await new Promise(r => setTimeout(r, 2000));
      const newCount = findCards().length;
      clicked++;
      if (newCount <= prevCount || clicked > 20) break; // safety cap
    }
  }

  // ── Main scrape function ─────────────────────────────────────────────────
  async function scrape() {
    await clickLoadMore();
    const cards = findCards();
    const listings = cards
      .map(parseCard)
      .filter(l => l.title || l.price || l.url); // skip empty
    window.__pgScrapedListings = listings;
    return listings;
  }

  // Run on page load and on explicit trigger from popup
  scrape();
  window.addEventListener('pg:scrape', () => scrape());
})();
