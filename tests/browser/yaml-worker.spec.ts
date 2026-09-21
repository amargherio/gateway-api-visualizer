import { expect, test } from '@playwright/test';
import { exposeMonaco, readMarkers, setEditorValue, waitForEditor, yamlMarkers } from './editor.js';

function resourceSummaryValue(page: import('@playwright/test').Page, label: string) {
  return page
    .locator('[aria-label="Resource summary"] dt', { hasText: label })
    .locator('xpath=following-sibling::dd[1]');
}

const validYaml = `apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: worker-smoke
spec:
  gatewayClassName: example
  listeners:
    - name: web
      port: 80
      protocol: HTTP
`;

const schemaInvalidYaml = validYaml.replace('name: worker-smoke', 'name: 123');
const syntaxInvalidYaml = `apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: [broken
`;

test.beforeEach(async ({ page }) => {
  await exposeMonaco(page);
});

test('worker reports syntax and schema errors and recovers', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await waitForEditor(page);

  await setEditorValue(page, schemaInvalidYaml);
  await expect
    .poll(async () => {
      const markers = await readMarkers(page);
      return (
        yamlMarkers(markers).some((marker) => marker.startLineNumber === 4) &&
        !markers.some((marker) => marker.owner === 'yaml-validation')
      );
    })
    .toBe(true);
  await expect(page.locator('.squiggly-warning, .squiggly-error')).not.toHaveCount(0);

  await setEditorValue(page, validYaml);
  await expect.poll(async () => yamlMarkers(await readMarkers(page))).toEqual([]);
  await expect(page.locator('.squiggly-warning, .squiggly-error')).toHaveCount(0);

  await setEditorValue(page, syntaxInvalidYaml);
  await expect
    .poll(async () => yamlMarkers(await readMarkers(page)).some((marker) => marker.severity === 8))
    .toBe(true);

  await setEditorValue(page, validYaml);
  await expect.poll(async () => yamlMarkers(await readMarkers(page))).toEqual([]);

  expect(runtimeErrors).toEqual([]);
});

test('worker accepts the shipped multi-gateway YAML', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await waitForEditor(page);
  await page.locator('select[title="Choose sample dataset"]').selectOption('multi');
  await page.locator('button[title="Load selected sample YAML"]').click();

  await expect(resourceSummaryValue(page, 'Gateways')).toHaveText('3');
  await expect(resourceSummaryValue(page, 'Routes')).toHaveText('20');
  await expect(resourceSummaryValue(page, 'With parent refs')).toHaveText('17');
  await expect(page.locator('.route-coverage tbody tr')).toHaveCount(20);
  await expect.poll(async () => yamlMarkers(await readMarkers(page))).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});

test('worker initializes through a promise-returning factory', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });
  await page.addInitScript(() => {
    (globalThis as typeof globalThis & { __promiseMonacoWorker?: boolean }).__promiseMonacoWorker =
      true;
  });

  await waitForEditor(page);
  await setEditorValue(page, schemaInvalidYaml);
  await expect
    .poll(async () =>
      yamlMarkers(await readMarkers(page)).some((marker) => marker.startLineNumber === 4),
    )
    .toBe(true);
  await setEditorValue(page, validYaml);
  await expect.poll(async () => yamlMarkers(await readMarkers(page))).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});

test('worker preserves hover, completion, and formatting services', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text());
  });

  await waitForEditor(page);
  const result = await page.evaluate(async () => {
    const globals = globalThis as typeof globalThis & {
      MonacoEnvironment: {
        getWorker: (moduleId: string, label: string) => Worker | Promise<Worker>;
      };
      monaco: typeof import('monaco-editor');
    };
    const { monaco, MonacoEnvironment } = globals;
    const workerData = {
      enableSchemaRequest: false,
      validate: true,
      hover: true,
      completion: true,
      format: { enable: true },
      schemas: [
        {
          uri: 'inmemory://migration-smoke-schema.json',
          fileMatch: ['*'],
          schema: {
            type: 'object',
            properties: { name: { type: 'string', description: 'Worker smoke name' } },
          },
        },
      ],
    };
    const nativeWorker = MonacoEnvironment.getWorker('workerMain.js', 'yaml');
    const readyWorker = Promise.resolve(nativeWorker).then((worker) => {
      worker.postMessage('-please-ignore-');
      worker.postMessage(workerData);
      return worker;
    });
    const client = monaco.editor.createWebWorker<
      Record<string, (...args: unknown[]) => Promise<unknown>>
    >({ worker: readyWorker });
    const uri = monaco.Uri.parse('inmemory://migration-smoke.yaml');
    const model = monaco.editor.createModel('name: worker-smoke\n', 'yaml', uri);

    try {
      let proxy = await client.withSyncedResources([uri]);
      const hover = (await proxy.doHover(String(uri), { line: 0, character: 2 })) as
        | { contents?: unknown }
        | undefined;

      model.setValue('');
      proxy = await client.withSyncedResources([uri]);
      const completion = (await proxy.doComplete(String(uri), { line: 0, character: 0 })) as
        | { items?: Array<{ label?: string }> }
        | undefined;

      model.setValue('name:    worker-smoke\n');
      proxy = await client.withSyncedResources([uri]);
      const edits = (await proxy.format(String(uri))) as
        | Array<{
            newText: string;
            range: {
              start: { line: number; character: number };
              end: { line: number; character: number };
            };
          }>
        | undefined;
      if (edits) {
        model.applyEdits(
          edits.map((edit) => ({
            range: new monaco.Range(
              edit.range.start.line + 1,
              edit.range.start.character + 1,
              edit.range.end.line + 1,
              edit.range.end.character + 1,
            ),
            text: edit.newText,
          })),
        );
      }

      return {
        hover: JSON.stringify(hover?.contents ?? null),
        labels: completion?.items?.map((item) => item.label) ?? [],
        formatted: model.getValue(),
      };
    } finally {
      client.dispose();
      model.dispose();
    }
  });

  expect(result.hover).toContain('Worker smoke name');
  expect(result.labels).toContain('name');
  expect(result.formatted).toBe('name: worker-smoke\n');
  expect(runtimeErrors).toEqual([]);
});
