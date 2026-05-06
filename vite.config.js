import { defineConfig } from 'vite';

// We pass the wasm URL explicitly via ?url so Vite emits and rewrites it
// for both dev and production builds. The vendored Perl source under
// public/app/ is served as-is at /app/.
export default defineConfig({
  server: { port: 8765 },
  // Top-level await requires a modern target. Anyone running this needs
  // WebAssembly anyway (Chrome 57+/Firefox 52+), so esnext is fine.
  build: { target: 'esnext' },
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
