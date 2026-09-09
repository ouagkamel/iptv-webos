// vite.config.js — spec §2.2 (verbatim), + branchure Q3 (plan Sprint 4, tâche 4.6) :
// IPTV_PRODUCTION=true en build store => drop_console:true ; sinon false (ares-inspect).
import { defineConfig } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';

const PRODUCTION = process.env.IPTV_PRODUCTION === 'true';

/* Correction device (revue TV réelle, commit à venir) : sur la TV, l'app
 * installée tourne sur une origine file:// où <script type="module"> est
 * refusé par la politique CORS du moteur (le simulateur sert en http://localhost
 * et ne peut donc jamais le révéler — symptôme : écran noir muet, notre garde
 * « module non exécuté après 5 s » l'a nommée). Le bundle est déjà IIFE (format
 * verbatim §2.2), sans import.meta ni dynamic import externe (tout est inliné)
 * → un <script> classique + defer conserve la sémantique d'exécution différée.
 * §2.2 n'impose pas type="module" (détail de sortie Vite) : ce n'est pas un
 * écart, c'est la condition d'exécutabilité du format IIFE qu'il exige. */
const deviceClassicScript = {
  name: 'iptv-device-classic-script',
  enforce: 'post',
  closeBundle() {
    const file = new URL('dist/index.html', import.meta.url);
    let html = readFileSync(file, 'utf-8');
    html = html.replace(/<script([^>]*?)type="module"([^>]*?)>/g, function (m, a, b) {
      const attrs = (a + b)
        .replace(/\s*crossorigin(?:="[^"]*")?/g, '')
        .replace(/\s+/g, ' ').trim();
      return '<script ' + attrs + ' defer>';
    });
    html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');
    writeFileSync(file, html);
  }
};

export default defineConfig({
  plugins: [deviceClassicScript],
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
