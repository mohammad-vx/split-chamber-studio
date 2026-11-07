// Builds the website version of the Studio into dist-web/ (static files, no bundler):
//   src/**            → dist-web/**          (the same renderer code the desktop app runs)
//   web/host-web.js   → dist-web/host-web.js (window.host on IndexedDB + in-page media checks)
//   web/sw.js         → dist-web/sw.js       (serves library media under ./lib/)
//   mediabunny bundle → dist-web/vendor/     (import path rewritten in export.worker.js)
// Usage: node tools/build-web.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(root, process.argv[2] || 'dist-web');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'src'), out, { recursive: true });
fs.mkdirSync(path.join(out, 'vendor'), { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules/mediabunny/dist/bundles/mediabunny.min.mjs'), path.join(out, 'vendor/mediabunny.min.mjs'));

const edit = (rel, fn) => { const f = path.join(out, rel); const before = fs.readFileSync(f, 'utf8'); const after = fn(before); if (after === before) throw new Error(`build-web: no change applied to ${rel}`); fs.writeFileSync(f, after); };

edit('export/export.worker.js', (s) => s.replace('../../node_modules/mediabunny/dist/bundles/mediabunny.min.mjs', '../vendor/mediabunny.min.mjs'));
edit('index.html', (s) => s
  .replace(/ lib:/g, '')
  .replace('<script type="module" src="ui/app.js"></script>', '<script type="module" src="host-web.js"></script>\n  <script type="module" src="ui/app.js"></script>')
  .replace('>Show in folder<', '>Download video<')
  .replace('</head>', '  <style>#btn-folder{display:none}</style>\n</head>'));
fs.writeFileSync(path.join(out, 'host-web.js'), fs.readFileSync(path.join(root, 'web/host-web.js'), 'utf8').replace('__APP_VERSION__', version));
fs.copyFileSync(path.join(root, 'web/sw.js'), path.join(out, 'sw.js'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');

let files = 0, bytes = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { files++; bytes += fs.statSync(p).size; } } };
walk(out);
console.log(`web build ${version}: ${files} files, ${(bytes / 1e6).toFixed(1)} MB → ${path.relative(root, out)}`);
