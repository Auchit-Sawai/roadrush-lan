import { defineConfig } from 'vite';
import { renameSync } from 'node:fs';
import { resolve } from 'node:path';

// Static build for GitHub Pages: only the game page, relative asset paths, served as index.html.
const extensionDir = resolve(import.meta.dirname, 'extension');
const outDir = resolve(import.meta.dirname, 'site');

export default defineConfig({
  root: extensionDir,
  base: './',
  publicDir: false,
  plugins: [{
    name: 'roadrush-pages-index',
    closeBundle() {
      renameSync(resolve(outDir, 'game.html'), resolve(outDir, 'index.html'));
    },
  }],
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { game: resolve(extensionDir, 'game.html') },
    },
  },
});
