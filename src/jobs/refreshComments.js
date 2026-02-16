// src/jobs/refreshComments.js
const { makeLogger } = require("../core/logger");
const { listAdsForCommentsRefresh, updateCommentsOnly } = require("../core/db");
const { refreshCommentsOnly } = require("../scrape/ad");
const { sleep, hours } = require("../util/time");
const { humanDelay } = require("../core/human");

const log = makeLogger("CMTS");

async function refreshCommentsLoop(context, settings) {
  const baseWaitMs = hours(settings.commentsRefreshHours); // how often to run a cycle
  const batchSize = Number(settings.commentsBatch || 200) || 200;

  while (true) {
    try {
      // small jitter before each cycle (avoid fixed schedule fingerprint)
      await humanDelay(1200, 4500);

      const batch = await listAdsForCommentsRefresh(batchSize, settings);
      log.info("Refreshing comments batch", { count: batch.length });

      if (!batch.length) {
        log.info("No eligible ads for comments refresh (24h+ & <=30d & stale).");
        // sleep a bit shorter if nothing to do, but still not too aggressive
        await sleep(Math.max(60_000, Math.floor(baseWaitMs * 0.6)));
        continue;
      }

      for (const ad of batch) {
        const postId = String(ad?._id || "").trim();
        if (!postId) continue;

        try {
          // human-ish pacing per ad
          await humanDelay(900, 3200);

          const payload = await refreshCommentsOnly(context, ad, settings);

          // refreshCommentsOnly returns { comments: [...] }
          if (Array.isArray(payload?.comments)) {
            await updateCommentsOnly(postId, payload.comments);
            log.info("Comments updated", { postId, count: payload.comments.length });
          } else {
            log.warn("No comments payload captured", { postId });
          }

          // extra tiny jitter between ads to reduce burstiness
          await humanDelay(250, 900);
        } catch (e) {
          log.error("Comments refresh failed", { postId, err: String(e) });
          // small pause on error to avoid repeated fast failures
          await humanDelay(1200, 3500);
        }
      }

      log.info("Comments cycle done");
    } catch (e) {
      log.error("Comments cycle error", { err: String(e) });
    }

    // sleep until next cycle, with jitter
    const jitter = Math.floor(baseWaitMs * (Math.random() * 0.25)); // up to +25%
    await sleep(baseWaitMs + jitter);
  }
}

module.exports = { refreshCommentsLoop };
