// Renderiza o filme quadro a quadro. O tempo é virtual: cada quadro é calculado
// por render(t), não gravado em tempo real, então o movimento sai perfeitamente
// regular e o mesmo comando sempre produz o mesmo vídeo.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const FPS = 30, W = 1080;
// 4:5 não é recorte do 9:16: o corte decepava o título ou a lista. Aqui o layout
// é reajustado (texto sobe, palco encolhe) e o filme é renderizado de novo.
const QUATRO_CINCO = process.argv.includes('--45');
const H = QUATRO_CINCO ? 1350 : 1920;
const SAIDA = path.join(__dirname, QUATRO_CINCO ? 'rotav3-4x5.mp4' : 'rotav3-9x16.mp4');
const CSS_45 = `
html,body,#palco{height:1350px}
#marca{top:52px}
#texto{top:118px}
.tit{font-size:70px}
.sub{font-size:37px;margin-top:17px}
#cena{top:430px;height:900px;transform:scale(.80);transform-origin:top center}
#abre{transform:translateY(170px) scale(.60);transform-origin:50% 0}
#fim .logo i{height:62px}
#fim .logo span{font-size:78px}
#fim .frase{margin-top:40px;font-size:34px}
#fim .site{margin-top:34px;font-size:40px}
#fim .pe{bottom:78px}
`;

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  p.on('pageerror', (e) => console.log('ERRO:', e.message));
  await p.goto('http://127.0.0.1:8772/filme.html', { waitUntil: 'load' });
  if (QUATRO_CINCO) await p.addStyleTag({ content: CSS_45 });
  await p.evaluate(() => window.__pronto);
  const dur = await p.evaluate(() => window.__dur);
  const total = Math.round(dur * FPS);
  console.log(`${dur}s · ${total} quadros · ${W}x${H} @${FPS}`);

  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-shortest',
    '-c:v', 'libx264', '-profile:v', 'high', '-level', '4.1', '-pix_fmt', 'yuv420p',
    '-crf', '18', '-preset', 'slow', '-tune', 'animation',
    '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', SAIDA]);
  ff.stderr.on('data', (d) => process.stdout.write('ff: ' + d));
  const fim = new Promise((res, rej) => { ff.on('close', (c) => c === 0 ? res() : rej(new Error('ffmpeg saiu ' + c))); });

  for (let i = 0; i < total; i++) {
    await p.evaluate((t) => window.__render(t), i / FPS);
    const buf = await p.screenshot({ type: 'png' });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 150 === 0) console.log('  quadro', i, '/', total);
  }
  ff.stdin.end();
  await fim;
  await b.close();
  console.log('pronto:', SAIDA);
})();
