import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { themeCss } from './src/theme.ts';

// Injects the theme tokens (src/theme.ts) into index.html, so the UI has its
// colours from the first frame and theme.ts stays the single source.
function themeTokens(): Plugin {
  return {
    name: 'theme-tokens',
    transformIndexHtml(html) {
      return html.replace('</head>', `<style id="theme-tokens">${themeCss()}</style>\n</head>`);
    },
  };
}

// `vite build --mode preview-page`: the browser preview build. three.js loads
// from the CDN through an import map, and Capacitor is swapped for the
// browser-only platform module. scripts/build-preview.mjs inlines the rest.
export default defineConfig(({ mode }) => {
  const page = mode === 'preview-page';
  return {
    base: './',
    plugins: [themeTokens()],
    server: { host: true, port: 5173 },
    resolve: {
      alias: page ? [{ find: /^\.\/platform\.ts$/, replacement: resolve(import.meta.dirname, 'src/platform.web.ts') }] : [],
    },
    build: {
      outDir: page ? 'dist-preview' : 'dist',
      target: 'es2020',
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      modulePreload: false,
      chunkSizeWarningLimit: 2000,
      rollupOptions: page ? { external: [/^three(\/.*)?$/] } : {},
    },
  };
});
