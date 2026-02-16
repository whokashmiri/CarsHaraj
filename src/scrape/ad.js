// src/scrape/ad.js
const { humanDelay } = require("../core/human");

const { makeLogger } = require("../core/logger");

const log = makeLogger("AD");

function isGraphqlBase(url, settings) {
  return !!url && url.startsWith(settings.gqlBase);
}
function isPostsUrl(url) {
  return typeof url === "string" && url.includes("queryName=posts");
}
function isCommentsUrl(url) {
  return typeof url === "string" && url.includes("queryName=comments");
}

function normalizeUrlToBase(adUrl) {
  // want: https://haraj.com.sa/1117....
  try {
    const u = new URL(adUrl);
    const parts = u.pathname.split("/").filter(Boolean); // ["1117...", "slug"]
    const id = parts[0] || "";
    return `${u.origin}/${id}`;
  } catch {
    return adUrl;
  }
}

function pickFirstPostItem(postsJson) {
  return postsJson?.data?.posts?.items?.[0] || null;
}

function computePrice(item) {
  const formattedPrice = item?.price?.formattedPrice ?? null;
  const numeric =
    formattedPrice != null
      ? Number(String(formattedPrice).replace(/[^\d]/g, "")) || null
      : null;

  return { formattedPrice, numeric };
}

function compactItem(item) {
  if (!item) return null;

  const price = computePrice(item);

  return {
    id: item.id ?? null,
    title: item.title ?? null,
    postDate: item.postDate ?? null,
    updateDate: item.updateDate ?? null,

    authorUsername: item.authorUsername ?? null,
    authorId: item.authorId ?? null,

    URL: item.URL ?? null,
    bodyTEXT: item.bodyTEXT ?? null,

    city: item.geoCity || item.city || null,
    geoCity: item.geoCity ?? null,
    geoNeighborhood: item.geoNeighborhood ?? null,

    tags: Array.isArray(item.tags) ? item.tags : [],
    imagesList: Array.isArray(item.imagesList) ? item.imagesList : [],

    hasImage: !!item.hasImage,
    hasVideo: !!item.hasVideo,

    commentEnabled: !!item.commentEnabled,
    commentStatus: item.commentStatus ?? null,
    commentCount: item.commentCount ?? 0,

    status: item.status ?? null,
    postType: item.postType ?? null,

    // ✅ ADD carInfo safely
    carInfo: item.carInfo
      ? {
          sellOrWaiver: item.carInfo.sellOrWaiver ?? null,
          is4DW: item.carInfo.is4DW ?? null,
          model: item.carInfo.model ?? null,
          mileage: item.carInfo.mileage ?? null,
          fuel: item.carInfo.fuel ?? null,
          gear: item.carInfo.gear ?? null,
          carOrRelated: item.carInfo.carOrRelated ?? null,
          Bank: item.carInfo.Bank ?? null,
        }
      : null,

    price,
  };
}


function extractUrlIdFromItemURL(itemURL) {
  // item.URL example: "11175523663/slug/"
  const first = String(itemURL || "").split("/").filter(Boolean)[0];
  return first || null;
}

function parsePhone(contact) {
  if (!contact) return null;

  const href = String(contact.href || "").trim();
  const rawText = String(contact.rawText || "").trim();
  const phone = String(contact.phone || "").trim();

  const candidate =
    phone ||
    (href.startsWith("tel:") ? href.replace("tel:", "") : "") ||
    rawText;

  const cleaned = String(candidate || "").replace(/[^\d+]/g, "");
  return cleaned || null;
}

function compactComments(commentsJson) {
  const items = commentsJson?.data?.comments?.items;
  if (!Array.isArray(items)) return [];

  return items.map((c) => ({
    id: c?.id ?? null,
    body: c?.body ?? c?.comment ?? c?.text ?? null,
    authorUsername: c?.authorUsername ?? c?.username ?? null,
    authorId: c?.authorId ?? null,
    date: c?.date ?? c?.createdAt ?? null,
  }));
}

async function scrapeAdInNewTab(context, adMeta, settings) {
  const listingPostId = String(adMeta?.postId || "").trim(); // 1755...
  if (!listingPostId || !adMeta?.url) {
    log.warn("Skip ad: missing postId/url", { adMeta });
    return null;
  }

  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  await page.bringToFront().catch(() => {});
  await page.waitForTimeout(120).catch(() => {});

  // Capture snapshots (but DO NOT return/store gql)
  let postsSnapshot = null;
  let commentsSnapshot = null;

  const onResponse = async (resp) => {
    try {
      const url = resp.url();
      if (!isGraphqlBase(url, settings)) return;
      if (!isPostsUrl(url) && !isCommentsUrl(url)) return;

      const ct = (resp.headers()["content-type"] || "").toLowerCase();
      if (!ct.includes("application/json")) return;

      const json = await resp.json();

      if (isPostsUrl(url)) {
        postsSnapshot = { url, json, at: new Date().toISOString() };
        log.info("Captured GraphQL posts", { postId: listingPostId });
      } else {
        commentsSnapshot = { url, json, at: new Date().toISOString() };
        log.info("Captured GraphQL comments", { postId: listingPostId });
      }
    } catch (e) {
      log.warn("GraphQL parse failed", { postId: listingPostId, err: String(e) });
    }
  };

  page.on("response", onResponse);

  try {
    log.info("Open ad (new tab)", { postId: listingPostId, url: adMeta.url });

    // retry navigation
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await humanDelay(600, 1800);

        await page.goto(adMeta.url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await humanDelay(600, 2000);

        break;
      } catch (e) {
        log.warn("goto failed", { postId: listingPostId, attempt, err: String(e) });
        if (attempt === 2) throw e;
      }
    }

    // Ad UI ready
    await page
      .waitForSelector('button[data-testid="post-contact"]', { timeout: 60000 })
      .catch(() => log.warn("post-contact not found", { postId: listingPostId }));

    // Let GraphQL + UI settle
    await page.waitForTimeout(900);

    // -------------------------
    // Contact modal (wait until it settles)
    // -------------------------
    let contact = null;
    try {
      const contactBtn = page.locator('button[data-testid="post-contact"]').first();
      const visible = await contactBtn.isVisible().catch(() => false);

      if (visible) {
        log.info("Opening contact modal", { postId: listingPostId });
        await contactBtn.click({ timeout: 20000 });
        await humanDelay(500, 1500);


        const phoneA = page.locator('a[data-testid="contact_mobile"]').first();
        await phoneA.waitFor({ timeout: 20000 });

        await page
          .waitForFunction(() => {
            const a = document.querySelector('a[data-testid="contact_mobile"]');
            if (!a) return false;

            const href = (a.getAttribute("href") || "").trim();
            const txt = (a.textContent || "").replace(/\s+/g, " ").trim();

            if (href.startsWith("tel:") && href !== "tel:" && !href.includes("undefined")) {
              const num = href.replace("tel:", "").trim();
              return num.length >= 8;
            }

            return /(\+?\d[\d\s-]{7,}\d)/.test(txt);
          }, { timeout: 12000 })
          .catch(() => log.warn("Phone did not settle in time", { postId: listingPostId }));

        const href = (await phoneA.getAttribute("href").catch(() => null)) || null;
        const rawText = (await phoneA.innerText().catch(() => ""))
          .replace(/\s+/g, " ")
          .trim();

        let phone = null;
        if (href && href.startsWith("tel:") && href !== "tel:" && !href.includes("undefined")) {
          phone = href.replace("tel:", "").replace(/\s+/g, "").trim();
        } else {
          const m = rawText.match(/(\+?\d[\d\s-]{7,}\d)/);
          phone = m ? m[1].replace(/[\s-]/g, "") : null;
        }

        contact = { phone, href: href || null, rawText: rawText || null };
        log.info("Contact extracted", { postId: listingPostId, phone, href: href || null });

        await page.keyboard.press("Escape").catch(() => {});
      } else {
        log.warn("Contact button not visible", { postId: listingPostId });
      }
    } catch (e) {
      log.warn("Contact modal failed", { postId: listingPostId, err: String(e) });
    }

    // -------------------------
    // Build compact output (NO gql)
    // -------------------------
    const postItemRaw = pickFirstPostItem(postsSnapshot?.json);
    const item = compactItem(postItemRaw);

    // Use URL-id as postId if possible (1117...), else fallback to listing id
    const urlId = extractUrlIdFromItemURL(item?.URL);
    const postId = String(urlId || listingPostId);

    const url = normalizeUrlToBase(adMeta.url);
    const phone = parsePhone(contact);

    const comments = compactComments(commentsSnapshot?.json);
    const commentsCount = Number(item?.commentCount ?? comments.length ?? 0) || 0;

    // Optional bits
    const city = item?.geoCity || item?.city || adMeta.city || null;

    // Return SMALL doc
    return {
      _id: postId,                 // ✅ mongo _id
      postId,                      // ✅ string
      url,
      title: item?.title || adMeta.title || null,
      city,

      phone,                       // ✅ flat phone
      author: item?.authorUsername || adMeta.author || null,

      tags: Array.isArray(item?.tags) ? item.tags : [],
      postDate: item?.postDate ?? null,

      hasPrice: !!(item?.price?.numeric || item?.price?.formattedPrice),
      priceNumeric: item?.price?.numeric ?? null,

      item,                        // ✅ compact item

      comments,
      commentsCount,
      visibleCommentsCount: comments.length,
      commentsLastFetchedAt: new Date(),

      // keep contact if you want (small)
      contact: contact || null,
    };
  } catch (e) {
    log.warn("Ad scrape exception", { postId: listingPostId, err: String(e) });
    return null;
  } finally {
    log.info("Closing ad tab", { postId: listingPostId });
    await humanDelay(400, 1200);
    await page.close().catch(() => {});
  }
}

async function refreshCommentsOnly(context, adDoc, settings) {
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  let commentsSnapshot = null;

  const onResponse = async (resp) => {
    try {
      const url = resp.url();
      if (!isGraphqlBase(url, settings)) return;
      if (!isCommentsUrl(url)) return;

      const ct = (resp.headers()["content-type"] || "").toLowerCase();
      if (!ct.includes("application/json")) return;

      const json = await resp.json();
      commentsSnapshot = { url, json, at: new Date().toISOString() };
    } catch {}
  };

  page.on("response", onResponse);

  const id = String(adDoc?._id || adDoc?.postId || "").trim();
  const url = adDoc.url || settings.base.replace(/\/$/, "") + "/" + id;

  try {
    log.info("Refresh comments", { postId: id, url });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);

    const comments = compactComments(commentsSnapshot?.json);
    return { comments };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { scrapeAdInNewTab, refreshCommentsOnly };
