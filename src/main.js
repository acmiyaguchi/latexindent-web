import { ZeroPerl, MemoryFileSystem } from '@6over3/zeroperl-ts';
import wasmUrl from '@6over3/zeroperl-ts/zeroperl.wasm?url';

const $ = (id) => document.getElementById(id);
const setStatus = (s) => { $('status').textContent = s; };
const decode = (d) => typeof d === 'string' ? d : new TextDecoder().decode(d);

let stderrBuf = '';

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
  stdout: (data) => { $('output').value += decode(data); },
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
  $('output').value = '';
  $('stderr').textContent = '';
  setStatus('Running…');
  try {
    fs.addFile('/app/input.tex', $('input').value);
    const result = await perl.runFile('/app/latexindent.pl', ['/app/input.tex']);
    setStatus(`Done. exit=${result?.exitCode}, success=${result?.success}`);
    if (result && !result.success && result.error) {
      stderrBuf += `\n[runFile error]\n${result.error}\n`;
      $('stderr').textContent = stderrBuf;
    }
  } catch (e) {
    setStatus('Run threw: ' + (e?.message ?? e));
    console.error(e);
  } finally {
    $('run').disabled = false;
  }
});
