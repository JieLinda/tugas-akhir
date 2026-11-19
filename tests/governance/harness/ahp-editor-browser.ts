// Mounts the REAL AhpMatrixEditor in headless Chromium so tests can click,
// drag and type the way a user does. The component is bundled with the esbuild
// that tsx already depends on; the one server action it imports is replaced by
// a no-op, because these tests exercise the editor, never the database.
//
// Needs the pre-installed Playwright + Chromium (require('playwright')).
import path from 'node:path';
import { createRequire } from 'node:module';

// Playwright is the machine-installed tool (see the session's pre-installed
// Chromium), and esbuild is tsx's own dependency — neither is a dependency of
// this package, so neither ships types here. The harness only uses a handful
// of calls on each; typing them loosely keeps tsc at its baseline.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Browser = any;
type Page = any;

const ROOT = path.resolve(__dirname, '../../..');
const ENTRY = `
import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AhpMatrixEditor } from '@/components/governance/governance-ahp-editor';

function Harness({ initial }: { initial: { pairwise: number[][] } | null }) {
  const [value, setValue] = useState(initial);
  (window as any).__ahpValue = value;
  return createElement(AhpMatrixEditor, {
    value,
    onChange: (next: any) => {
      (window as any).__ahpChanges = ((window as any).__ahpChanges ?? 0) + 1;
      (window as any).__ahpValue = next;
      setValue(next);
    },
    templateId: 'tpl-test',
  });
}

(window as any).__mount = (pairwise: number[][] | null) => {
  createRoot(document.getElementById('root')!).render(
    createElement(Harness, { initial: pairwise ? { pairwise } : null }),
  );
};
`;

let bundled: string | null = null;

async function bundle(): Promise<string> {
  if (bundled) return bundled;
  const esbuild: any = createRequire(require.resolve('tsx/package.json'))('esbuild');
  const out = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: 'tsx', sourcefile: 'ahp-harness-entry.tsx' },
    absWorkingDir: ROOT,
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"development"' },
    plugins: [
      {
        name: 'stub-server-actions',
        setup(build: any) {
          build.onResolve({ filter: /(^|\/)lib\/program-actions$/ }, () => ({ path: 'program-actions', namespace: 'stub' }));
          build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents:
              'export async function saveAhpConfigAction(templateId, value) { window.__ahpSaved = JSON.parse(JSON.stringify({ templateId, value })); }',
            loader: 'js',
          }));
        },
      },
    ],
  });
  const text: string = out.outputFiles[0]!.text;
  bundled = text;
  return text;
}

export type EditorSession = { browser: Browser; page: Page; close: () => Promise<void> };

export async function openEditor(pairwise: number[][] | null): Promise<EditorSession> {
  const { chromium } = require('playwright');
  const js = await bundle();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  const errors: string[] = [];
  page.on('pageerror', (e: unknown) => errors.push(String(e)));
  await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
  await page.addScriptTag({ content: js });
  await page.evaluate((m: number[][] | null) => (window as any).__mount(m), pairwise);
  await page.getByRole('button', { name: /Simpan Bobot AHP|Atur Bobot AHP/ }).waitFor();
  if (errors.length) throw new Error(`editor crashed: ${errors.join('; ')}`);
  return { browser, page, close: () => browser.close() };
}

/** The matrix the editor currently holds (what a save would send). */
export async function storedMatrix(page: Page): Promise<number[][] | null> {
  return page.evaluate(() => (window as any).__ahpValue?.pairwise ?? null);
}

export type MatrixCell = { row: string; col: string; text: string; upper: boolean };

/** Switch the pairwise mode to its "Matriks" view and read every cell as shown. */
export async function readMatrixView(page: Page): Promise<{ order: string[]; cells: MatrixCell[] }> {
  if (!(await page.locator('table').count())) {
    await page.getByRole('button', { name: 'Berpasangan' }).click();
    await page.getByRole('button', { name: 'Matriks' }).click();
  }
  return page.evaluate(() => {
    const table = document.querySelector('table')!;
    const order = [...table.querySelectorAll('thead th')].slice(1).map((th) => th.textContent!.trim());
    const cells: { row: string; col: string; text: string; upper: boolean }[] = [];
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const tds = [...tr.querySelectorAll('td')];
      const row = tds[0]!.textContent!.trim();
      tds.slice(1).forEach((td, j) => {
        const input = td.querySelector('input');
        const text = input ? `${td.textContent!.trim()}${input.value}` : td.textContent!.trim();
        cells.push({ row, col: order[j]!, text, upper: !!input });
      });
    });
    return { order, cells };
  });
}

/** Drag a matrix column header (display order only) from one position to another. */
export async function dragMatrixHeader(page: Page, from: number, to: number): Promise<void> {
  const heads = page.locator('thead th div[draggable="true"]');
  await heads.nth(from).dragTo(heads.nth(to));
}

/** How many times the editor called onChange (every write, even an idempotent one). */
export async function changeCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__ahpChanges ?? 0);
}

/** What the stubbed saveAhpConfigAction received, or null when Save was not pressed. */
export async function savedPayload(page: Page): Promise<{ templateId: string; value: { pairwise: number[][] } | null } | null> {
  return page.evaluate(() => (window as any).__ahpSaved ?? null);
}

export async function switchMode(page: Page, mode: 'Urutan' | 'Slider' | 'Berpasangan'): Promise<void> {
  await page.getByRole('button', { name: new RegExp(`${mode}$`) }).click();
}

export async function switchPairView(page: Page, view: 'Daftar' | 'Matriks'): Promise<void> {
  await switchMode(page, 'Berpasangan');
  await page.getByRole('button', { name: view }).click();
}

/** The Daftar view: every row as (heavier label, lighter label, shown text). */
export async function readListView(page: Page): Promise<{ hi: string; lo: string; text: string }[]> {
  await switchPairView(page, 'Daftar');
  return page.locator('input[title^="Seberapa kali "]').evaluateAll((els: HTMLInputElement[]) =>
    els.map((e) => {
      const m = /^Seberapa kali (.+) lebih penting dari (.+) \(1-9\)$/.exec(e.getAttribute('title') ?? '')!;
      return { hi: m[1]!, lo: m[2]!, text: e.value };
    }),
  );
}

/** The Slider mode: aria position and the weight read-out per criterion key. */
export async function readSliders(page: Page): Promise<Record<string, { pos: number; text: string }>> {
  await switchMode(page, 'Slider');
  return page.locator('[data-slider]').evaluateAll((rows: HTMLElement[]) =>
    Object.fromEntries(
      rows.map((r) => [
        r.dataset.slider!,
        {
          pos: Number(r.querySelector('[role="slider"]')!.getAttribute('aria-valuenow')),
          text: r.querySelector('[data-weight]')!.childNodes[0]!.textContent!.trim(),
        },
      ]),
    ),
  );
}

/** The Urutan mode: criterion keys top to bottom with their rank text ("2" or "2 ="). */
export async function readOrder(page: Page): Promise<{ key: string; rank: string }[]> {
  await switchMode(page, 'Urutan');
  return page.locator('[data-testid="ahp-order-list"] [data-criterion]').evaluateAll((rows: HTMLElement[]) =>
    rows.map((r) => ({ key: r.dataset.criterion!, rank: r.querySelector('[data-rank]')!.textContent!.trim() })),
  );
}

export async function readBadge(page: Page): Promise<string> {
  return (await page.getByTestId('ahp-cr-badge').textContent())!.trim();
}

export async function readNotice(page: Page): Promise<string | null> {
  const n = page.getByTestId('ahp-notice');
  return (await n.count()) ? (await n.textContent())!.trim() : null;
}
