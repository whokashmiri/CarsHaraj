const path = require('path');
const fs = require('fs');
require('dotenv').config();

function asBool(v, def = false) {
  if (v == null || v === '') return def;
  return String(v).toLowerCase() === 'true' || v === '1';
}

function asInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function must(v, name) {
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function getSettings() {
  const base = process.env.HARAJ_BASE || 'https://haraj.com.sa';
  const tagUrl = process.env.HARAJ_TAG_URL || `${base}/tags/%D8%AD%D8%B1%D8%A7%D8%AC%20%D8%A7%D9%84%D8%B3%D9%8A%D8%A7%D8%B1%D8%A7%D8%AA`;

  const headless = asBool(process.env.HARAJ_HEADLESS, true);
  const slowMoMs = asInt(process.env.HARAJ_SLOWMO_MS, 0);

  const detailConcurrency = Math.max(1, asInt(process.env.HARAJ_DETAIL_CONCURRENCY, 3));
  const maxAds = Math.max(0, asInt(process.env.HARAJ_MAX_ADS, 0));

  const pollMinutes = Math.max(1, asInt(process.env.HARAJ_POLL_MINUTES, 5));
  const consecutiveExisting = Math.max(1, asInt(process.env.HARAJ_CONSECUTIVE_EXISTING, 5));

  const commentsRefreshHours = Math.max(1, asInt(process.env.HARAJ_COMMENTS_REFRESH_HOURS, 24));
  const commentsBatch = Math.max(1, asInt(process.env.HARAJ_COMMENTS_BATCH, 200));

  const authDir = path.resolve(process.cwd(), '.auth');
  const storageStatePath = path.join(authDir, 'storageState.json');
  if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

  return {
    mode: process.env.MODE || '',
    base,
    tagUrl,
    headless,
    slowMoMs,
    locale: process.env.HARAJ_LOCALE || 'ar-SA',
    timezoneId: process.env.HARAJ_TIMEZONE || 'Asia/Riyadh',

    username: must(process.env.HARAJ_USERNAME, 'HARAJ_USERNAME'),
    password: must(process.env.HARAJ_PASSWORD, 'HARAJ_PASSWORD'),

    mongoUri: must(process.env.MONGO_URI, 'MONGO_URI'),
    dbName: process.env.DB_NAME || 'haraj',
    colAds: process.env.COLLECTION_ADS || 'haraj_ads',
    colState: process.env.COLLECTION_STATE || 'haraj_state',

    detailConcurrency,
    maxAds,
    pollMinutes,
    consecutiveExisting,
    commentsRefreshHours,
    commentsBatch,

    storageStatePath,

    gqlBase: 'https://graphql.haraj.com.sa/',
    gqlPostsPrefix: 'https://graphql.haraj.com.sa/?queryName=posts',
    gqlCommentsPrefix: 'https://graphql.haraj.com.sa/?queryName=comments'
  };
}

module.exports = { getSettings };
