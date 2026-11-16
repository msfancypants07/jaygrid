import { readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
const source = readFileSync('worker/index.js', 'utf8');
const assets = {
  __PAGE_HTML__: readFileSync('dist/index.html', 'utf8'),
  __PAGE_CSS__: readFileSync('dist/styles.css', 'utf8'),
  __PAGE_JS__: readFileSync('dist/app.js', 'utf8'),
};
let output = source;
for (const [placeholder, content] of Object.entries(assets)) output = output.replace(placeholder, JSON.stringify(content));
mkdirSync('dist/server', { recursive: true });
writeFileSync('dist/server/index.js', output);
mkdirSync('local', { recursive: true });
writeFileSync('local/site.mjs', output);
mkdirSync('public', { recursive: true });
copyFileSync('dist/index.html', 'public/index.html');
copyFileSync('dist/styles.css', 'public/styles.css');
copyFileSync('dist/app.js', 'public/app.js');
