// src/jobs/pollNewAds.js
const PQueue = require("p-queue").default;
const { makeLogger } = require("../core/logger");
const { waitForListing, readVisibleAds, loadMoreAds } = require("../scrape/listing");
const { scrapeAdInNewTab } = require("../scrape/ad");
const { isAdExists, upsertAd } = require("../core/db");
const { sleep, minutes } = require("../util/time");
const { humanDelay } = require("../core/human");

const log = makeLogger("POLL");

async function pollNewAds(context, settings) {
  const pollMs = minutes(settings.pollMinutes);
  const stopAt = Number(settings.consecutiveExisting || 5) || 5;

  // safety: don’t scan forever in one cycle
  const maxLoadSteps = Number(settings.pollMaxLoadSteps || 6) || 6;

  while (true) {
    const page = await context.newPage();
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    let consecutiveExisting = 0;
    let scrapedThisCycle = 0;

    try {
      await humanDelay(600, 1600);

      log.info("Polling tag page", { url: settings.tagUrl });
      await page.goto(settings.tagUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await waitForListing(page);

      await humanDelay(600, 1600);

      const queue = new PQueue({ concurrency: settings.detailConcurrency });

      // Track what we already checked this cycle (avoid duplicates across loadMore)
      const checked = new Set();

      // We scan newest -> older, loading more if needed, until 5 consecutive are already in DB
      for (let step = 0; step <= maxLoadSteps; step++) {
        const ads = await readVisibleAds(page, settings);

        if (!ads.length) {
          log.warn("No ads found");
          break;
        }

        for (const ad of ads) {
          if (!ad?.postId) continue;
          if (checked.has(ad.postId)) continue;
          checked.add(ad.postId);

          // small jitter to avoid patterns
          await humanDelay(200, 650);

          const exists = await isAdExists(ad.postId);

          if (exists) {
            consecutiveExisting += 1;
            log.debug("Existing", { postId: ad.postId, consecutiveExisting });

            if (consecutiveExisting >= stopAt) {
              log.info("Reached consecutiveExisting stop threshold", {
                stopAt,
                consecutiveExisting,
                scanned: checked.size,
              });
              step = maxLoadSteps + 1; // force break outer loop
              break;
            }
            continue;
          }

          // New ad
          consecutiveExisting = 0;

          queue.add(async () => {
            const postId = String(ad.postId);
            try {
              await humanDelay(700, 2200);

              const scraped = await scrapeAdInNewTab(context, ad, settings);
              if (!scraped) {
                log.warn("Scrape returned null", { postId, url: ad.url });
                return;
              }

              await upsertAd(scraped);

              scrapedThisCycle += 1;
              log.info("Saved new", {
                postId: scraped._id || scraped.postId || postId,
                scrapedThisCycle,
              });
            } catch (e) {
              log.error("New ad scrape failed", { postId, err: String(e) });
            }
          });
        }

        // wait tasks from this batch (keeps it stable)
        await queue.onIdle();

        // If we already reached stopAt, don’t load more
        if (consecutiveExisting >= stopAt) break;

        // Try load more / scroll to see slightly older posts (only if needed)
        await humanDelay(500, 1500);
        const changed = await loadMoreAds(page, settings);
        if (!changed) {
          log.info("No more ads loaded during poll step", { step, scanned: checked.size });
          break;
        }

        await humanDelay(500, 1500);
      }

      log.info("Poll cycle done", { scrapedThisCycle, consecutiveExisting });
    } catch (e) {
      log.error("Poll cycle error", { err: String(e) });
    } finally {
      await page.close().catch(() => {});
    }

    await sleep(pollMs);
  }
}

module.exports = { pollNewAds };
