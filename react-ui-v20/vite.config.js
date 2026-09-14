import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'node:fs';

// Le preview peut servir des modules, mais l'application installée sur le
// simulateur/webOS 5 doit recevoir un script classique. Le bundle React reste
// une seule IIFE ciblant Chromium 68, comme le build natif V20.
const deviceClassicScript = {
  name: 'v20-react-device-classic-script',
  enforce: 'post',
  closeBundle() {
    const file = new URL('dist/index.html', import.meta.url);
    let html = readFileSync(file, 'utf-8');
    html = html.replace(/<script([^>]*?)type="module"([^>]*?)>/g, function (match, before, after) {
      const attrs = (before + after)
        .replace(/\s*crossorigin(?:="[^"]*")?/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      return '<script ' + attrs + ' defer>';
    });
    html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');
    writeFileSync(file, html);
  }
};

export default defineConfig({
  plugins: [react(), deviceClassicScript],
  base: './',
  server: { host: '0.0.0.0' },
  preview: { host: '0.0.0.0' },
  build: {
    target: 'chrome68',
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true
      }
    }
  }
});
