import { expect, test } from '@playwright/test';
import { exposeMonaco, setEditorValue, waitForEditor } from './editor.js';

const manifest = `apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: edge
spec:
  gatewayClassName: example
  listeners:
    - name: http
      hostname: listener.example.com
      port: 80
      protocol: HTTP
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: web
spec:
  hostnames: ["*.example.com", api.example.com]
  parentRefs: [{name: edge}]
  rules:
    - matches:
        - path: {type: Exact, value: /api}
          method: GET
          headers: [{name: x-version, value: v1}]
          queryParams: [{name: mode, value: preview}]
---
apiVersion: gateway.networking.k8s.io/v1
kind: GRPCRoute
metadata:
  name: rpc
spec:
  hostnames: [rpc.example.com]
  rules:
    - matches:
        - method: {service: example.Greeter, method: SayHello}
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: default-route
spec:
  rules: [{}]
`;

test('displays configured routing values and filters table and graph independently', async ({
  page,
}) => {
  await exposeMonaco(page);
  await waitForEditor(page);
  await setEditorValue(page, manifest);
  const table = page.getByRole('table', { name: 'Route coverage', exact: true });
  await expect(table.getByRole('button', { name: 'web', exact: true })).toBeVisible();
  await expect(table).toContainText('*.example.com');
  await expect(table).toContainText('Exact /api · GET');
  await expect(table).toContainText('Exact example.Greeter/SayHello');
  await expect(table).toContainText('Any hostname (unspecified)');
  await expect(table).toContainText('PathPrefix /');
  await expect(table).toContainText('Header x-version Exact v1');
  await expect(table).toContainText('Query mode Exact preview');

  await page.locator('#route-hostname').fill('API.EXAMPLE');
  await page.locator('#route-match').fill('/API');
  await expect(table.getByRole('button', { name: 'rpc', exact: true })).toHaveCount(0);
  await expect(table.getByRole('button', { name: 'web', exact: true })).toBeVisible();
  await table.getByRole('button', { name: 'web', exact: true }).click();
  const details = page.getByRole('complementary', { name: 'Resource details' });
  await expect(details.getByRole('heading', { name: 'Configured hostnames' })).toBeVisible();
  await expect(
    details.getByRole('heading', { name: 'Referenced listener hostnames' }),
  ).toBeVisible();
  await expect(details).toContainText('Exact /api · GET');
  await details.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(table.getByRole('button', { name: 'web', exact: true })).toBeFocused();

  const graphControls = page.getByRole('group', { name: 'Relationship graph controls' });
  await graphControls.getByLabel('Hostname', { exact: true }).fill('rpc.example');
  await graphControls.getByLabel('Route match', { exact: true }).fill('sayhello');
  const selector = page.locator('#inspect-resource');
  await expect(selector.locator('option[value="route:default/rpc"]')).toHaveCount(1);
  await expect(selector.locator('option[value="route:default/web"]')).toHaveCount(0);
  await expect(table.getByRole('button', { name: 'web', exact: true })).toBeVisible();
  await graphControls.getByRole('button', { name: 'Reset graph filters' }).click();
  await expect(selector.locator('option[value="route:default/web"]')).toHaveCount(1);
  await selector.selectOption('gateway:default/edge');
  await expect(details).toContainText('listener.example.com');
  await details.getByRole('button', { name: 'Close', exact: true }).click();

  await page.locator('#route-match').fill('missing');
  await expect(table).toContainText('No matching routes');
  await page.locator('#route-hostname').fill('');
  await page.locator('#route-match').fill('');
  await page.locator('#route-search').fill('Greeter');
  await expect(table.getByRole('button', { name: 'rpc', exact: true })).toBeVisible();
  await expect(table.getByRole('button', { name: 'web', exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 900 });
  await expect(page.locator('#route-hostname')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
});

test('discovers referenced listener hostnames with scoped filters and sorts every table column', async ({
  page,
}) => {
  await exposeMonaco(page);
  await waitForEditor(page);
  await setEditorValue(page, manifest);
  const table = page.getByRole('table', { name: 'Route coverage', exact: true });
  await expect(table.locator('tbody tr')).toHaveCount(3);

  const expected: Record<string, { asc: string[]; desc: string[] }> = {
    Namespace: { asc: ['default-route', 'rpc', 'web'], desc: ['default-route', 'rpc', 'web'] },
    Name: { asc: ['default-route', 'rpc', 'web'], desc: ['web', 'rpc', 'default-route'] },
    Hostnames: { asc: ['default-route', 'web', 'rpc'], desc: ['rpc', 'web', 'default-route'] },
    'Listener hostnames': {
      asc: ['default-route', 'rpc', 'web'],
      desc: ['web', 'default-route', 'rpc'],
    },
    'Route matches': {
      asc: ['web', 'rpc', 'default-route'],
      desc: ['default-route', 'rpc', 'web'],
    },
    'Parent reference': {
      asc: ['web', 'default-route', 'rpc'],
      desc: ['default-route', 'rpc', 'web'],
    },
    Parents: { asc: ['default-route', 'rpc', 'web'], desc: ['web', 'default-route', 'rpc'] },
    'Missing parents': {
      asc: ['default-route', 'rpc', 'web'],
      desc: ['default-route', 'rpc', 'web'],
    },
  };
  for (const [label, order] of Object.entries(expected)) {
    const header = table
      .getByRole('columnheader')
      .filter({ hasText: new RegExp(`^${label}(?:[↑↓\\s]*)$`) });
    for (let index = 0; index < 2; index++) {
      const direction = (await header.getAttribute('aria-sort')) === 'ascending' ? 'desc' : 'asc';
      await header.getByRole('button').press('Enter');
      await expect(header).toHaveAttribute(
        'aria-sort',
        direction === 'asc' ? 'ascending' : 'descending',
      );
      await expect(header.getByRole('button')).toHaveAccessibleName(
        `Sort by ${label.toLowerCase()} ${direction === 'asc' ? 'descending' : 'ascending'}`,
      );
      await expect(table.locator('tbody .route-coverage__resource')).toHaveText(order[direction]);
    }
  }

  await page.locator('#route-hostname').fill('listener.example');
  await expect(table).toContainText('No matching routes');
  await page.locator('#route-hostname-scope').selectOption('LISTENER');
  await expect(table.locator('tbody .route-coverage__resource')).toHaveText(['web']);
  await page.locator('#route-match').fill('preview');
  await expect(table.locator('tbody .route-coverage__resource')).toHaveText(['web']);
  await page.locator('#route-match').fill('x-version');
  await expect(table.locator('tbody .route-coverage__resource')).toHaveText(['web']);

  const controls = page.getByRole('group', { name: 'Relationship graph controls' });
  await controls.getByLabel('Hostname', { exact: true }).fill('listener.example');
  await expect(page.locator('#inspect-resource option[value="route:default/web"]')).toHaveCount(0);
  await controls.getByLabel('Hostname scope', { exact: true }).selectOption('LISTENER');
  await expect(page.locator('#inspect-resource option[value="route:default/web"]')).toHaveCount(1);
  await expect(page.locator('#inspect-resource option[value="route:default/rpc"]')).toHaveCount(0);
  await controls.getByLabel('Hostname', { exact: true }).fill('absent');
  await expect(page.locator('#inspect-resource option')).toHaveCount(1);

  await setEditorValue(
    page,
    manifest.replace('hostnames: ["*.example.com", api.example.com]', 'hostnames: [42]'),
  );
  await expect(page.getByText('Hostname must be a string.', { exact: false })).toBeVisible();
  await expect(table).toHaveCount(0);
  await setEditorValue(page, manifest);
  await expect(table.locator('tbody .route-coverage__resource')).toHaveText([
    'default-route',
    'rpc',
    'web',
  ]);

  await page.setViewportSize({ width: 320, height: 900 });
  await expect(page.locator('#route-hostname-scope')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
