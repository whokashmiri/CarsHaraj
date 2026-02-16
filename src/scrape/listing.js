// src/scrape/listing.js
const { makeLogger } = require("../core/logger");
const { humanDelay } = require("../core/human");

const log = makeLogger("LIST");

const POST_ITEM_SEL = 'div[data-testid="post-item"]';
const LISTING_CONTAINER_SEL = "div.box-border.w-full.relative";
const LOAD_MORE_BTN_SEL = 'button[data-testid="posts-load-more"]';

async function waitForListing(page) {
  log.info("Waiting for listing container...");
  await page.waitForSelector(LISTING_CONTAINER_SEL, { timeout: 60000 });

  log.info("Waiting for at least 1 post item...");
  await page.waitForSelector(POST_ITEM_SEL, { timeout: 60000 });

  log.info("Listing ready");
}

function normalizeHref(href, base) {
  if (!href) return null;
  if (href.startsWith("http")) return href;
  const root = base.replace(/\/$/, "");
  if (href.startsWith("/")) return root + href;
  return root + "/" + href;
}

async function getPostCount(page) {
  return await page.locator(POST_ITEM_SEL).count().catch(() => 0);
}

/**
 * Read ads from a RANGE of cards [start, endExclusive)
 * This is critical so we can read newly appended items after load-more/scroll.
 */
async function readAdsRange(page, settings, start = 0, endExclusive = null) {
  const cards = page.locator(POST_ITEM_SEL);

  const total = await cards.count().catch(() => 0);
  if (!total) return [];

  const end = endExclusive == null ? total : Math.min(endExclusive, total);
  const s = Math.max(0, Math.min(start, end));

  const ads = [];

  for (let i = s; i < end; i++) {
    const card = cards.nth(i);

    const postId = await card.getAttribute("data-test-postid").catch(() => null);
    if (!postId) continue;

    const titleA = card.locator('a[data-testid="post-title-link"]').first();
    const href = await titleA.getAttribute("href").catch(() => null);
    const url = normalizeHref(href, settings.base);

    if (!url) {
      log.warn("Missing ad url", { postId, href, base: settings.base });
      continue;
    }

    const title = (await titleA.innerText().catch(() => ""))
      .replace(/\s+/g, " ")
      .trim();

    const author =
      (await card.getAttribute("data-test-author").catch(() => null)) || null;

    ads.push({ postId: String(postId), url, title: title || null, author });
  }

  return ads;
}

/**
 * For POLL (new ads): we only need the top items.
 * For FULL: we should read the LAST items after each load-more.
 */
async function readVisibleAds(page, settings) {
  const total = await getPostCount(page);

  const MAX_VISIBLE = Number(settings.maxVisibleAds || 20);
  const limit = Math.min(total, MAX_VISIBLE);

  log.info("Reading visible ads (top)", { total, limit });

  const ads = await readAdsRange(page, settings, 0, limit);

  log.info("Visible ads parsed", {
    total,
    kept: ads.length,
    sample: ads.slice(0, 3).map((a) => ({ postId: a.postId, url: a.url })),
  });

  return ads;
}

/**
 * Read the LAST N ads (newly appended are usually at the bottom).
 * This is what FULL SCRAPE should use after loadMoreAds.
 */
async function readLastAds(page, settings, lastN = 30) {
  const total = await getPostCount(page);
  const n = Math.max(1, Math.min(Number(lastN || 30), total));
  const start = Math.max(0, total - n);

  log.info("Reading visible ads (bottom)", { total, start, n });

  const ads = await readAdsRange(page, settings, start, total);

  log.info("Bottom ads parsed", {
    total,
    kept: ads.length,
    sample: ads.slice(0, 3).map((a) => ({ postId: a.postId, url: a.url })),
  });

  return ads;
}

// ----------------------------
// Load more: click if button exists, else scroll
// ----------------------------
async function tryClickLoadMore(page) {
  const btn = page.locator(LOAD_MORE_BTN_SEL);
  const count = await btn.count().catch(() => 0);
  if (!count) return false;

  const visible = await btn.first().isVisible().catch(() => false);
  if (!visible) return false;

  const before = await getPostCount(page);
  log.info("Clicking load more", { before });

  await btn.first().scrollIntoViewIfNeeded().catch(() => {});
  await humanDelay(500, 1400);

  await btn.first().click({ timeout: 20000 }).catch((e) => {
    log.warn("Load more click failed", { err: String(e) });
  });

  // wait until count increases (Haraj can be slow)
  await page
    .waitForFunction(
      (prev) => document.querySelectorAll('div[data-testid="post-item"]').length > prev,
      before,
      { timeout: 60000 }
    )
    .catch(() => {});

  const after = await getPostCount(page);
  log.info("Load more click result", { before, after });

  return after > before;
}

async function tryScrollLoadMore(page, settings) {
  const before = await getPostCount(page);
  log.info("Scroll loading more", { before });

  const steps = Number(settings.scrollLoadSteps || 4);

  for (let i = 0; i < steps; i++) {
    await page
      .evaluate(() => window.scrollBy(0, Math.max(900, window.innerHeight * 0.95)))
      .catch(() => {});
    await humanDelay(700, 1800);
  }

  // wait until count increases
  await page
    .waitForFunction(
      (prev) => document.querySelectorAll('div[data-testid="post-item"]').length > prev,
      before,
      { timeout: 45000 }
    )
    .catch(() => {});

  const after = await getPostCount(page);
  log.info("Scroll load result", { before, after });

  return after > before;
}

/**
 * Unified loader with stability logic:
 * Sometimes Haraj delays loading; we allow a few no-growth attempts before stopping.
 *
 * Returns:
 *   { changed: boolean, before: number, after: number }
 */
async function loadMoreAds(page, settings) {
  const before = await getPostCount(page);

  // 1) Prefer button click
  let changed = await tryClickLoadMore(page);

  // 2) Fallback to scroll-load
  if (!changed) {
    changed = await tryScrollLoadMore(page, settings);
  }

  const after = await getPostCount(page);
  return { changed: after > before, before, after };
}

/**
 * Helper for FULL scrape loop:
 * Keep trying to load more until we see growth,
 * but stop after N consecutive failures (no-growth).
 */
async function loadMoreUntilStuck(page, settings, state) {
  const maxNoGrowth = Number(settings.maxNoGrowth || 3); // how many times to tolerate no growth
  state.noGrowth = state.noGrowth || 0;

  const { changed, before, after } = await loadMoreAds(page, settings);

  if (changed) {
    state.noGrowth = 0;
    return { changed: true, before, after };
  }

  state.noGrowth += 1;
  log.info("No growth attempt", { noGrowth: state.noGrowth, maxNoGrowth, before, after });

  return { changed: state.noGrowth < maxNoGrowth, before, after };
}

module.exports = {
  waitForListing,
  readVisibleAds,   // top (for POLL)
  readLastAds,      // bottom (for FULL after load more)
  readAdsRange,
  getPostCount,
  loadMoreAds,
  loadMoreUntilStuck,
  tryClickLoadMore,
  tryScrollLoadMore,
};
