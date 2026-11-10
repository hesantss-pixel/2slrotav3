// Recebe as gravações que o Firebase simulado recusou durante a bateria (valor com
// undefined, chave inválida, update de pai e filho juntos) e guarda em recusas.log.
// O Firebase de verdade recusaria as mesmas, então cada linha aqui é um erro real.
const http = require('http'), fs = require('fs'), path = require('path');
const LOG = path.join(__dirname, 'recusas.log');
http.createServer((req, res) => {
  let corpo = '';
  req.on('data', (d) => { corpo += d; });
  req.on('end', () => {
    if (req.method === 'POST' && corpo) fs.appendFileSync(LOG, (process.env.SUITE_ATUAL || '') + corpo.replace(/\n/g, ' ') + '\n');
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*' }); res.end();
  });
}).listen(8779, '127.0.0.1');
