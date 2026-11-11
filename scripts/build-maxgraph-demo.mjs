import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';

const result = await build({
  entryPoints: ['src/spikes/maxGraphWiring.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome100',
  loader: { '.gif': 'dataurl', '.ttf': 'dataurl' },
  outdir: '.work/maxgraph-demo-bundle',
  write: false,
  minify: true,
});
const script = result.outputFiles.find(file => file.path.endsWith('.js'))?.text;
const styles = result.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
if (!script) throw new Error('The maxGraph demo did not produce a JavaScript bundle');
const html = `<!doctype html>
<html lang="ru">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NAPS — проверка готового редактора проводов</title>
<style>${styles}\nhtml,body{margin:0;height:100%;font-family:Arial,sans-serif}#heading{height:40px;padding:4px 14px;box-sizing:border-box;background:#edf4ff;color:#153963;font-size:14px;display:flex;align-items:center;gap:10px}#heading button{border:1px solid #a9c3e4;background:white;border-radius:4px;padding:4px 10px;cursor:pointer}#heading button[aria-pressed=true]{background:#1b5bb9;color:white}#stats{height:32px;padding:6px 14px;box-sizing:border-box}#canvas{position:relative;height:calc(100vh - 72px);width:100vw;overflow:hidden;background:#fff}#canvas svg text{pointer-events:none}</style>
</head><body>
<div id="heading">Экспериментальный редактор проводов <button id="tool-select" type="button">Выбор</button><button id="tool-wire" type="button">Проводка</button><button id="undo" type="button">↶</button><button id="redo" type="button">↷</button><button id="open-scm" type="button">Открыть SCM</button><input id="open-scm-input" type="file" accept=".scm,.yaml,.yml" hidden></div>
<div id="stats">Загрузка…</div><div id="canvas"></div>
<script>${script.replaceAll('</script', '<\\/script')}</script>
</body></html>`;
await writeFile('maxgraph-wiring-demo.html', html, 'utf8');
console.log(`Created maxgraph-wiring-demo.html (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MiB)`);
