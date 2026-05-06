import { ZeroPerl, MemoryFileSystem } from '@6over3/zeroperl-ts';
import wasmUrl from '@6over3/zeroperl-ts/zeroperl.wasm?url';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { StreamLanguage, indentUnit } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import examples from './examples-catalog.json';

const $ = (id) => document.getElementById(id);
const setStatus = (s) => { $('status').textContent = s; };
const decode = (d) => typeof d === 'string' ? d : new TextDecoder().decode(d);

$('build-time').textContent = __BUILD_TIME__;
$('build-time').title = __BUILD_TIME__;

const stexLang = StreamLanguage.define(stex);
const yamlLang = StreamLanguage.define(yaml);

const initialYaml = `# Overrides keys from defaultSettings.yaml.
# Example: change the indent character to two spaces.
defaultIndent: "  "

# Example: increase indentation inside itemize.
indentRules:
  itemize: "  "
`;

const initialDoc = `\\documentclass{article}
\\begin{document}
\\begin{itemize}
\\item one
\\begin{enumerate}
\\item nested
\\item another
\\end{enumerate}
\\item two
\\end{itemize}
\\end{document}
`;

const inputView = new EditorView({
  doc: initialDoc,
  parent: $('input-host'),
  extensions: [
    basicSetup,
    keymap.of([indentWithTab]),
    indentUnit.of('\t'),
    EditorState.tabSize.of(4),
    EditorView.lineWrapping,
    stexLang,
  ],
});

const yamlView = new EditorView({
  doc: initialYaml,
  parent: $('yaml-host'),
  extensions: [
    basicSetup,
    keymap.of([indentWithTab]),
    EditorState.tabSize.of(2),
    EditorView.lineWrapping,
    yamlLang,
  ],
});

const outputView = new EditorView({
  doc: '',
  parent: $('output-host'),
  extensions: [
    basicSetup,
    stexLang,
    EditorState.tabSize.of(4),
    EditorView.lineWrapping,
    EditorState.readOnly.of(true),
  ],
});

const setOutput = (text) => {
  outputView.dispatch({
    changes: { from: 0, to: outputView.state.doc.length, insert: text },
  });
};

const setDoc = (view, text) => {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
};

const sectionLabel = (s) =>
  s.replace(/\.tex$/, '').replace(/^(?:sub)*sec-/, '').replace(/-/g, ' ');

const flagControls = [
  { id: 'mlb', cli: '-m' },
  { id: 'replace', cli: '-r' },
  { id: 'only-replace', cli: '-rr' },
  { id: 'replace-verb', cli: '-rv' },
  { id: 'silent', cli: '-s' },
  { id: 'trace', cli: '-t' },
  { id: 'only-default', cli: '-d' },
  { id: 'check', cli: '-k' },
];
const flagEl = (f) => $(`use-${f.id}`);

const resetFlags = () => {
  for (const f of flagControls) flagEl(f).checked = false;
  $('lines-arg').value = '';
  $('yaml-arg').value = '';
};

const variantsByInput = Map.groupBy(
  Object.entries(examples).map(([id, e]) => ({ id, ...e })),
  (e) => e.input,
);
const inputsBySection = Map.groupBy(
  [...variantsByInput.values()].map((vs) => ({ input: vs[0].input, section: vs[0].section })),
  (e) => e.section,
);

const inputEl = $('examples-input');
for (const sec of [...inputsBySection.keys()].sort()) {
  const og = document.createElement('optgroup');
  og.label = sectionLabel(sec);
  for (const { input } of inputsBySection.get(sec).sort((a, b) => a.input.localeCompare(b.input))) {
    const opt = document.createElement('option');
    opt.value = input;
    opt.textContent = input;
    og.appendChild(opt);
  }
  inputEl.appendChild(og);
}

// When a variant is just the previous one plus one new yaml (the docs'
// cumulative pattern, e.g. quick-start mod1..mod9), label by the *added*
// yaml so the dropdown stays scannable. Otherwise show the full stack.
const variantLabel = (curr, prev) => {
  if (!curr.yamls.length) return 'default';
  if (prev?.yamls.length && curr.yamls.length === prev.yamls.length + 1) {
    const prevSet = new Set(prev.yamls);
    const added = curr.yamls.filter((y) => !prevSet.has(y));
    if (added.length === 1) return `+ ${added[0]}`;
  }
  return `+ ${curr.yamls.join(', ')}`;
};

const variantEl = $('examples-variant');
inputEl.addEventListener('change', () => {
  const variants = (variantsByInput.get(inputEl.value) ?? [])
    .toSorted((a, b) => a.output.localeCompare(b.output, undefined, { numeric: true }));
  variantEl.replaceChildren();
  variantEl.disabled = variants.length === 0;
  for (let i = 0; i < variants.length; i++) {
    const opt = document.createElement('option');
    opt.value = variants[i].id;
    opt.textContent = variantLabel(variants[i], variants[i - 1]);
    variantEl.appendChild(opt);
  }
  // Even with one option, Chrome won't fire `change` from setting .value,
  // so dispatch manually so the load handler runs uniformly.
  if (variants.length > 0) {
    variantEl.value = variants[0].id;
    variantEl.dispatchEvent(new Event('change'));
  }
});

// YAML's `---` document marker. We use it to delimit concatenated yaml
// files in the single editor pane: at run time we split on it so each
// document goes to its own /app/yN.yaml and gets passed to latexindent's
// `-l a,b,c` comma-separated list. That preserves latexindent's deep-merge
// semantics for stacked overrides — concatenating into one file made
// YAML::Tiny warn about duplicate keys when two yamls touched the same
// top-level setting (tabular2-mod4 etc).
const YAML_DOC_SEP = '\n---\n';

variantEl.addEventListener('change', async () => {
  const ex = examples[variantEl.value];
  if (!ex) return;
  try {
    const tex = await (await fetch('examples/' + ex.input)).text();
    setDoc(inputView, tex);
    if (ex.yamls.length > 0) {
      const texts = await Promise.all(
        ex.yamls.map((y) => fetch('examples/' + y).then((r) => r.text())),
      );
      setDoc(yamlView, texts.join(YAML_DOC_SEP));
      $('use-yaml').checked = true;
    } else {
      // Restore the seed so the pane isn't silently left blank from a
      // previous edit on a different example.
      setDoc(yamlView, initialYaml);
      $('use-yaml').checked = false;
    }
    resetFlags();
    const wanted = new Set(ex.flags ?? []);
    for (const f of flagControls) flagEl(f).checked = wanted.has(f.id);
    if (ex.lines) $('lines-arg').value = ex.lines;
    if (ex.inlineYaml) $('yaml-arg').value = ex.inlineYaml;
  } catch (e) {
    setStatus('Failed to load example: ' + (e?.message ?? e));
  }
});

let stderrBuf = '';
let stdoutBuf = '';

setStatus('Fetching latexindent source files…');
fetch('app/version.json').then((r) => r.ok ? r.json() : null).then((v) => {
  if (!v) return;
  const short = (v.sha || '').slice(0, 7);
  const url = `${v.repo}/commit/${v.sha}`;
  $('version-line').innerHTML = `latexindent.pl ${v.describe} (<a href="${url}">${short}</a>)`;
}).catch(() => {});

const manifest = (await (await fetch('app/files.txt')).text()).trim().split('\n');

const fs = new MemoryFileSystem({ '/': '' });
await Promise.all(manifest.map(async (path) => {
  const r = await fetch('app/' + path);
  if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
  fs.addFile('/app/' + path, new Uint8Array(await r.arrayBuffer()));
}));

// latexindent stores its merged settings in module-level Perl globals
// (`%mainSettings`, etc.) that persist across `runFile` invocations. If we
// reused one ZeroPerl instance, switching variants and re-running would
// deep-merge the new -l on top of the previous run's settings instead of
// starting clean — see the dbs6/dbs7 case where neither output ever shows
// because the leftover optionalArguments/mandatoryArguments overlap. So we
// recreate the interpreter per Run. The wasm fetch hits the browser HTTP
// cache after the first load, so re-init is a couple of seconds rather
// than the ~25s cold start.
const createPerl = () => ZeroPerl.create({
  fileSystem: fs,
  fetch: () => fetch(wasmUrl),
  stdout: (data) => {
    stdoutBuf += decode(data);
    setOutput(stdoutBuf);
  },
  stderr: (data) => {
    stderrBuf += decode(data);
    $('stderr').textContent = stderrBuf;
  },
});

setStatus('Loading Perl runtime (~25MB wasm, first load is slow)…');
let perl = await createPerl();
let perlIsFresh = true;

setStatus(`Ready. Loaded ${manifest.length} Perl files. Click Run.`);
$('run').disabled = false;

$('run').addEventListener('click', async () => {
  $('run').disabled = true;
  stderrBuf = '';
  stdoutBuf = '';
  setOutput('');
  $('stderr').textContent = '';
  if (!perlIsFresh) {
    setStatus('Resetting Perl interpreter…');
    perl = await createPerl();
  }
  perlIsFresh = false;
  setStatus('Running…');
  const appendLog = (line) => {
    stderrBuf += (stderrBuf && !stderrBuf.endsWith('\n') ? '\n' : '') + line + '\n';
    $('stderr').textContent = stderrBuf;
  };
  try {
    fs.addFile('/app/input.tex', inputView.state.doc.toString());
    const args = [];
    if ($('use-yaml').checked) {
      // Split the editor on YAML's `---` document marker so each document
      // becomes its own file. latexindent then deep-merges them via
      // `-l a,b,c` instead of seeing one concatenated file with duplicate
      // top-level keys.
      const docs = yamlView.state.doc.toString().split(/^---\s*$/m)
        .map((d) => d.replace(/^\s+/, '')).filter((d) => d.trim());
      const paths = docs.map((doc, i) => {
        const path = `/app/localSettings${i}.yaml`;
        fs.addFile(path, doc);
        return path;
      });
      if (paths.length) args.push('-l', paths.join(','));
    }
    for (const f of flagControls) {
      if (flagEl(f).checked) args.push(f.cli);
    }
    const linesArg = $('lines-arg').value.trim();
    if (linesArg) args.push('-n', linesArg);
    const yamlArg = $('yaml-arg').value.trim();
    if (yamlArg) args.push('-y', yamlArg);
    args.push('/app/input.tex');
    appendLog('$ latexindent.pl ' + args.join(' '));
    const result = await perl.runFile('/app/latexindent.pl', args);
    setStatus(result?.success ? 'Done.' : 'Failed.');
    appendLog(`[exit ${result?.exitCode ?? '?'}]`);
    if (result && !result.success && result.error) appendLog(result.error);
  } catch (e) {
    setStatus('Failed.');
    appendLog('[threw] ' + (e?.message ?? e));
    console.error(e);
  } finally {
    $('run').disabled = false;
  }
});
