import { expect, test } from '@playwright/test';
import { exposeMonaco, waitForEditor } from './editor.js';

const proposedManifest = `apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: agent-proposed
  namespace: default
spec:
  gatewayClassName: example
  listeners:
    - name: http
      protocol: HTTP
      port: invalid-port
`;

test('registers WebMCP tools and requires approval before replacing the manifest', async ({
  page,
}) => {
  await exposeMonaco(page);
  await page.addInitScript(() => {
    const tools: Record<
      string,
      {
        execute(input?: unknown, options?: { signal?: AbortSignal }): unknown | Promise<unknown>;
      }
    > = {};
    const modelContext = {
      async registerTool(
        tool: { name: string },
        options?: { signal?: AbortSignal },
      ): Promise<void> {
        tools[tool.name] = tool as (typeof tools)[string];
        options?.signal?.addEventListener('abort', () => delete tools[tool.name], { once: true });
      },
    };
    Object.defineProperty(Document.prototype, 'modelContext', {
      configurable: true,
      get: () => modelContext,
    });
    Object.assign(globalThis, {
      __webMcpTools: tools,
      __webMcpResult: null,
    });
  });

  await waitForEditor(page);
  await expect(page.locator('.agent-status')).toHaveText('LLM tools: available');
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(
          (
            globalThis as typeof globalThis & {
              __webMcpTools: Record<string, unknown>;
            }
          ).__webMcpTools,
        ).sort(),
      ),
    )
    .toEqual([
      'get_gateway_audit',
      'inspect_gateway_resource',
      'propose_manifest_audit',
      'query_gateway_resources',
      'set_graph_view',
    ]);

  const releaseForm = page.locator('form[toolname="select_gateway_api_version"]');
  await expect(releaseForm).toHaveAttribute('tooldescription', /user review/);
  await expect(releaseForm).not.toHaveAttribute('toolautosubmit', '');
  await expect(releaseForm.getByRole('button', { name: 'Apply release' })).toBeVisible();

  await page.evaluate((manifest) => {
    const scope = globalThis as typeof globalThis & {
      __webMcpTools: Record<string, { execute(input?: unknown): unknown | Promise<unknown> }>;
      __webMcpResult: unknown;
    };
    const request = scope.__webMcpTools.propose_manifest_audit.execute({
      manifest,
      version: '1.4',
    });
    void Promise.resolve(request).then((result) => {
      scope.__webMcpResult = result;
    });
  }, proposedManifest);

  const proposal = page.locator('.agent-proposal');
  await expect(proposal).toContainText('Replace manifest and audit');
  await expect(proposal).toContainText('Gateway API 1.4');
  await proposal.getByText('Review proposed manifest').click();
  await expect(proposal.locator('pre')).toHaveText(proposedManifest);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const monaco = (
          globalThis as typeof globalThis & { monaco: typeof import('monaco-editor') }
        ).monaco;
        return monaco.editor.getModels()[0]?.getValue() ?? '';
      }),
    )
    .toBe('');

  await proposal.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByTestId('gateway-api-status')).toHaveAttribute('data-version', '1.4');
  await expect(page.getByTestId('gateway-api-status')).toHaveAttribute('data-state', 'ready');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const monaco = (
          globalThis as typeof globalThis & { monaco: typeof import('monaco-editor') }
        ).monaco;
        return monaco.editor.getModels()[0]?.getValue() ?? '';
      }),
    )
    .toBe(proposedManifest);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              __webMcpResult: {
                status?: string;
                compatibility?: { diagnosticCount?: number };
              } | null;
            }
          ).__webMcpResult?.status,
      ),
    )
    .toBe('applied');
  const proposalDiagnosticCount = await page.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          __webMcpResult: { compatibility?: { diagnosticCount?: number } };
        }
      ).__webMcpResult.compatibility?.diagnosticCount ?? 0,
  );
  expect(proposalDiagnosticCount).toBeGreaterThan(0);

  const audit = await page.evaluate(async () => {
    const tools = (
      globalThis as typeof globalThis & {
        __webMcpTools: Record<string, { execute(input?: unknown): unknown | Promise<unknown> }>;
      }
    ).__webMcpTools;
    return tools.get_gateway_audit.execute({});
  });
  expect(audit).toMatchObject({
    release: { version: '1.4', status: 'ready' },
    graph: { summary: { gateways: 1 } },
    privacy: 'Manifest analysis runs locally in this browser tab.',
  });
  if (!audit || typeof audit !== 'object' || !('compatibility' in audit)) {
    throw new Error('WebMCP audit result is missing compatibility data.');
  }
  const compatibility = audit.compatibility;
  if (!compatibility || typeof compatibility !== 'object' || !('diagnosticCount' in compatibility)) {
    throw new Error('WebMCP audit result is missing its diagnostic count.');
  }
  expect(compatibility.diagnosticCount).toEqual(expect.any(Number));
  expect(Number(compatibility.diagnosticCount)).toBeGreaterThan(0);
});

test('keeps the normal workbench available without native WebMCP', async ({ page }) => {
  await exposeMonaco(page);
  await waitForEditor(page);

  await expect(page.locator('.agent-status')).toHaveText('LLM tools: browser unsupported');
  await expect(page.getByRole('heading', { name: 'Manifest' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Relationships', exact: true })).toBeVisible();

  const discoveryLink = page.locator('link[rel="llms-txt"]');
  await expect(discoveryLink).toHaveAttribute('type', 'text/plain');
  const advertisedUrl = await discoveryLink.getAttribute('href');
  if (!advertisedUrl) throw new Error('The llms.txt discovery link has no href.');
  const resolvedUrl = new URL(advertisedUrl, page.url());
  expect(resolvedUrl.pathname).toBe(new URL('llms.txt', page.url()).pathname);
  await expect(page.getByRole('link', { name: 'llms.txt' })).toHaveAttribute(
    'href',
    advertisedUrl,
  );

  const llmsResponse = await page.request.get(resolvedUrl.href);
  expect(llmsResponse.ok()).toBe(true);
  await expect(llmsResponse.text()).resolves.toContain('### propose_manifest_audit');
});
