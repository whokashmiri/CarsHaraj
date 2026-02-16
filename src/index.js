//index.js

const fs = require('fs');
const { getSettings } = require('./core/config');
const { makeLogger } = require('./core/logger');
const { connectMongo, closeMongo } = require('./core/db');
const { launchBrowser, newContext } = require('./core/browser');
const { loginAndSaveState } = require('./core/login');
const { runFullScrape } = require('./jobs/fullScrape');
const { pollNewAds } = require('./jobs/pollNewAds');
const { refreshCommentsLoop } = require('./jobs/refreshComments');

const log = makeLogger('MAIN');

async function ensureAuthState(browser, settings) {
  if (fs.existsSync(settings.storageStatePath)) {
    log.info('Using existing storageState', { path: settings.storageStatePath });
    return settings.storageStatePath;
  }

  log.info('No storageState found; logging in');
  const ctx = await newContext(browser, settings);
  const path = await loginAndSaveState(ctx, settings);
  await ctx.close();
  return path;
}

async function main() {
  const settings = getSettings();
  await connectMongo(settings, log);

  const browser = await launchBrowser(settings, log);
  const storageStatePath = await ensureAuthState(browser, settings);

  const mode = (settings.mode || '').toLowerCase();

  // Run full scrape once unless mode excludes it
  if (!mode || mode === 'full') {
    const ctx = await newContext(browser, settings, storageStatePath);
    await runFullScrape(ctx, settings);
    await ctx.close();
    if (mode === 'full') {
      await browser.close();
      await closeMongo();
      return;
    }
  }

  // For long-running loops, use separate contexts so they don't fight over a single page.
  const pollCtx = (!mode || mode === 'poll') ? await newContext(browser, settings, storageStatePath) : null;
  const commentsCtx = (!mode || mode === 'refresh') ? await newContext(browser, settings, storageStatePath) : null;

  const tasks = [];
  if (!mode || mode === 'poll') tasks.push(pollNewAds(pollCtx, settings));
  if (!mode || mode === 'refresh') tasks.push(refreshCommentsLoop(commentsCtx, settings));

  if (!tasks.length) {
    log.warn('No tasks to run. Set MODE=full|poll|refresh or leave empty.');
    await browser.close();
    await closeMongo();
    return;
  }

  // Keep alive
  await Promise.all(tasks);
}

main().catch(async (e) => {
  log.error('Fatal', { err: String(e), stack: e?.stack });
  try { await closeMongo(); } catch {}
  process.exit(1);
});

process.on('SIGINT', async () => {
  log.warn('SIGINT received, exiting');
  try { await closeMongo(); } catch {}
  process.exit(0);
});
