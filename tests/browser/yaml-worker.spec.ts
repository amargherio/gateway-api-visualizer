import { expect, test, type Page } from '@playwright/test';

type BrowserMarker = {
  owner: string;
  message: string;
  startLineNumber: number;
  severity: number;
};

const validYaml = `apiVersion: gateway.networking.k8s.io/v1beta1
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
const syntaxInvalidYaml = `apiVersion: gateway.networking.k8s.io/v1beta1
kind: Gateway
metadata:
  name: [broken
`;

async function exposeMonaco(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const environment: Record<string, unknown> = { globalAPI: true };
    Object.defineProperty(globalThis, 'MonacoEnvironment', {
      configurable: true,
      get: () => environment,
      set: (value: Record<string, unknown>) => {
        if (
          (globalThis as typeof globalThis & { __promiseMonacoWorker?: boolean })
            .__promiseMonacoWorker &&
          typeof value.getWorker === 'function'
        ) {
          const getWorker = (value.getWorker as (...args: unknown[]) => Worker).bind(value);
          value.getWorker = (...args: unknown[]) => Promise.resolve(getWorker(...args));
        }
        Object.assign(environment, value);
        environment.globalAPI = true;
      },
    });
  });
}

async function waitForEditor(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.locator('.monaco-editor')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const monaco = (
          globalThis as typeof globalThis & { monaco?: typeof import('monaco-editor') }
        ).monaco;
        return monaco?.editor.getModels().length ?? 0;
      }),
    )
    .toBe(1);
}

async function setEditorValue(page: Page, value: string): Promise<void> {
  await page.evaluate((nextValue) => {
    const monaco = (globalThis as typeof globalThis & { monaco: typeof import('monaco-editor') })
      .monaco;
    const model = monaco.editor.getModels()[0];
    if (!model) throw new Error('Monaco editor model is missing');
    model.setValue(nextValue);
  }, value);
}

async function readMarkers(page: Page): Promise<BrowserMarker[]> {
  return page.evaluate(() => {
    const monaco = (globalThis as typeof globalThis & { monaco: typeof import('monaco-editor') })
      .monaco;
    const model = monaco.editor.getModels()[0];
    if (!model) throw new Error('Monaco editor model is missing');
    return monaco.editor.getModelMarkers({ resource: model.uri }).map((marker) => ({
      owner: marker.owner,
      message: marker.message,
      startLineNumber: marker.startLineNumber,
      severity: marker.severity,
    }));
  });
}

function yamlMarkers(markers: BrowserMarker[]): BrowserMarker[] {
  return markers.filter((marker) => marker.owner === 'yaml');
}

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

  await expect(
    page
      .locator('.stat')
      .filter({ has: page.getByText('Gateways', { exact: true }) })
      .locator('.stat-value'),
  ).toHaveText('3');
  await expect(
    page
      .locator('.stat')
      .filter({ has: page.getByText('Routes', { exact: true }) })
      .locator('.stat-value'),
  ).toHaveText('20');
  await expect(
    page
      .locator('.stat')
      .filter({ has: page.getByText('Covered Routes', { exact: true }) })
      .locator('.stat-value'),
  ).toHaveText('17');
  await expect(page.locator('tbody tr')).toHaveCount(20);
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
