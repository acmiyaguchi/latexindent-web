# latexindent-web

> Built with Claude Opus 4.7.

[latexindent.pl][upstream] (v4.0.1) running entirely in the browser via
[zeroperl][zeroperl] (Perl 5.42 compiled to WebAssembly / WASI), with a
[CodeMirror 6][cm6] editor for input and output.

## Why

latexindent is a 11k-LOC pure-Perl LaTeX formatter. zeroperl is an actively
maintained Perl interpreter compiled to WASM. This project demonstrates that
the two combine into a static webpage — no server, no install, just a tab.

## Build

```sh
npm install
npm run prepare-vendor    # clones latexindent.pl + downloads YAML::Tiny + applies patches
npm run dev               # http://localhost:8765/
```

Production build:

```sh
npm run build             # → dist/, deployable to any static host
```

## How it works

1. `scripts/prepare-vendor.sh` clones the upstream latexindent.pl repo,
   downloads `YAML::Tiny`, applies the patches in `patches/`, copies the
   result plus our overrides into `public/app/`, and writes a `files.txt`
   manifest of every `.pl` / `.pm` / `.yaml` file.
2. At runtime, the page fetches each file from `public/app/` and inserts it
   into zeroperl's `MemoryFileSystem`.
3. The input pane is a CodeMirror 6 editor with `stex` syntax highlighting,
   tab-as-indent, and line wrapping. The output pane is a read-only
   CodeMirror editor with the same highlighting.
4. Click *Run latexindent* and the page writes the input editor's contents
   to `/app/input.tex`, invokes `runFile('/app/latexindent.pl',
   ['/app/input.tex'])`, captures stdout into the output editor, and routes
   stderr to the log pane.

## Patches

zeroperl excludes a few XS modules that latexindent transitively depends on
(`Storable`, `B`). The patches in `patches/` work around that by stripping
unused `Encode` imports, replacing `:encoding(UTF-8)` PerlIO layers with
`:utf8`, and stubbing one B-using helper in `YAML::Tiny`. See the diffs
themselves for details — every change is annotated with `(zeroperl POC)`.

`overrides/LatexIndent/UTF8CmdLineArgsFileOperation.pm` is a full rewrite of
the CLI/encoding helper module — too divergent to keep as a patch — that
preserves the public API but drops Encode and Win32 dependencies.

`overrides/File/HomeDir.pm` is a 3-line stub returning `/home`, since
`File::HomeDir` isn't bundled with zeroperl and we don't have a real home
directory in the browser.

## Tests

End-to-end Playwright tests live in `tests/`:

```sh
npm install               # one-time, picks up @playwright/test
npm test                  # spins up vite, runs the spec
```

The config sets `webServer.reuseExistingServer = true`, so if you already have
`npm run dev` running on :8765 the test run will use it.

## Limitations

- Cold load transfers ~25 MB of WASM. Subsequent loads hit cache.
- First *Run* takes ~25 seconds because latexindent compiles a lot of regex
  in its `BEGIN` blocks.
- The Perl interpreter is reused across `Run` clicks, so latexindent's
  module-level globals (loaded settings, etc.) leak between runs. Toggling
  `-l` or editing the YAML and re-running may give surprising results
  because previous settings persist in memory. Reload the page to start
  from a clean state.
- `-w` / overwrite, log files, and user `indentconfig.yaml` aren't wired up.
- See `patches/latexindent.patch` for the full list of latexindent features
  that were trimmed (Encode-based filename handling, mainly Win32-relevant).

## Licenses

- This project: MIT (see `LICENSE`).
- latexindent.pl (vendored at build time): GPL-3.0.
- YAML::Tiny (vendored at build time): Perl Artistic / GPL-1+.
- zeroperl runtime (npm dependency): Apache-2.0.

[upstream]: https://github.com/cmhughes/latexindent.pl
[zeroperl]: https://github.com/6over3/zeroperl
[cm6]: https://codemirror.net/
