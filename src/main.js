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

let stderrBuf = '';
let stdoutBuf = '';

setStatus('Fetching latexindent source files…');
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
