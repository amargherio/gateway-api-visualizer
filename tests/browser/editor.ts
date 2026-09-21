import { expect, type Page } from '@playwright/test';

export type BrowserMarker = {
  owner: string;
  message: string;
  startLineNumber: number;
  severity: number;
};

export async function exposeMonaco(page: Page): Promise<void> {
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

export async function waitForEditor(page: Page, waitForAudit = true): Promise<void> {
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

  if (waitForAudit) {
    await expect(page.getByTestId('gateway-api-status')).toHaveAttribute('data-state', 'ready');
  }
}

export async function setEditorValue(page: Page, value: string): Promise<void> {
  await page.evaluate((nextValue) => {
    const monaco = (globalThis as typeof globalThis & { monaco: typeof import('monaco-editor') })
      .monaco;
    const model = monaco.editor.getModels()[0];
    if (!model) throw new Error('Monaco editor model is missing');
    model.setValue(nextValue);
  }, value);
}

export async function readMarkers(page: Page): Promise<BrowserMarker[]> {
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

export function yamlMarkers(markers: BrowserMarker[]): BrowserMarker[] {
  return markers.filter((marker) => marker.owner === 'yaml');
}
