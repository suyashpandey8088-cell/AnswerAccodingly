import { build } from 'esbuild';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const extDir = resolve(root, 'extension');
const assetsDir = resolve(extDir, 'assets');

mkdirSync(assetsDir, { recursive: true });

await build({
  entryPoints: {
    'service-worker': resolve(root, 'src/extension/service-worker.ts'),
    'content-script': resolve(root, 'src/extension/content-script.ts'),
    popup: resolve(root, 'src/extension/popup-main.ts'),
    dashboard: resolve(root, 'src/dashboard/main.ts')
  },
  outdir: assetsDir,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: false,
  minify: false,
  loader: {
    '.css': 'empty'
  }
});

copyFileSync(
  resolve(root, 'src/dashboard/styles.css'),
  resolve(assetsDir, 'styles.css')
);

writeFileSync(
  resolve(extDir, 'popup.html'),
  `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>QuizPilot AI — Extension Popup</title>
    <link rel="stylesheet" href="assets/styles.css" />
  </head>
  <body class="popup-page-wrapper">
    <div id="popup-root"></div>
    <script type="module" src="assets/popup.js"></script>
  </body>
</html>
`
);

writeFileSync(
  resolve(extDir, 'dashboard.html'),
  `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>QuizPilot AI — Full Dashboard</title>
    <link rel="stylesheet" href="assets/styles.css" />
  </head>
  <body>
    <div id="dashboard-root"></div>
    <script type="module" src="assets/dashboard.js"></script>
  </body>
</html>
`
);

console.log('Successfully built Chrome Extension Manifest V3 package into ./extension/');
