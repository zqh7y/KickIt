// Builds the single-file browser preview (the playable link): runs the
// preview-page Vite build, then inlines CSS + JS into one page body.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const THREE = '0.186.1';
execSync('npx vite build --mode preview-page', { stdio: 'inherit' });
const dir = 'dist-preview';
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const pick = (re) => (html.match(re) || [])[1];
const tokens = pick(/<style id="theme-tokens">([\s\S]*?)<\/style>/);
const cssHref = pick(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/);
const jsSrc = pick(/<script type="module"[^>]*src="\.\/([^"]+)"/);
const body = pick(/<body>([\s\S]*?)<\/body>/).replace(/<script[\s\S]*?<\/script>/g, '').trim();
const css = readFileSync(join(dir, cssHref), 'utf8');
const js = readFileSync(join(dir, jsSrc), 'utf8').replace(/<\/script/gi, '<\\/script');
const importmap = {
  imports: {
    three: `https://cdn.jsdelivr.net/npm/three@${THREE}/build/three.module.js`,
    'three/examples/jsm/': `https://cdn.jsdelivr.net/npm/three@${THREE}/examples/jsm/`,
  },
};
const page = `<title>Kick-It!</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style id="theme-tokens">${tokens}</style>
<style>${css}</style>
${body}
<script type="importmap">${JSON.stringify(importmap)}</script>
<script type="module">${js}</script>
`;
mkdirSync('preview', { recursive: true });
writeFileSync('preview/kickit.html', page);
console.log(`preview/kickit.html ${(page.length / 1024).toFixed(0)} KB`);
