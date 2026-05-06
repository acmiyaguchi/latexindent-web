import { ZeroPerl, MemoryFileSystem } from '@6over3/zeroperl-ts';
import wasmUrl from '@6over3/zeroperl-ts/zeroperl.wasm?url';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { StreamLanguage, indentUnit } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';

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

const examples = [
  {
    label: 'itemize (default rules)',
    tex: 'items1.tex',
  },
  {
    label: 'align — alignment delimiters',
    tex: 'align1.tex',
    yaml: 'align1.yaml',
  },
  {
    label: 'headings (nested)',
    tex: 'headings1.tex',
  },
  {
    label: 'one sentence per line (-m)',
    tex: 'multiple-sentences1.tex',
    yaml: 'manipulate-sentences.yaml',
    mlb: true,
  },
  {
    label: 'text wrap, 20 columns (-m)',
    tex: 'textwrap1.tex',
    yaml: 'textwrap1.yaml',
    mlb: true,
  },
  {
    label: 'environments — line break before \\end (-m)',
    tex: 'env-mlb1.tex',
    yaml: 'env-mlb12.yaml',
    mlb: true,
  },
];

const examplesEl = $('examples');
for (let i = 0; i < examples.length; i++) {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = examples[i].label;
  examplesEl.appendChild(opt);
}
examplesEl.addEventListener('change', async () => {
  const idx = examplesEl.value;
  if (idx === '') return;
  const ex = examples[Number(idx)];
  try {
    const tex = await (await fetch('examples/' + ex.tex)).text();
    setDoc(inputView, tex);
    if (ex.yaml) {
      const yml = await (await fetch('examples/' + ex.yaml)).text();
      setDoc(yamlView, yml);
      $('use-yaml').checked = true;
    } else {
      // Examples without their own YAML restore the seed so the pane
      // is never silently left blank from a previous edit.
      setDoc(yamlView, initialYaml);
      $('use-yaml').checked = false;
    }
    $('use-mlb').checked = !!ex.mlb;
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

setStatus('Loading Perl runtime (~25MB wasm, first load is slow)…');
const perl = await ZeroPerl.create({
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

setStatus(`Ready. Loaded ${manifest.length} Perl files. Click Run.`);
$('run').disabled = false;

$('run').addEventListener('click', async () => {
  $('run').disabled = true;
  stderrBuf = '';
  stdoutBuf = '';
  setOutput('');
  $('stderr').textContent = '';
  setStatus('Running…');
  const appendLog = (line) => {
    stderrBuf += (stderrBuf && !stderrBuf.endsWith('\n') ? '\n' : '') + line + '\n';
    $('stderr').textContent = stderrBuf;
  };
  try {
    fs.addFile('/app/input.tex', inputView.state.doc.toString());
    const args = [];
    if ($('use-yaml').checked) {
      fs.addFile('/app/localSettings.yaml', yamlView.state.doc.toString());
      args.push('-l', '/app/localSettings.yaml');
    }
    if ($('use-mlb').checked) args.push('-m');
    args.push('/app/input.tex');
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
