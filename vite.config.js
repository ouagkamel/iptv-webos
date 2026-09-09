// vite.config.js — spec §2.2 (verbatim), + branchure Q3 (plan Sprint 4, tâche 4.6) :
// IPTV_PRODUCTION=true en build store => drop_console:true ; sinon false (ares-inspect).
import { defineConfig } from 'vite';

const PRODUCTION = process.env.IPTV_PRODUCTION === 'true';

export default defineConfig({
  base: './',
  worker: {
    format: 'iife'           // Workers compatibles Chromium 68, sans ESM-in-worker
  },
  build: {
    target: 'chrome68',      // Transpilation esbuild du code applicatif
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: PRODUCTION, // false requis pour ares-inspect (WARNING Q3 acté)
        ecma: 6
      }
    },
    rollupOptions: {
      output: {
        format: 'iife',              // Rollup interdit le code-splitting en IIFE…
        inlineDynamicImports: true   // …donc tout import() dynamique est inliné (exigé)
      }
    }
  }
});
