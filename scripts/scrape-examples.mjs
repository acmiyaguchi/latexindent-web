#!/usr/bin/env node
// Walk vendored latexindent docs, scrape every \cmhlistingsfromfile, derive
// (input, yamls, output) triples by following \cref links in captions,
// enrich each entry with a derived label and flag set, copy referenced
// demo files into EXAMPLES_DIR, and write the catalog to CATALOG_OUT.
// The catalog is the only source of truth for the dropdown.
//
// Usage: node scripts/scrape-examples.mjs DOCS_DIR DEMO_DIR EXAMPLES_DIR CATALOG_OUT
import { readdir, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_DIR = process.argv[2] ?? join(ROOT, 'vendored/latexindent/documentation');
const DEMO_DIR = process.argv[3] ?? join(DOCS_DIR, 'demonstrations');
const EXAMPLES_DIR = process.argv[4] ?? join(ROOT, 'public/examples');
const CATALOG_OUT = process.argv[5] ?? join(ROOT, 'src/examples-catalog.json');

const readBraced = (s, start) => {
  if (s[start] !== '{') return null;
  let depth = 1;
  let i = start + 1;
  while (i < s.length && depth > 0) {
    const c = s[i];
    if (c === '\\' && s[i + 1] !== undefined) { i += 2; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return { text: s.slice(start + 1, i), end: i }; }
    i++;
  }
  return null;
};

const skipBracketed = (s, i) => {
  if (s[i] !== '[') return i;
  let depth = 1;
  i++;
  while (i < s.length && depth > 0) {
    if (s[i] === '[') depth++;
    else if (s[i] === ']') depth--;
    i++;
  }
  return i;
};

const parseListings = (text) => {
  const out = [];
  const re = /\\cmhlistingsfromfile\*?/g;
  let m;
  while ((m = re.exec(text))) {
    const pos = m.index;
    let i = m.index + m[0].length;
    i = skipBracketed(text, i);
    if (text[i] !== '{') continue;
    const path = readBraced(text, i);
    if (!path) continue;
    i = path.end + 1;
    i = skipBracketed(text, i);
    if (text[i] !== '{') continue;
    const caption = readBraced(text, i);
    if (!caption) continue;
    i = caption.end + 1;
    if (text[i] !== '{') continue;
    const label = readBraced(text, i);
    if (!label) continue;
    out.push({
      path: path.text.trim(),
      caption: caption.text.trim(),
      label: label.text.trim(),
      pos,
    });
  }
  return out;
};

// cmhtcbraster ranges in a section's source. Used to bind outputs to the
// yaml(s) that share their raster — the docs' canonical "this output is
// produced by these settings" grouping. Rasters are flat siblings, not
// nested, so a linear scan is fine.
const parseRasters = (text) => {
  const ranges = [];
  const re = /\\begin\{cmhtcbraster\}/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index;
    let after = m.index + m[0].length;
    after = skipBracketed(text, after);
    const end = text.indexOf('\\end{cmhtcbraster}', after);
    if (end < 0) continue;
    ranges.push({ start, end: end + '\\end{cmhtcbraster}'.length });
  }
  return ranges;
};

const rasterIdxOf = (pos, ranges) => {
  for (let i = 0; i < ranges.length; i++) {
    if (pos >= ranges[i].start && pos < ranges[i].end) return i;
  }
  return -1;
};

const sectionFiles = (await readdir(DOCS_DIR)).filter((f) =>
  /^(?:sub)*sec-.*\.tex$/.test(f),
);
const demoFiles = new Set(await readdir(DEMO_DIR));

const sectionTexts = await Promise.all(
  sectionFiles.map((f) => readFile(join(DOCS_DIR, f), 'utf8')),
);
// Per-section listings annotated with raster index (-1 if outside any
// cmhtcbraster). The raster index is local to its section.
const allListings = sectionFiles.flatMap((file, i) => {
  const rasters = parseRasters(sectionTexts[i]);
  return parseListings(sectionTexts[i]).map((l) => ({
    ...l,
    section: file,
    raster: rasterIdxOf(l.pos, rasters),
  }));
});

const labelToFile = {};
for (const l of allListings) {
  if (l.path.startsWith('demonstrations/')) {
    labelToFile[l.label] = l.path.slice('demonstrations/'.length);
  }
}

// Output filenames look like: foo-default.tex, foo-mod1.tex, foo-rv-mod1.tex,
// foo-mod123.tex, foo-r1.tex (replacement-mode outputs in sec-replacements).
const outputRe = /^(.+?)(?:-default|-r\d*[a-z]*-?mod\d*[a-z]*|-mod\d*[a-z]*|-r\d+)\.tex$/;

// Captions look like one of:
//   \texttt{foo.tex} default output
//   \texttt{foo.tex} using \cref{lst:bar}
//   \texttt{foo.tex} using \cref{lst:bar,lst:baz} and ...
//   foo.tex using \vref{lst:qux}
const inputFromCaption = (caption) => {
  const m = caption.match(/\\texttt\{([^}]+\.(?:tex|bib))\}/) ??
            caption.match(/([\w-]+\.(?:tex|bib))/);
  return m ? m[1] : null;
};
// Captions like "...using \cref{lst:A} or \cref{lst:B}" describe yamls that
// are *equivalent alternatives* — either alone produces the same output.
// Stacking both was the source of YAML::Tiny duplicate-key warnings, so we
// only take the first alternative. A single multi-label cref like
// \cref{lst:A,lst:B} is "and" semantics (both apply) and stays unsplit.
const yamlsFromCaption = (caption) => {
  const blocks = [];
  for (const m of caption.matchAll(/\\(?:c|v)ref\{([^}]+)\}/g)) {
    blocks.push({ pos: m.index, end: m.index + m[0].length, content: m[1] });
  }
  if (blocks.length === 0) return [];
  let take = blocks.length;
  for (let i = 0; i < blocks.length - 1; i++) {
    const sep = caption.slice(blocks[i].end, blocks[i + 1].pos);
    if (/\bor\b/i.test(sep)) { take = i + 1; break; }
  }
  const out = [];
  for (let i = 0; i < take; i++) {
    for (const lbl of blocks[i].content.split(',')) {
      const f = labelToFile[lbl.trim()];
      if (f && f.endsWith('.yaml')) out.push(f);
    }
  }
  return [...new Set(out)];
};

// Pre-load every yaml file so flag derivation is a Map lookup, not a sync read.
const yamlNames = [...demoFiles].filter((f) => f.endsWith('.yaml'));
const yamlContents = new Map(
  await Promise.all(
    yamlNames.map(async (f) => [f, await readFile(join(DEMO_DIR, f), 'utf8')]),
  ),
);

// documentation-test-cases.sh is upstream's regen script — every shipped
// demo output was produced by exactly one invocation in this file. Parsing
// it gives us authoritative (yamls, flags) for each output.tex, much
// stronger than the prose/caption heuristics. Any output not covered here
// (rare; mostly the few defaults that don't pass through this script)
// falls through to the caption/raster heuristics below.
const tokenizeShell = (s) => {
  const out = [];
  let cur = '';
  let q = null; // null | "'" | '"'
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      else if (q === '"' && c === '\\' && i + 1 < s.length) cur += s[++i];
      else cur += c;
    } else if (c === "'" || c === '"') {
      q = c;
    } else if (/\s/.test(c)) {
      if (cur) { out.push(cur); cur = ''; }
    } else {
      cur += c;
    }
  }
  if (cur) out.push(cur);
  return out;
};

// Unroll simple bash for-loops (`for i in {1..6}; do ... done`) so the
// parser sees each invocation on its own line. Used for the tw-tc family.
const expandShellLoops = (text) =>
  text.replace(
    /for\s+(\w+)\s+in\s+\{(\d+)\.\.(\d+)\}\s*;\s*do\b([\s\S]*?)\bdone\b/g,
    (_, varName, lo, hi, body) => {
      const out = [];
      for (let n = +lo; n <= +hi; n++) {
        out.push(body.replace(new RegExp('\\$' + varName + '\\b', 'g'), String(n)));
      }
      return out.join('\n');
    },
  );

const parseTestCases = async () => {
  const map = {};
  let text;
  try {
    text = await readFile(join(DEMO_DIR, 'documentation-test-cases.sh'), 'utf8');
  } catch {
    return map;
  }
  text = expandShellLoops(text);
  // Bool flags (latexindent CLI single-letter options that take no value)
  // we either record (flagged in flagsFor) or silently consume.
  const FLAG_TO_ID = { '-m': 'mlb', '-r': 'replace', '-rr': 'only-replace', '-rv': 'replace-verb', '-t': 'trace', '-k': 'check' };
  const SILENT_FLAGS = new Set(['-s', '-d', '-w', '-c', '-g', '-h', '-v', '-sl', '-tt', '--silent']);
  // Args that consume a value (`-l value`, `-o value`, `-y value`, etc.).
  const VALUE_ARGS = new Set(['-l', '-o', '-y', '-n', '--outputfile', '--lines', '-cy', '-c=', '-g']);
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^\s*#.*$/, '').trim();
    if (!line.startsWith('latexindent.pl')) continue;
    const tokens = tokenizeShell(line).slice(1);
    let stem = null, outArg = null, yamlsArg = null;
    let linesArg = null, inlineYaml = null;
    const flags = new Set();
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === '-l') { yamlsArg = tokens[++i]; continue; }
      if (t.startsWith('-l=')) { yamlsArg = t.slice(3); continue; }
      if (t === '-o' || t === '--outputfile') { outArg = tokens[++i]; continue; }
      if (t.startsWith('-o=') || t.startsWith('--outputfile=')) {
        outArg = t.slice(t.indexOf('=') + 1); continue;
      }
      if (t === '-y') { inlineYaml = tokens[++i]; continue; }
      if (t.startsWith('-y=')) { inlineYaml = t.slice(3); continue; }
      if (t === '-n' || t === '--lines') { linesArg = tokens[++i]; continue; }
      if (t.startsWith('-n=') || t.startsWith('--lines=')) {
        linesArg = t.slice(t.indexOf('=') + 1); continue;
      }
      if (FLAG_TO_ID[t]) { flags.add(FLAG_TO_ID[t]); continue; }
      if (SILENT_FLAGS.has(t)) continue;
      if (VALUE_ARGS.has(t)) { i++; continue; }
      if (t.startsWith('-')) continue;
      if (!stem) stem = t;
    }
    if (!stem || !outArg) continue;
    if (!stem.endsWith('.tex')) stem += '.tex';
    let outputFile;
    if (outArg.startsWith('+')) {
      outputFile = stem.replace(/\.tex$/, '') + outArg.slice(1) + '.tex';
    } else {
      outputFile = outArg.endsWith('.tex') ? outArg : outArg + '.tex';
    }
    const yamlsRaw = yamlsArg
      ? yamlsArg.split(',').map((s) => s.trim()).filter(Boolean)
        .map((s) => s.endsWith('.yaml') ? s : s + '.yaml')
      : [];
    // Resolve upstream test-cases.sh typo: `-l=multi-line1yaml` becomes
    // `multi-line1yaml.yaml` (does not exist) but the intended file is
    // `multi-line1.yaml`. When a resolved name doesn't exist, try
    // collapsing the trailing `yaml.yaml` into a single `.yaml`.
    const yamls = [...new Set(
      yamlsRaw.map((y) => {
        if (demoFiles.has(y)) return y;
        const fix = y.replace(/yaml\.yaml$/, '.yaml');
        return demoFiles.has(fix) ? fix : y;
      }),
    )];
    map[outputFile] = {
      yamls,
      flags: [...flags],
      input: stem,
      ...(linesArg ? { lines: linesArg } : {}),
      ...(inlineYaml ? { inlineYaml } : {}),
    };
  }
  return map;
};
const testCaseMap = await parseTestCases();

// Filename pattern overrides yaml-based detection: some replacement demos
// share one yaml across -r / -rr / -rv variants and only the filename
// distinguishes them. -r and -rv only fire under -m in the indent phase.
const flagsFor = ({ yamls, output }) => {
  const flags = new Set();
  for (const y of yamls) {
    const text = yamlContents.get(y) ?? '';
    if (/^modifyLineBreaks\s*:/m.test(text)) flags.add('mlb');
    if (/^replacements\s*:/m.test(text)) flags.add('replace');
  }
  if (/-rv-mod\d/.test(output)) { flags.delete('replace'); flags.add('replace-verb'); }
  if (/-rr-mod\d/.test(output)) { flags.delete('replace'); flags.add('only-replace'); }
  if (flags.has('replace') || flags.has('replace-verb')) flags.add('mlb');
  return [...flags];
};

const labelFor = ({ input, yamls }) =>
  yamls.length ? `${input} + ${yamls.join(', ')}` : input;

// Demo-file kind for one listing (or null if it isn't from demonstrations/).
const classify = (l) => {
  if (!l.path.startsWith('demonstrations/')) return null;
  const file = l.path.slice('demonstrations/'.length);
  if (file.endsWith('.yaml')) return { kind: 'yaml', file };
  if (!file.endsWith('.tex')) return null;
  const m = outputRe.exec(file);
  if (!m) return { kind: 'input', file };
  return { kind: 'output', file, stem: m[1] };
};

// Annotate each listing with its classification so the attribution passes
// can reason about kinds without re-classifying.
const annotated = allListings.map((l) => ({ ...l, kind: classify(l) }));

// First pass: outputs whose caption explicitly names yamls via \cref get
// those yamls (with "or" alternatives collapsed to the first; see
// yamlsFromCaption). We also remember which yamls were explicitly claimed
// by some output's caption — those are off-limits for the implicit
// same-raster pairing in pass 2 (so e.g. aligned1-mod7's caption-claim of
// sba7 doesn't poach mod5's slot in the same raster).
const captionYamls = annotated.map((l) =>
  l.kind?.kind === 'output' ? yamlsFromCaption(l.caption) : [],
);
const claimedYamls = new Set();
for (const ys of captionYamls) for (const y of ys) claimedYamls.add(y);

// Second pass: attribute a yaml to outputs whose caption doesn't \cref one.
// Algorithm: prefer an unclaimed yaml in the output's own raster; otherwise
// walk backward through the section in document order and stop at the most
// recent yaml — when that yaml lives in a raster, take the FIRST yaml in
// that raster (matches the docs convention of leading with the canonical
// alternative; e.g. sba1 over sba2..sba4); when it's a standalone yaml,
// scan back through any consecutive standalone yamls and take the first.
// Standalone and raster yamls compete on document distance, so a recent
// standalone yaml (textwrap13) wins over an older raster (textwrap12 from
// a previous example block).
const findImplicitYaml = (idx) => {
  const out = annotated[idx];

  if (out.raster !== -1) {
    for (const l of annotated) {
      if (l.section !== out.section || l.raster !== out.raster) continue;
      if (l.kind?.kind === 'yaml' && !claimedYamls.has(l.kind.file)) {
        return [l.kind.file];
      }
    }
  }

  const before = annotated
    .filter((l) => l.section === out.section && l.pos < out.pos)
    .sort((a, b) => b.pos - a.pos);

  for (let i = 0; i < before.length; i++) {
    const l = before[i];
    if (!l.kind || l.kind.kind === 'output') continue;
    if (l.kind.kind === 'input') return [];
    // l.kind.kind === 'yaml'
    if (l.raster !== -1) {
      for (const x of annotated) {
        if (x.section === out.section && x.raster === l.raster && x.kind?.kind === 'yaml') {
          return [x.kind.file];
        }
      }
    }
    let first = l.kind.file;
    for (let j = i + 1; j < before.length; j++) {
      const x = before[j];
      if (!x.kind) continue;
      if (x.kind.kind === 'yaml' && x.raster === -1) first = x.kind.file;
      else break;
    }
    return [first];
  }
  return [];
};

// Some yamls (path1.yaml, path3.yaml) declare a `paths:` field that tells
// latexindent to also load other yaml files. Those chained yamls must be
// present in the FS for the directive to resolve — collect them so they
// land in `yamls` and get copied into public/examples/. We pass the whole
// chain via -l (latexindent loads each file separately, no dup-key
// concatenation), which also matches the docs' merge semantics.
const pathsRefs = (yaml) => {
  const text = yamlContents.get(yaml) ?? '';
  const refs = [];
  // `\s*` would eat the newline after `paths:`, sliding the value capture
  // onto the first list item; constrain to same-line whitespace.
  const m = text.match(/^paths[ \t]*:[ \t]*([^\n]*)\n((?:[ \t]*-[^\n]*\n)*)/m);
  if (!m) return refs;
  if (m[1].trim()) refs.push(m[1].trim());
  for (const line of m[2].split('\n')) {
    const item = line.match(/^[ \t]*-\s*(.+?)\s*$/);
    if (item) refs.push(item[1]);
  }
  return refs.map((r) => r.replace(/^['"]|['"]$/g, '')).filter((r) => r);
};

const expandPathsChain = (yamls) => {
  const out = [...yamls];
  const seen = new Set(out);
  for (let i = 0; i < out.length; i++) {
    for (const ref of pathsRefs(out[i])) {
      if (!demoFiles.has(ref) || seen.has(ref)) continue;
      out.push(ref);
      seen.add(ref);
    }
  }
  return out;
};

const catalog = {};
for (let i = 0; i < annotated.length; i++) {
  const l = annotated[i];
  const c = l.kind;
  if (!c || c.kind !== 'output') continue;

  const stemInput = `${c.stem}.tex`;
  const capInput = inputFromCaption(l.caption);
  // Many docs caption a listing with its own filename ("\texttt{verb1-rv-mod1.tex}"),
  // which is useless for pairing — fall through to the filename-stem guess.
  const usableCapInput = capInput && capInput !== c.file && demoFiles.has(capInput);
  const input = usableCapInput ? capInput : stemInput;
  if (!demoFiles.has(input)) continue;

  // Primary source: the authoritative test-cases.sh entry for this output.
  // Falls through to caption/sibling/raster heuristics when absent (a few
  // defaults and edge cases aren't covered there).
  const tc = testCaseMap[c.file];
  let yamls;
  let extraFlags = [];
  if (tc) {
    yamls = tc.yamls;
    extraFlags = tc.flags;
  } else {
    yamls = captionYamls[i];
    if (yamls.length === 0 && !c.file.endsWith('-default.tex')) {
      const sibling = stemInput.replace(/\.tex$/, '.yaml');
      if (demoFiles.has(sibling)) yamls = [sibling];
      else yamls = findImplicitYaml(i);
    }
  }

  yamls = expandPathsChain(yamls);

  const draft = { input, yamls, output: c.file };
  // When test-cases.sh covers this entry, its flags are authoritative —
  // `flagsFor` heuristically adds `mlb` whenever a yaml has replacements,
  // but upstream sometimes runs `-r` without `-m` (e.g. replace1-r1) and
  // forcing `-m` on changes the output.
  const flags = tc ? extraFlags : flagsFor(draft);
  catalog[c.file.replace(/\.tex$/, '')] = {
    ...draft,
    section: l.section,
    caption: l.caption.replace(/\s+/g, ' ').trim(),
    flags,
    label: labelFor(draft),
    ...(tc?.lines ? { lines: tc.lines } : {}),
    ...(tc?.inlineYaml ? { inlineYaml: tc.inlineYaml } : {}),
  };
}

await mkdir(EXAMPLES_DIR, { recursive: true });
await mkdir(dirname(CATALOG_OUT), { recursive: true });
await writeFile(CATALOG_OUT, JSON.stringify(catalog, null, 2) + '\n');
console.log(`scraper: ${Object.keys(catalog).length} catalog entries (from ${sectionFiles.length} doc files)`);

// Inputs and yamls are fetched at runtime when the user picks an example;
// outputs are copied so future tests / "expected" panes can diff against
// upstream. Copies overlap.
const wanted = new Set();
for (const e of Object.values(catalog)) {
  wanted.add(e.input);
  wanted.add(e.output);
  for (const y of e.yamls) wanted.add(y);
}
const results = await Promise.all(
  [...wanted].map((f) =>
    copyFile(join(DEMO_DIR, f), join(EXAMPLES_DIR, f)).then(() => true, () => false),
  ),
);
const copied = results.filter(Boolean).length;
const skipped = results.length - copied;
console.log(`scraper: copied ${copied} demo files into ${EXAMPLES_DIR}${skipped ? ` (${skipped} missing)` : ''}`);
