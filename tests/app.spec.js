import { test, expect } from '@playwright/test';

const ready = async (page) => {
  await page.goto('/');
  await expect(page.locator('#run')).toBeEnabled({ timeout: 60_000 });
  // The YAML editor lives inside a collapsed <details> by default.
  // Tests that interact with it need it open.
  await page.locator('#yaml-section').evaluate((el) => {
    el.open = true;
  });
};

const yamlText = (page) =>
  page.locator('#yaml-host .cm-content').innerText();
const inputText = (page) =>
  page.locator('#input-host .cm-content').innerText();
const outputText = (page) =>
  page.locator('#output-host .cm-content').innerText();

const runAndWait = async (page) => {
  await page.click('#run');
  await expect(page.locator('#status')).toHaveText(/Done\.|Failed\./, {
    timeout: 60_000,
  });
};

test('page loads, version + build time visible', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#version-line')).toContainText('latexindent.pl');
  await expect(page.locator('#build-time')).toHaveText(
    /\d{4}-\d{2}-\d{2}T/,
  );
});

test('selecting an example with YAML populates both editors and -l', async ({
  page,
}) => {
  await ready(page);
  await page.selectOption('#examples', { label: 'align — alignment delimiters' });
  await expect(page.locator('#yaml-host .cm-content')).toContainText(
    'lookForAlignDelims',
  );
  await expect(page.locator('#use-yaml')).toBeChecked();
  await expect(page.locator('#use-mlb')).not.toBeChecked();
  await expect(page.locator('#input-host .cm-content')).toContainText(
    '\\begin{align}',
  );
});

test('selecting a -m example also checks the -m box', async ({ page }) => {
  await ready(page);
  await page.selectOption('#examples', {
    label: 'text wrap, 20 columns (-m)',
  });
  await expect(page.locator('#use-yaml')).toBeChecked();
  await expect(page.locator('#use-mlb')).toBeChecked();
});

test('clearing YAML then switching to a no-YAML example restores the seed', async ({
  page,
}) => {
  await ready(page);
  // Load a YAML-bearing example first.
  await page.selectOption('#examples', { label: 'align — alignment delimiters' });
  await expect(page.locator('#yaml-host .cm-content')).toContainText(
    'lookForAlignDelims',
  );
  // Clear the YAML editor.
  await page.click('#yaml-host .cm-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await expect(page.locator('#yaml-host .cm-content')).toHaveText(/^\s*$/);
  // Switch to an example that has no YAML — pane should NOT stay blank.
  // Selecting fires an async fetch in the change handler, so we use
  // a polling assertion here rather than a one-shot read.
  await page.selectOption('#examples', { label: 'itemize (default rules)' });
  await expect(page.locator('#yaml-host .cm-content')).toContainText(
    'defaultIndent',
  );
  await expect(page.locator('#use-yaml')).not.toBeChecked();
});

test('-m checkbox actually changes the run output', async ({ page }) => {
  await ready(page);
  await page.selectOption('#examples', {
    label: 'text wrap, 20 columns (-m)',
  });

  // Run with -m on (preset by the example).
  await runAndWait(page);
  const wrapped = await outputText(page);
  expect(wrapped).toMatch(/Here is a line of\s*\n\s*text/);

  // Re-run without -m: textWrapOptions in the YAML should be ignored
  // (latexindent only honors line-break-modifying options under -m).
  await page.uncheck('#use-mlb');
  await runAndWait(page);
  const unwrapped = await outputText(page);
  expect(unwrapped).not.toMatch(/Here is a line of\s*\n\s*text/);
  expect(unwrapped).toContain(
    'Here  is a line of text that will be wrapped by latexindent.pl.',
  );
});

// The Perl interpreter is reused across runs, so latexindent's globals
// (loaded settings, etc.) leak between invocations. To test "does -l
// actually do something?" we have to start each scenario from a fresh
// page load — otherwise a previous run's YAML keeps influencing the
// next run regardless of the checkbox.
const setYaml = async (page, text) => {
  await page.click('#yaml-host .cm-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
};

test('-l on: custom YAML reaches latexindent', async ({ page }) => {
  await ready(page);
  await page.selectOption('#examples', { label: 'itemize (default rules)' });
  await setYaml(page, 'defaultIndent: "XYZ"\n');
  await page.check('#use-yaml');
  await runAndWait(page);
  expect(await outputText(page)).toContain('XYZ');
});

test('-l off: custom YAML is ignored', async ({ page }) => {
  await ready(page);
  await page.selectOption('#examples', { label: 'itemize (default rules)' });
  await setYaml(page, 'defaultIndent: "XYZ"\n');
  await page.uncheck('#use-yaml');
  await runAndWait(page);
  expect(await outputText(page)).not.toContain('XYZ');
});
