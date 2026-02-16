const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth')();

chromium.use(stealthPlugin);

async function launchBrowser(settings, log) {
  log.info('Launching browser', { headless: settings.headless, slowMoMs: settings.slowMoMs });

  const browser = await chromium.launch({
    headless: settings.headless,
    slowMo: settings.slowMoMs,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  return browser;
}

async function newContext(browser, settings, storageStatePath = null) {
  const context = await browser.newContext({
    locale: settings.locale,
    timezoneId: settings.timezoneId,
    viewport: { width: 1366, height: 850 },
    storageState: storageStatePath || undefined
  });

  // A little hardening
  await context.addInitScript(() => {
    // Hide webdriver
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return context;
}

module.exports = { launchBrowser, newContext };
