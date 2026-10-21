import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sample = `data:image/svg+xml;base64,${(await readFile(resolve(root, 'public/sample.svg'))).toString('base64')}`;
const worker = await readFile(resolve(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'), 'utf8');
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/main.tsx'],
  outfile: '/tmp/moa-single-file.js',
  bundle: true,
  write: false,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  plugins: [{
    name: 'standalone-preview',
    setup(builder) {
      builder.onLoad({filter: /src\/App\.tsx$/}, async ({path}) => {
        let contents = await readFile(path, 'utf8');
        contents = contents.replace('loadImage("/sample.svg")', `loadImage(${JSON.stringify(sample)})`);
        contents = contents.replace('fetch("/api/health")', 'Promise.resolve(new Response(JSON.stringify({ok:true,aiConfigured:false,backgroundAiConfigured:false,inpaintConfigured:false})))');
        return {contents, loader: 'tsx'};
      });
      builder.onLoad({filter: /src\/lib\/files\.ts$/}, async ({path}) => {
        let contents = await readFile(path, 'utf8');
        contents = contents.replace(/pdfjs\.GlobalWorkerOptions\.workerSrc = new URL\([\s\S]*?\)\.href;/, () => `pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([${JSON.stringify(worker)}], {type: 'text/javascript'}));`);
        return {contents, loader: 'ts'};
      });
    },
  }],
});
const js = result.outputFiles.find(f => f.path.endsWith('.js')).text.replace(/<\/script/gi, '<\\/script');
const css = result.outputFiles.find(f => f.path.endsWith('.css')).text;
const html = `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>모아 스튜디오 · HTML 미리보기</title><style>${css}</style><style>.standalone-note{background:#f0eafa;color:#765697;font:11px/1.8 sans-serif;text-align:center;padding:8px 16px}.standalone-note strong{font-weight:700}</style></head><body><div class="standalone-note"><strong>HTML 미리보기</strong> · 사진 올리기, 주변색 지우기, 단색 배경 제거, 크기 변경, 파일 저장을 사용할 수 있어요. 서버가 필요한 AI 배경 제거와 AI 대화는 이 파일에서 꺼져 있어요.</div><div id="root"></div><script>${js}</script></body></html>`;
for (const name of ['preview.html', 'preview.htm']) {
  await writeFile(resolve(root, name), html);
  console.log(`Created ${name}: ${Buffer.byteLength(html)} bytes`);
}
