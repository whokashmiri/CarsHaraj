const { MongoClient } = require('mongodb');

let client;
let db;
let adsCol;
let stateCol;

async function connectMongo(settings, log) {
  if (db) return { db, adsCol, stateCol };

  client = new MongoClient(settings.mongoUri, {
    maxPoolSize: 10
  });
  await client.connect();
  db = client.db(settings.dbName);
  adsCol = db.collection(settings.colAds);
  stateCol = db.collection(settings.colState);

  // await adsCol.createIndex({ _id: 1 }, { unique: true });
  await adsCol.createIndex({ updatedAt: -1 });
  await adsCol.createIndex({ createdAt: -1 });

  log.info('Mongo connected', { db: settings.dbName, ads: settings.colAds });
  return { db, adsCol, stateCol };
}

async function closeMongo() {
  if (client) await client.close();
  client = null;
  db = null;
  adsCol = null;
  stateCol = null;
}

async function isAdExists(postId) {
  const found = await adsCol.findOne({ _id: String(postId) }, { projection: { _id: 1 } });
  return !!found;
}


async function upsertAd(doc) {
  if (!adsCol) throw new Error("Mongo not connected: adsCol is null");
  if (!doc || typeof doc !== "object") throw new Error("upsertAd: doc is undefined/null");

  const id = String(doc._id || doc.postId || "").trim();
  if (!id) throw new Error("Missing postId/_id");

  const now = new Date();

  // never set _id inside $set
  const setDoc = { ...doc };
  delete setDoc._id;

  setDoc.postId = id;
  setDoc.updatedAt = now;
  setDoc.lastSeenAt = now;

  const res = await adsCol.updateOne(
    { _id: id },
    {
      $set: setDoc,
      $setOnInsert: {
        createdAt: now,
        firstSeenAt: now,
      },
    },
    { upsert: true }
  );

  return res;
}

// core/db.js
async function updateComments(postId, payload) {
  if (!adsCol) throw new Error("Mongo not connected: adsCol is null");

  const id = String(postId || "").trim();
  if (!id) throw new Error("updateComments: missing postId");

  const now = new Date();

  // payload expected shape: { comments: [...] }
  const comments = Array.isArray(payload?.comments) ? payload.comments : [];
  const commentsCount = comments.length;

  await adsCol.updateOne(
    { _id: id },
    {
      $set: {
        comments,
        commentsCount,
        visibleCommentsCount: commentsCount,
        commentsLastFetchedAt: now,
        updatedAt: now,
      },
      // keep createdAt if document somehow doesn't exist yet
      $setOnInsert: { createdAt: now, firstSeenAt: now },
    },
    { upsert: true }
  );
}

async function listAdsForCommentsRefresh(limit = 200, settings) {
  const now = new Date();

  const olderThan24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const notOlderThan30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const refreshMs = (Number(settings.commentsRefreshHours || 6) || 6) * 60 * 60 * 1000;
  const staleBefore = new Date(now.getTime() - refreshMs);

  return adsCol
    .find(
      {
        firstSeenAt: { $lte: olderThan24h, $gte: notOlderThan30d },
        $or: [
          { commentsLastFetchedAt: { $exists: false } },
          { commentsLastFetchedAt: { $lte: staleBefore } },
        ],
      },
      { projection: { _id: 1, url: 1, firstSeenAt: 1, commentsLastFetchedAt: 1 } }
    )
    .sort({ commentsLastFetchedAt: 1, firstSeenAt: 1 })
    .limit(limit)
    .toArray();
}


module.exports = {
  connectMongo,
  closeMongo,
  isAdExists,
  upsertAd,
  updateComments,
  listAdsForCommentsRefresh
};
