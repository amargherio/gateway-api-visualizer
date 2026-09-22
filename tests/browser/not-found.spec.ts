import { expect, test } from '@playwright/test';

test('recovers from a nested missing page without starting a manifest audit', async ({
  page,
}, testInfo) => {
  const base = new URL(testInfo.project.use.baseURL as string);
  const missing = new URL('missing/nested/%3Cscript%3E?private=do-not-display#fragment', base);
  const auditRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.includes('/gateway-api/'))
      auditRequests.push(request.url());
  });

  const response = await page.goto(missing.href);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.locator('dd')).toHaveText(missing.pathname);
  await expect(page.getByText('do-not-display', { exact: false })).toHaveCount(0);
  await expect(page.locator('.monaco-editor')).toHaveCount(0);
  expect(auditRequests).toEqual([]);

  const home = page.getByRole('link', { name: 'Open the workbench' });
  await expect(home).toHaveAttribute('href', base.pathname);
  await home.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(base.href);
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect(page.getByTestId('gateway-api-status')).toHaveAttribute('data-state', 'ready');
});
