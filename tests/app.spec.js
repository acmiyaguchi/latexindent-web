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

const pickExample = async (page, input, variant) => {
  await page.selectOption('#examples-input', { label: input });
  if (variant !== undefined) {
    await page.selectOption('#examples-variant', { label: variant });
  }
};

test('page loads, version + build time visible', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#version-line')).toContainText('latexindent.pl');
  await expect(page.locator('#build-time')).toHaveText(
    /\d{4}-\d{2}-\d{2}T/,
  );
});

test('picking an input with multiple variants requires a variant pick', async ({
  page,
}) => {
  await ready(page);
  await pickExample(page, 'tabular2.tex', '+ tabular2.yaml');
  await expect(page.locator('#yaml-host .cm-content')).toContainText(
    'lookForAlignDelims',
  );
  await expect(page.locator('#use-yaml')).toBeChecked();
  await expect(page.locator('#use-mlb')).not.toBeChecked();
  await expect(page.locator('#input-host .cm-content')).toContainText(
    '\\begin{tabular}',
  );
});

test('picking an input with one variant auto-loads it', async ({ page }) => {
  await ready(page);
  // textwrap1.tex has only one cataloged variant, so the variant dropdown
  // should auto-select and fire the load handler with no second pick.
  await pickExample(page, 'textwrap1.tex');
  await expect(page.locator('#use-yaml')).toBeChecked();
  await expect(page.locator('#use-mlb')).toBeChecked();
});

test('switching inputs clears the previous yaml back to the seed', async ({
  page,
}) => {
  await ready(page);
  await pickExample(page, 'tabular2.tex', '+ tabular2.yaml');
  await expect(page.locator('#yaml-host .cm-content')).toContainText(
    'lookForAlignDelims',
  );
  // Clear the YAML editor manually, then switch to a no-yaml input —
  // the seed must reappear (we never want a silently blank pane).
  await page.click('#yaml-host .cm-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await expect(page.locator('#yaml-host .cm-content')).toHaveText(/^\s*$/);
  await pickExample(page, 'items1.tex');
  await expect(page.locator('#yaml-host .cm-content')).toContainText(
    'defaultIndent',
  );
  await expect(page.locator('#use-yaml')).not.toBeChecked();
});

test('-m checkbox actually changes the run output', async ({ page }) => {
  await ready(page);
  await pickExample(page, 'textwrap1.tex');

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

// Each Run rebuilds the Perl interpreter (see createPerl in main.js) so
// latexindent's package globals start clean every invocation. Tests can
// therefore rely on `-l on/off` toggles within a single page session.
const setYaml = async (page, text) => {
  await page.click('#yaml-host .cm-content');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text);
};

test('-l on: custom YAML reaches latexindent', async ({ page }) => {
  await ready(page);
  await pickExample(page, 'items1.tex');
  await setYaml(page, 'defaultIndent: "XYZ"\n');
  await page.check('#use-yaml');
  await runAndWait(page);
  expect(await outputText(page)).toContain('XYZ');
});

test('-l off: custom YAML is ignored', async ({ page }) => {
  await ready(page);
  await pickExample(page, 'items1.tex');
  await setYaml(page, 'defaultIndent: "XYZ"\n');
  await page.uncheck('#use-yaml');
  await runAndWait(page);
  expect(await outputText(page)).not.toContain('XYZ');
});

// Regression: switching variants in one session and clicking Run twice
// used to produce identical output — DBS6 sets optionalArguments and
// DBS7 sets mandatoryArguments, but a stale interpreter would deep-merge
// the new -l on top of the previous run's already-loaded settings, so
// both arg blocks would end up active and neither expected output ever
// rendered. createPerl per Run resolves it.
test('switching variants between runs actually changes the output', async ({
  page,
}) => {
  await ready(page);
  await pickExample(page, 'mycommand2.tex', '+ DBS6.yaml');
  await runAndWait(page);
  const out6 = await outputText(page);
  await pickExample(page, 'mycommand2.tex', '+ DBS7.yaml');
  await runAndWait(page);
  const out7 = await outputText(page);
  expect(out7).not.toEqual(out6);
});

// `-t` only adds TRACE: lines to indent.log; the file is read back from
// the in-memory FS into the #logfile pane. Without that wiring the flag
// looked inert because all logger output went to a file the user couldn't
// see. The auto-open behavior is a UX cue that the flag did something.
test('-t flag populates indent.log and auto-opens the pane', async ({
  page,
}) => {
  await ready(page);
  await pickExample(page, 'items1.tex');
  await page.check('#use-trace');
  await runAndWait(page);
  await expect(page.locator('#logfile')).toContainText(/TRACE:/);
  await expect(page.locator('#logfile-section')).toHaveJSProperty('open', true);
});

const logfileText = (page) => page.locator('#logfile').innerText();
const stderrText = (page) => page.locator('#stderr').innerText();

// `-s` suppresses the formatted body's print to stdout (Document.pm:257),
// so the output editor stays empty even though the run succeeded. Without
// -s the same example would write the indented document there.
test('-s flag suppresses output to the editor', async ({ page }) => {
  await ready(page);
  await pickExample(page, 'items1.tex');
  await page.check('#use-silent');
  await runAndWait(page);
  expect(await stderrText(page)).toContain('[exit 0]');
  // Empty CodeMirror editor reports as `"\n"` (one empty line), so
  // normalize before checking. Without -s the same input writes its
  // indented body here and the trim wouldn't be empty.
  expect((await outputText(page)).trim()).toBe('');
});

// `-tt` is a strict superset of `-t` (Switches.pm:42 promotes -t when -tt
// is set), so it must produce strictly more log lines for the same input.
test('-tt produces more log output than -t', async ({ page }) => {
  await ready(page);
  await pickExample(page, 'items1.tex');
  await page.check('#use-trace');
  await runAndWait(page);
  const tLines = (await logfileText(page)).split('\n').length;

  await page.uncheck('#use-trace');
  await page.check('#use-ttrace');
  await runAndWait(page);
  const ttLines = (await logfileText(page)).split('\n').length;

  expect(ttLines).toBeGreaterThan(tLines);
});

// `-k` exits non-zero when the run would change the input
// (Document.pm:154-156). items1.tex needs indenting, so a check run
// against it must report exit 1.
test('-k flag exits non-zero when input differs from formatted output', async ({
  page,
}) => {
  await ready(page);
  await pickExample(page, 'items1.tex');
  await page.check('#use-check');
  await runAndWait(page);
  expect(await stderrText(page)).toContain('[exit 1]');
});

// `-kv` is `-k` plus the diff dumped to stdout (Check.pm:135-138). Same
// non-zero exit; on top, the output editor should carry the diff
// markers instead of (or in addition to) any formatted body.
test('-kv flag also writes the diff to the output stream', async ({
  page,
}) => {
  await ready(page);
  await pickExample(page, 'items1.tex');
  await page.check('#use-checkv');
  await runAndWait(page);
  expect(await stderrText(page)).toContain('[exit 1]');
  expect(await outputText(page)).toMatch(/^@@ \d+ -- \d+ @@/m);
});
