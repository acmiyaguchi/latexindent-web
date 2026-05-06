import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examples = JSON.parse(
  readFileSync(join(__dirname, '../src/examples-catalog.json'), 'utf8'),
);

const FLAG_IDS = [
  'mlb',
  'replace',
  'only-replace',
  'replace-verb',
  'silent',
  'trace',
  'only-default',
  'check',
];

const filter = process.env.MATRIX_FILTER;
const entries = Object.entries(examples).filter(
  ([id, e]) => !filter || id.includes(filter) || e.input.includes(filter),
);

const norm = (s) =>
  s.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\s+$/, '');

const ready = async (page) => {
  await page.goto('/');
  await expect(page.locator('#run')).toBeEnabled({ timeout: 60_000 });
};

for (const [id, ex] of entries) {
  test(`${ex.input} → ${id}`, async ({ page, request }) => {
    await ready(page);

    // Picking the input fires its change handler, which auto-selects and
    // dispatches change on the first variant. Then we select the exact
    // catalog id we want.
    await page.selectOption('#examples-input', ex.input);
    await page.selectOption('#examples-variant', id);

    // The variant change handler is async (fetches input + yamls). Wait for
    // its observable side effects — the yaml checkbox and flag checkboxes —
    // to match what the catalog entry says they should be.
    await expect(page.locator('#use-yaml')).toBeChecked({
      checked: ex.yamls.length > 0,
    });
    const wantedFlags = new Set(ex.flags ?? []);
    for (const flag of FLAG_IDS) {
      await expect(page.locator(`#use-${flag}`)).toBeChecked({
        checked: wantedFlags.has(flag),
      });
    }

    await page.click('#run');
    await expect(page.locator('#status')).toHaveText(/Done\.|Failed\./, {
      timeout: 60_000,
    });

    const stderr = await page.locator('#stderr').innerText();
    expect(stderr).toContain('[exit 0]');
    // Standard Perl warn/die signatures, explicit FATAL/ERROR/WARNING, and
    // YAML::Tiny "duplicate key" warnings (concatenating multiple yamls into
    // /app/localSettings.yaml can collide on top-level keys — silently
    // dropping one would mask a real config bug).
    expect(stderr).not.toMatch(
      /\b(?:FATAL|ERROR|WARNING)\b|Use of uninitialized value|undefined value|at \S+ line \d+|duplicate key/i,
    );

    const expectedResp = await request.get(`/examples/${ex.output}`);
    expect(
      expectedResp.ok(),
      `expected output file missing: ${ex.output}`,
    ).toBe(true);
    const expected = await expectedResp.text();
    // `.cm-content` `innerText` doubles blank lines on Chromium. Read the
    // per-line `.cm-line` children instead — that's the canonical doc
    // structure, one element per logical line.
    const actual = await page.locator('#output-host').evaluate((host) =>
      [...host.querySelectorAll('.cm-line')].map((d) => d.textContent).join('\n'),
    );
    expect(norm(actual)).toEqual(norm(expected));
  });
}
