import { expect, test, type Page } from '@playwright/test';
import { normalizeCrdSchema } from '../../scripts/generate-gateway-api.mjs';
import { exposeMonaco, readMarkers, setEditorValue, waitForEditor, yamlMarkers } from './editor.js';

const gateway = `apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: audit-gateway
  annotations:
    example.com/owner: platform
spec:
  gatewayClassName: example
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      tls:
        mode: Terminate
        certificateRefs:
          - name: audit-gateway-tls
`;

const tcpRouteV1alpha2 = `apiVersion: gateway.networking.k8s.io/v1alpha2
kind: TCPRoute
metadata:
  name: version-boundary
spec:
  parentRefs:
    - name: example
  rules:
    - backendRefs:
        - name: backend
          port: 9000
`;

const tlsRouteV1 = `apiVersion: gateway.networking.k8s.io/v1
kind: TLSRoute
metadata:
  name: tls-version-boundary
spec:
  parentRefs:
    - name: example
  hostnames: [example.com]
  rules:
    - backendRefs:
        - name: backend
          port: 443
`;

const validMixedDocuments = `apiVersion: gateway.networking.k8s.io/v1
kind: GatewayClass
metadata:
  name: example
spec:
  controllerName: example.com/gateway-controller
---
${gateway}---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: audit-route
  annotations:
    example.com/owner: platform
spec:
  parentRefs:
    - name: audit-gateway
  rules:
    - backendRefs:
        - name: audit-backend
          port: 80
---
apiVersion: gateway.networking.k8s.io/v1beta1
kind: ReferenceGrant
metadata:
  name: allow-routes
  namespace: default
spec:
  from:
    - group: gateway.networking.k8s.io
      kind: HTTPRoute
      namespace: default
  to:
    - group: ""
      kind: Service
---
apiVersion: v1
kind: Service
metadata:
  name: audit-backend
  annotations:
    example.com/component: edge
spec:
  ports:
    - port: 80
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: audit-backend
  annotations:
    example.com/component: edge
spec:
  selector:
    matchLabels:
      app: audit-backend
  template:
    metadata:
      labels:
        app: audit-backend
    spec:
      containers:
        - name: backend
          image: example.invalid/backend
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: audit-settings
  annotations:
    example.com/component: edge
data:
  setting: enabled
`;

test.beforeEach(async ({ page }) => {
  await exposeMonaco(page);
});

function auditStatus(page: Page) {
  return page.getByTestId('gateway-api-status');
}

async function requestVersion(page: Page, version: '1.3' | '1.4' | '1.5' | '1.6'): Promise<void> {
  await page.locator('#gateway-api-version').selectOption(version);
  await page.getByRole('button', { name: 'Apply release' }).click();
}

async function selectVersion(page: Page, version: '1.3' | '1.4' | '1.5' | '1.6'): Promise<void> {
  await requestVersion(page, version);
  await expect(auditStatus(page)).toHaveAttribute('data-version', version);
  await expect(auditStatus(page)).toHaveAttribute('data-state', 'ready');
}

async function waitForSchemaMarkers(page: Page, expectedCount: number): Promise<void> {
  await expect.poll(async () => yamlMarkers(await readMarkers(page)).length).toBe(expectedCount);
}

async function releaseSupport(page: Page) {
  const support = page.locator('details', { hasText: 'Release support' });
  await expect(support).toHaveCount(1);
  if (!(await support.getAttribute('open'))) await support.locator('summary').click();
  return support;
}

async function featureChannel(page: Page, feature: string): Promise<string> {
  const featureText = page.getByText(feature, { exact: true });
  await expect(featureText).toHaveCount(1);
  return featureText.evaluate((element) => {
    let current: Element | null = element;
    while (current) {
      const text = current.textContent ?? '';
      const match = text.match(/\b(Standard|Experimental)\b/);
      if (match) return match[1];
      current = current.parentElement;
    }
    return '';
  });
}

function resourceSummaryValue(page: Page, label: string) {
  return page
    .locator('[aria-label="Resource summary"] dt', { hasText: label })
    .locator('xpath=following-sibling::dd[1]');
}

test('loads each pinned release and exposes catalog maturity boundaries', async ({ page }) => {
  await waitForEditor(page);

  const releases: Array<{
    id: '1.3' | '1.4' | '1.5' | '1.6';
    tag: string;
    listenerSet: 'XListenerSet' | 'ListenerSet';
    tcpVersions: string[];
  }> = [
    { id: '1.3', tag: 'v1.3.0', listenerSet: 'XListenerSet', tcpVersions: ['v1alpha2'] },
    { id: '1.4', tag: 'v1.4.1', listenerSet: 'XListenerSet', tcpVersions: ['v1alpha2'] },
    { id: '1.5', tag: 'v1.5.1', listenerSet: 'ListenerSet', tcpVersions: ['v1alpha2'] },
    { id: '1.6', tag: 'v1.6.2', listenerSet: 'ListenerSet', tcpVersions: ['v1alpha2', 'v1'] },
  ];

  for (const release of releases) {
    await selectVersion(page, release.id);
    await expect(auditStatus(page)).toHaveText(`CRD schema loaded · ${release.tag}`);
    const support = await releaseSupport(page);
    await expect(support).toContainText(release.tag);
    const tcpRouteRow = support.locator('tr', { has: page.getByText('TCPRoute', { exact: true }) });
    for (const version of release.tcpVersions) await expect(tcpRouteRow).toContainText(version);
    await expect(
      support.locator('tbody tr', { has: page.getByText(release.listenerSet, { exact: true }) }),
    ).toHaveCount(1);
  }

  await selectVersion(page, '1.4');
  expect(await featureChannel(page, 'HTTPRouteCORS')).toBe('Experimental');
  await selectVersion(page, '1.5');
  expect(await featureChannel(page, 'HTTPRouteCORS')).toBe('Standard');
  await expect(page.getByText('XBackend', { exact: true })).toHaveCount(0);
  await selectVersion(page, '1.6');
  await expect(page.getByText('XBackend', { exact: true })).toHaveCount(1);
  const support = await releaseSupport(page);
  await page.getByLabel('Filter features').fill('not-a-published-feature');
  await expect(support.getByText('No matching features', { exact: true })).toBeVisible();
  await page.getByLabel('Filter features').fill('HTTPRouteCORS');
  await expect(support.getByText('HTTPRouteCORS', { exact: true })).toBeVisible();
});

test('uses served versions rather than retained CRD schemas', async ({ page }) => {
  await waitForEditor(page);
  await selectVersion(page, '1.5');
  await setEditorValue(page, tcpRouteV1alpha2);
  await waitForSchemaMarkers(page, 0);

  await selectVersion(page, '1.6');
  await waitForSchemaMarkers(page, 0);

  await setEditorValue(page, tcpRouteV1alpha2.replace('/v1alpha2', '/v1'));
  await waitForSchemaMarkers(page, 0);

  await selectVersion(page, '1.5');
  await expect.poll(async () => yamlMarkers(await readMarkers(page)).length).toBeGreaterThan(0);

  await setEditorValue(page, tlsRouteV1);
  await waitForSchemaMarkers(page, 0);
  await selectVersion(page, '1.4');
  await expect.poll(async () => yamlMarkers(await readMarkers(page)).length).toBeGreaterThan(0);
});

test('audits Gateway API depth without constraining non-Gateway resources or JSON input', async ({
  page,
}) => {
  await waitForEditor(page);
  await setEditorValue(page, validMixedDocuments);
  await waitForSchemaMarkers(page, 0);

  await setEditorValue(page, gateway.replace('spec:', 'spec:\n  notInGatewayApi: true'));
  await expect
    .poll(async () =>
      yamlMarkers(await readMarkers(page)).some((marker) =>
        marker.message.includes('notInGatewayApi'),
      ),
    )
    .toBe(true);
  await expect(page.getByText(/CRD diagnostics: .*schema issue/)).toBeVisible();
  await expect(auditStatus(page)).toContainText('schema issue');

  await setEditorValue(
    page,
    `${validMixedDocuments}\n---\napiVersion: gateway.networking.k8s.io/v1\nkind: UnknownGatewayKind\nmetadata:\n  name: unknown\nspec: {}\n`,
  );
  await expect.poll(async () => yamlMarkers(await readMarkers(page)).length).toBeGreaterThan(0);

  const validJson = JSON.stringify({
    apiVersion: 'gateway.networking.k8s.io/v1',
    kind: 'Gateway',
    metadata: { name: 'json-gateway', annotations: { 'example.com/owner': 'platform' } },
    spec: {
      gatewayClassName: 'example',
      listeners: [{ name: 'http', protocol: 'HTTP', port: 80 }],
    },
  });
  await setEditorValue(page, validJson);
  await waitForSchemaMarkers(page, 0);
  await setEditorValue(page, validJson.replace('"gatewayClassName"', '"notInGatewayApi"'));
  await expect.poll(async () => yamlMarkers(await readMarkers(page)).length).toBeGreaterThan(0);
});

test('normalizes Kubernetes extensions for the real YAML worker', async ({ page }) => {
  await waitForEditor(page);
  const normalized = normalizeCrdSchema({
    type: 'object',
    properties: {
      maybe: { type: 'string', nullable: true },
      port: { 'x-kubernetes-int-or-string': true },
      labels: { type: 'object', additionalProperties: { type: 'string' } },
      extension: { type: 'object', 'x-kubernetes-preserve-unknown-fields': true },
    },
  });

  const results = await page.evaluate(async (schema) => {
    const globals = globalThis as typeof globalThis & {
      MonacoEnvironment: {
        getWorker: (moduleId: string, label: string) => Worker | Promise<Worker>;
      };
      monaco: typeof import('monaco-editor');
    };
    const { monaco, MonacoEnvironment } = globals;
    const worker = Promise.resolve(MonacoEnvironment.getWorker('workerMain.js', 'yaml')).then(
      (instance) => {
        instance.postMessage('-please-ignore-');
        instance.postMessage({
          enableSchemaRequest: false,
          validate: true,
          hover: true,
          completion: true,
          format: { enable: true },
          schemas: [{ uri: 'inmemory://normalization-schema.json', fileMatch: ['*'], schema }],
        });
        return instance;
      },
    );
    const client = monaco.editor.createWebWorker<
      Record<string, (...args: unknown[]) => Promise<Array<{ message: string }>>>
    >({ worker });
    const uri = monaco.Uri.parse('inmemory://normalization.yaml');
    const model = monaco.editor.createModel('', 'yaml', uri);
    const validate = async (value: string) => {
      model.setValue(value);
      const proxy = await client.withSyncedResources([uri]);
      return (await proxy.doValidation(String(uri))).length;
    };

    try {
      return {
        valid: await validate(
          `maybe: null\nport: 8080\nlabels:\n  team: platform\nextension:\n  arbitrary:\n    nested: true\n`,
        ),
        stringPort: await validate(
          `maybe: text\nport: named\nlabels:\n  team: platform\nextension:\n  arbitrary: true\n`,
        ),
        booleanPort: await validate(
          `maybe: null\nport: true\nlabels:\n  team: platform\nextension: {}\n`,
        ),
        numericLabel: await validate(
          `maybe: null\nport: 443\nlabels:\n  team: 42\nextension: {}\n`,
        ),
        unknownRoot: await validate(
          `maybe: null\nport: 443\nlabels: {}\nextension: {}\nunexpected: true\n`,
        ),
      };
    } finally {
      client.dispose();
      model.dispose();
    }
  }, normalized);

  expect(results.valid).toBe(0);
  expect(results.stringPort).toBe(0);
  expect(results.booleanPort).toBeGreaterThan(0);
  expect(results.numericLabel).toBeGreaterThan(0);
  expect(results.unknownRoot).toBeGreaterThan(0);
});

test('preserves editor state and applies only the newest concurrent release selection', async ({
  page,
}) => {
  let releaseDelayed: (() => void) | undefined;
  const delayedRelease = new Promise<void>((resolve) => {
    releaseDelayed = resolve;
  });
  let delayedRequests = 0;
  await page.route('**/gateway-api/v1.3.0.json', async (route) => {
    delayedRequests += 1;
    await delayedRelease;
    await route.continue();
  });

  await waitForEditor(page);
  await setEditorValue(page, gateway);
  await waitForSchemaMarkers(page, 0);
  const before = await page.evaluate(() => {
    const monaco = (globalThis as typeof globalThis & { monaco: typeof import('monaco-editor') })
      .monaco;
    const model = monaco.editor.getModels()[0];
    const editor = monaco.editor.getEditors()[0];
    if (!model || !editor) throw new Error('Monaco editor is missing');
    editor.setPosition({ lineNumber: 3, column: 5 });
    editor.setScrollTop(24);
    model.pushEditOperations(
      [],
      [{ range: model.getFullModelRange(), text: `${model.getValue()}# undoable\n` }],
      () => null,
    );
    return {
      uri: String(model.uri),
      value: model.getValue(),
      position: editor.getPosition(),
      scrollTop: editor.getScrollTop(),
    };
  });

  await requestVersion(page, '1.3');
  await expect.poll(() => delayedRequests).toBe(1);
  await requestVersion(page, '1.4');
  await requestVersion(page, '1.6');
  releaseDelayed?.();
  await expect(auditStatus(page)).toHaveAttribute('data-version', '1.6');
  await expect(auditStatus(page)).toHaveAttribute('data-state', 'ready');

  const after = await page.evaluate(() => {
    const monaco = (globalThis as typeof globalThis & { monaco: typeof import('monaco-editor') })
      .monaco;
    const model = monaco.editor.getModels()[0];
    const editor = monaco.editor.getEditors()[0];
    if (!model || !editor) throw new Error('Monaco editor is missing');
    const state = {
      uri: String(model.uri),
      value: model.getValue(),
      position: editor.getPosition(),
      scrollTop: editor.getScrollTop(),
    };
    editor.trigger('browser-test', 'undo', null);
    return { state, undoValue: model.getValue() };
  });
  expect(after.state).toEqual(before);
  expect(after.undoValue).toBe(gateway);
});

test('handles pre-initialization selection and rejects failed or malformed bundle loads until retry', async ({
  page,
}) => {
  let abortBundle = true;
  await page.route('**/gateway-api/v1.4.1.json', async (route) => {
    if (abortBundle) await route.abort();
    else await route.continue();
  });
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#gateway-api-version')).toBeVisible();
  await requestVersion(page, '1.4');
  await expect(auditStatus(page)).toHaveAttribute('data-version', '1.4');
  await expect(auditStatus(page)).toHaveAttribute('data-state', 'error');
  await expect(auditStatus(page)).toContainText('Could not load CRDs for Gateway API 1.4.');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();

  abortBundle = false;
  await page.unroute('**/gateway-api/v1.4.1.json');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(auditStatus(page)).toHaveAttribute('data-state', 'ready');
  await setEditorValue(page, gateway);
  await waitForSchemaMarkers(page, 0);
  await expect(page.locator('[aria-label="Resource summary"]')).toBeVisible();
  const manifestBeforeMalformedLoad = await page.evaluate(() => {
    const monaco = (globalThis as typeof globalThis & { monaco: typeof import('monaco-editor') })
      .monaco;
    return monaco.editor.getModels()[0]?.getValue();
  });

  await page.route('**/gateway-api/v1.3.0.json', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ id: '1.3', tag: 'wrong', crds: [], schema: {} }),
    }),
  );
  await requestVersion(page, '1.3');
  await expect(auditStatus(page)).toHaveAttribute('data-state', 'error');
  await expect(auditStatus(page)).toContainText('Could not load CRDs for Gateway API 1.3.');
  await expect(page.locator('[aria-label="Resource summary"]')).toBeVisible();
  expect(
    await page.evaluate(() => {
      const monaco = (globalThis as typeof globalThis & { monaco: typeof import('monaco-editor') })
        .monaco;
      return monaco.editor.getModels()[0]?.getValue();
    }),
  ).toBe(manifestBeforeMalformedLoad);
});

test('keeps release fetches same-origin and never transmits manifest input', async ({
  page,
}, testInfo) => {
  const requests: Array<{ url: string; postData: string | null }> = [];
  page.on('request', (request) =>
    requests.push({ url: request.url(), postData: request.postData() }),
  );
  await waitForEditor(page);
  await setEditorValue(page, `${gateway}# private manifest text: do-not-send\n`);
  await selectVersion(page, '1.3');
  await selectVersion(page, '1.6');

  const bundleRequests = requests.filter(({ url }) => url.includes('/gateway-api/'));
  expect(bundleRequests.length).toBeGreaterThan(0);
  expect(
    bundleRequests.every(({ url }) => new URL(url).origin === new URL(page.url()).origin),
  ).toBe(true);
  expect(requests.some(({ url }) => /github\.com|api\.github\.com/.test(url))).toBe(false);
  expect(requests.every(({ postData }) => !postData?.includes('private manifest text'))).toBe(true);
  if (testInfo.project.name === 'production') {
    expect(
      bundleRequests.every(({ url }) =>
        new URL(url).pathname.startsWith('/gateway-api-visualizer/gateway-api/'),
      ),
    ).toBe(true);
  }
});

test('inserts each version-aware sample without rewriting it after a release change', async ({
  page,
}) => {
  await waitForEditor(page);
  await page.locator('select[title="Choose sample dataset"]').selectOption('basic');
  await page.locator('button[title="Load selected sample YAML"]').click();
  await expect(resourceSummaryValue(page, 'Gateways')).toHaveText('1');
  await page.locator('.route-coverage__resource').first().click();
  await expect(page.locator('#resource-details-heading')).toBeFocused();
  await expect(resourceSummaryValue(page, 'Routes')).toHaveText('3');
  await expect(resourceSummaryValue(page, 'With parent refs')).toHaveText('2');
  await waitForSchemaMarkers(page, 0);

  for (const version of ['1.3', '1.4', '1.5', '1.6'] as const) {
    await selectVersion(page, version);
    await page.locator('select[title="Choose sample dataset"]').selectOption('multi');
    await page.locator('button[title="Load selected sample YAML"]').click();
    await expect(resourceSummaryValue(page, 'Gateways')).toHaveText('3');
    await expect(resourceSummaryValue(page, 'Routes')).toHaveText('20');
    await expect(resourceSummaryValue(page, 'With parent refs')).toHaveText('17');
    await waitForSchemaMarkers(page, 0);
    await page.getByLabel('Inspect resource', { exact: true }).selectOption({ index: 1 });
    await expect(page.locator('#resource-details-heading')).toBeFocused();
  }

  const beforeVersionChange = await page.evaluate(() => {
    const monaco = (globalThis as typeof globalThis & { monaco: typeof import('monaco-editor') })
      .monaco;
    return monaco.editor.getModels()[0]?.getValue();
  });
  await selectVersion(page, '1.3');
  const afterVersionChange = await page.evaluate(() => {
    const monaco = (globalThis as typeof globalThis & { monaco: typeof import('monaco-editor') })
      .monaco;
    return monaco.editor.getModels()[0]?.getValue();
  });
  expect(afterVersionChange).toBe(beforeVersionChange);
  await expect.poll(async () => yamlMarkers(await readMarkers(page)).length).toBeGreaterThan(0);
});

test('supports keyboard entry, editor escape, and return from resource inspection', async ({
  page,
}) => {
  await waitForEditor(page);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await skip.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();

  await setEditorValue(page, validMixedDocuments);
  const resource = page.locator('.route-coverage__resource').first();
  await resource.focus();
  await resource.press('Enter');
  await expect(page.locator('#resource-details-heading')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(resource).toBeFocused();
  await expect(page.getByRole('complementary', { name: 'Resource details' })).toHaveCount(0);

  const editor = page.getByRole('textbox', { name: 'Manifest YAML or JSON editor' });
  await editor.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('searchbox', { name: 'Search', exact: true })).toBeFocused();
});

test('keeps graph and editor usable at narrow widths with expanded diagnostics', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await waitForEditor(page);
  await setEditorValue(page, validMixedDocuments);
  const graph = page.getByRole('img', { name: /Relationship graph/ });
  await expect(graph).toBeVisible();
  expect((await graph.boundingBox())!.height).toBeGreaterThanOrEqual(320);
  const controls = await page
    .getByRole('group', { name: 'Relationship graph controls' })
    .boundingBox();
  expect((await graph.boundingBox())!.y).toBeGreaterThanOrEqual(controls!.y + controls!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await setEditorValue(page, 'kind: [\n');
  const parserToggle = page.getByRole('button', { name: /YAML parser error/ });
  await expect(parserToggle).toBeVisible();
  await expect(page.getByRole('button', { name: /CRD diagnostics:/ })).toBeVisible();
  const editor = page.locator('.monaco-editor');
  await expect(editor).toBeVisible();
  expect((await editor.boundingBox())!.height).toBeGreaterThanOrEqual(240);
  const region = await page.getByRole('region', { name: 'Manifest', exact: true }).boundingBox();
  const editorBox = (await editor.boundingBox())!;
  expect(editorBox.y + editorBox.height).toBeLessThanOrEqual(region!.y + region!.height);

  await parserToggle.focus();
  expect(
    await parserToggle.evaluate((el) => {
      const style = getComputedStyle(el);
      return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2;
    }),
  ).toBe(true);
  await parserToggle.press('Enter');
  await expect(parserToggle).toHaveAttribute('aria-expanded', 'false');
  await parserToggle.press('Enter');
  await expect(parserToggle).toHaveAttribute('aria-expanded', 'true');

  const schemaToggle = page.getByRole('button', { name: /CRD diagnostics:/ });
  await schemaToggle.press('Enter');
  await expect(schemaToggle).toHaveAttribute('aria-expanded', 'false');
  await schemaToggle.press('Enter');
  await expect(schemaToggle).toHaveAttribute('aria-expanded', 'true');
});

test('maintains AA input-boundary contrast in both themes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await waitForEditor(page);
  for (const theme of ['light', 'dark']) {
    const current = await page.locator('html').getAttribute('data-theme');
    if (current !== theme) await page.getByRole('button', { name: /Switch to .* mode/ }).click();
    const contrast = await page.locator('#route-search').evaluate((el) => {
      const context = document.createElement('canvas').getContext('2d')!;
      const luminance = (color: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        const rgb = Array.from(context.getImageData(0, 0, 1, 1).data)
          .slice(0, 3)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const style = getComputedStyle(el);
      const border = luminance(style.borderColor);
      const background = luminance(style.backgroundColor);
      return (Math.max(border, background) + 0.05) / (Math.min(border, background) + 0.05);
    });
    expect(contrast).toBeGreaterThanOrEqual(3);
  }
});
