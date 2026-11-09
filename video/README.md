# Vídeo de apresentação do sistema

Gera o vídeo vertical que apresenta o ROTAV3. As telas são **capturas do sistema de
verdade rodando** (com Firebase simulado e dados de demonstração), e a animação por
cima é calculada quadro a quadro: o tempo é virtual, então o movimento sai regular e
o mesmo comando sempre produz o mesmo vídeo.

## Como rodar

```bash
# 1. servidores locais (um para o sistema, um para o filme)
cd /caminho/do/2slrotav3 && python3 -m http.server 8771 &
cd video && python3 -m http.server 8772 &

# 2. capturar as telas (gera video/telas/)
node capturar.js      # telas do dia todo: mapa, pedidos, rotas, relatório, motorista
node capturar2.js     # a montagem manual, com menos pedidos, para o mapa abrir na região da rota

# 3. renderizar
node renderizar.js        # 1080x1920 (Reels, status e envio no WhatsApp)
node renderizar.js --45   # 1080x1350 (LinkedIn)
```

Depois, para o laço da landing e a capa:

```bash
ffmpeg -ss 9.2 -t 10 -i rotav3-9x16.mp4 -an -vf scale=720:1280 \
  -c:v libx264 -crf 26 -preset slow -tune animation -pix_fmt yuv420p \
  -movflags +faststart rotav3-laco-site.mp4
ffmpeg -ss 17.2 -i rotav3-9x16.mp4 -frames:v 1 -q:v 3 rotav3-poster.jpg
```

## Arquivos

| Arquivo | O que é |
|---|---|
| `dados.js` | Pedidos e rota de demonstração (Guarulhos e Alto Tietê). **Fictícios.** |
| `capturar.js` / `capturar2.js` | Abrem o sistema no Playwright e fotografam as telas |
| `mapa-fundo.svg` | Mapa estilizado desenhado por nós, usado no lugar dos blocos do OpenStreetMap |
| `filme.html` + `roteiro.js` | O filme: layout e a linha do tempo (`render(t)`) |
| `renderizar.js` | Percorre os quadros e manda direto para o ffmpeg, sem gravar PNG em disco |

## Decisões, com o motivo

- **Mapa desenhado por nós.** Os blocos do OpenStreetMap **não são liberados para uso
  comercial** (política de tiles da OSMF), e a CARTO exige chave e crédito. Como o vídeo
  é peça comercial, o fundo do mapa nas capturas é o `mapa-fundo.svg`, que é nosso. No
  sistema de verdade o mapa continua sendo o do OpenStreetMap, com o crédito à vista.
- **Captura quadro a quadro, não gravação.** O `recordVideo` do Playwright grava em
  tempo real e perde quadros (chega a entregar ~9 de 25). Aqui cada quadro é
  `render(t)` + `screenshot`, mandado direto para o ffmpeg pela entrada padrão.
- **Nada de animação em CSS.** Toda a posição e opacidade é calculada em `render(t)`,
  então não existe quadro irregular nem dependência de quando o navegador compõe.
- **Texto grande e queimado na imagem.** Título em 76 px e apoio em 40 px: texto fino
  some depois da compressão do Instagram e do WhatsApp. Legenda separada (SRT) só o
  LinkedIn aceita, e o vídeo precisa funcionar mudo nos três canais.
- **Área segura.** O texto fica entre y=232 e y=1248 no 9:16, respeitando a orientação
  da Meta de deixar 14% do topo e 35% do rodapé livres.
- **Nada de prova social.** Não há depoimento, logo de cliente, número de economia nem
  selo: não temos nenhum deles. O rodapé do fim diz que as imagens são do sistema com
  dados de demonstração.

## Se o sistema mudar de visual

Rode `capturar.js` e `capturar2.js` de novo e renderize. As posições dos pinos saem em
`telas/pontos.json` e `telas/m-pontos.json`, e é delas que a linha da rota se desenha
em cima da imagem — então nada precisa ser ajustado à mão.
