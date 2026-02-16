const { makeLogger } = require('./logger');

async function loginAndSaveState(context, settings) {
  const log = makeLogger('LOGIN');
  const page = await context.newPage();

  log.info('Opening home', { url: settings.base });
  await page.goto(settings.base, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Click login button
  const loginBtn = page.locator('button[data-testid="login-link"]');
  await loginBtn.waitFor({ timeout: 60000 });
  await loginBtn.click();

  // Username step
  const userInput = page.locator('input[data-testid="auth_username"]');
  await userInput.waitFor({ timeout: 60000 });
  await userInput.fill(settings.username);

  await page.locator('button[data-testid="auth_submit_username"]').click();

  // Password step
  const passInput = page.locator('input[data-testid="auth_password"]');
  await passInput.waitFor({ timeout: 60000 });
  await passInput.fill(settings.password);

  await page.locator('button[data-testid="auth_submit_login"]').click();

  // Wait for modal to close OR for login link to disappear
  await page.waitForTimeout(1500);
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

  // Heuristic: login button should not be visible after login (or becomes account button)
  await page.waitForTimeout(1000);
  log.info('Login submitted; saving storage state');

  await context.storageState({ path: settings.storageStatePath });
  await page.close();

  return settings.storageStatePath;
}

module.exports = { loginAndSaveState };
