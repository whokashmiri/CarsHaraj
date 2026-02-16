// src/jobs/fullScrape.js
const PQueue = require("p-queue").default;
const { makeLogger } = require("../core/logger");
const {
  waitForListing,
  readVisibleAds,
  readAdsRange,
  getPostCount,
  loadMoreUntilStuck,
} = require("../scrape/listing");
const { scrapeAdInNewTab } = require("../scrape/ad");
const { isAdExists, upsertAd } = require("../core/db");
const { humanDelay } = require("../core/human");

const log = makeLogger("FULL");

function extractUrlId(adUrl) {
  // adUrl example: https://haraj.com.sa/11175523663/slug...
  try {
    const u = new URL(adUrl);
    const first = u.pathname.split("/").filter(Boolean)[0];
    return first ? String(first) : null;
  } catch {
    return null;
  }
}

async function runFullScrape(context, settings) {
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  log.info("Navigate to tag page", { url: settings.tagUrl });
  await page.goto(settings.tagUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForListing(page);

  const queue = new PQueue({ concurrency: settings.detailConcurrency });

  // track duplicates per-run using URL id when possible
  const seen = new Set();

  let totalScraped = 0;

  async function enqueueAds(ads) {
    if (!Array.isArray(ads) || ads.length === 0) {
      log.debug("enqueueAds: nothing to enqueue", {
        adsCount: Array.isArray(ads) ? ads.length : 0,
      });
      return;
    }

    for (const ad of ads) {
      if (settings.maxAds && totalScraped >= settings.maxAds) {
        log.info("Max ads reached, stopping enqueue", {
          maxAds: settings.maxAds,
          totalScraped,
        });
        return;
      }

      if (!ad?.url) {
        log.warn("enqueueAds: skip ad missing url", { ad });
        continue;
      }

      // Prefer URL-based id (matches your Mongo _id)
      const urlId = extractUrlId(ad.url);
      const key = urlId || String(ad.postId || ad.url);

      if (seen.has(key)) continue;
      seen.add(key);

      queue.add(async () => {
        const listingPostId = String(ad.postId || "");
        const dbId = urlId || listingPostId;

        try {
          await humanDelay(800, 2500);

          // ✅ IMPORTANT: check DB using the URL id (1117...), not listing id (1755...)
          const exists = await isAdExists(dbId);
          if (exists) {
            log.debug("Skip existing", { postId: dbId });
            return;
          }

          await humanDelay(800, 2500);

          const scraped = await scrapeAdInNewTab(context, ad, settings);

          if (!scraped) {
            log.warn("Scrape returned null", { postId: dbId, url: ad.url });
            return;
          }

          if (!scraped.postId && !scraped._id) {
            log.warn("Scraped doc missing postId/_id", { postId: dbId, url: ad.url });
            return;
          }

          await upsertAd(scraped);

          totalScraped += 1;
          log.info("Saved", { postId: scraped._id || scraped.postId, totalScraped });
        } catch (e) {
          log.error("Ad scrape failed", { postId: dbId, err: String(e) });
        }
      });
    }
  }

  // -----------------------------
  // 1) Initial batch (top)
  // -----------------------------
  let ads = await readVisibleAds(page, settings);
  log.info("Visible ads (initial)", { count: ads.length });
  await enqueueAds(ads);

  // Track how many cards exist on the listing page
  let lastTotal = await getPostCount(page);

  // Used by loadMoreUntilStuck to stop after several no-growth attempts
  const state = { noGrowth: 0 };

  // -----------------------------
  // 2) Load-more/scroll loop
  //    Enqueue ONLY newly appended cards
  // -----------------------------
  while (!settings.maxAds || totalScraped < settings.maxAds) {
    await humanDelay(700, 2000);

    const res = await loadMoreUntilStuck(page, settings, state);

    // res.changed meaning: "should keep trying"
    // When it becomes false => we are stuck, stop full scrape.
    if (!res.changed) {
      break;
    }

    // If growth happened, res.after > lastTotal
    const after = res.after;
    if (after > lastTotal) {
      await humanDelay(400, 1200);

      // ✅ read ONLY the newly added range
      const newAds = await readAdsRange(page, settings, lastTotal, after);
      log.info("Newly loaded ads", { from: lastTotal, to: after, count: newAds.length });

      await enqueueAds(newAds);

      lastTotal = after;
    } else {
      // no growth this attempt; loadMoreUntilStuck will retry until maxNoGrowth
      await humanDelay(500, 1500);
    }

    // backpressure
    const maxQueue = settings.detailConcurrency * 5;
    const resumeAt = settings.detailConcurrency * 3;

    if (queue.size > maxQueue) {
      log.info("Queue backpressure", {
        queued: queue.size,
        pending: queue.pending,
        concurrency: settings.detailConcurrency,
      });
      await queue.onSizeLessThan(resumeAt);
    }
  }

  await queue.onIdle();
  await page.close().catch(() => {});

  log.info("Full scrape done", { totalScraped, seen: seen.size });
}

module.exports = { runFullScrape };
