import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const extensionDir = resolve(import.meta.dirname, 'extension');
const outDir = resolve(import.meta.dirname, 'dist');

function copyExtensionFiles() {
  return {
    name: 'roadrush-copy-extension-files',
    closeBundle() {
      mkdirSync(outDir, { recursive: true });
      cpSync(resolve(extensionDir, 'manifest.json'), resolve(outDir, 'manifest.json'));
      cpSync(resolve(extensionDir, 'icons'), resolve(outDir, 'icons'), { recursive: true });
    },
  };
}

export default defineConfig({
  root: extensionDir,
  base: '/',
  publicDir: false,
  plugins: [copyExtensionFiles()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'chrome110',
    sourcemap: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        game: resolve(extensionDir, 'game.html'),
        launcher: resolve(extensionDir, 'launcher.html'),
        popup: resolve(extensionDir, 'popup.html'),
      },
    },
  },
});
