# ROTAV3 — sistema de roteirização

Sistema de roteirização de entregas e coletas da ROTAV3 Systems: pedidos a partir das notas
fiscais, mapa, rotas pelo peso e pela capacidade de cada veículo, histórico das rotas,
motoristas e assistente de IA.

## Estrutura

| Pasta / arquivo | O que é | Onde roda |
|---|---|---|
| `index.html` | A tela do sistema (um arquivo só: HTML, CSS e JavaScript) | GitHub Pages |
| `motorista.html` | A página do motorista (abre pelo link da rota, sem senha) | GitHub Pages |
| `assets/` | Logo, ícone do site e ícones 3D (Fluent Emoji, licença MIT) | GitHub Pages |
| `backend/` | Servidor de rotas em Python (FastAPI + OR-Tools + IA) | Railway |
| `firebase/database.rules.json` | Regras de acesso do banco (Realtime Database) | Console do Firebase |

Banco e login: Firebase, projeto `slog-pedidos` (Realtime Database + Authentication).

## Como o acesso funciona

1. A pessoa entra com **e-mail e senha** (Firebase Authentication).
2. O sistema confere se o usuário está **liberado** em `acesso/<código do usuário>` = `true`.
   Quem entra sem estar liberado vê a tela "Acesso aguardando liberação" com o código para
   mandar ao administrador.
3. As **regras do banco** (`firebase/database.rules.json`) só deixam ler e gravar quem está
   liberado. Ninguém consegue se liberar sozinho: `acesso/` só é alterado pelo console.
4. O **servidor** confere o mesmo login em toda chamada (menos `/status`), perguntando ao
   próprio Firebase se aquele token pode ler `acesso/<código>` (`backend/auth_firebase.py`).

## Entregas e coletas

- Cada pedido é uma **entrega** (do centro de distribuição para o destinatário) ou uma
  **coleta** (do remetente para o centro de distribuição). Pedido antigo, sem tipo, é entrega.
- **Importar** (página Pedidos): escolha "Estas notas são: Entregas | Coletas" e selecione um ou
  vários arquivos (XML da NF-e, Excel, CSV ou PDF).
  - XML: entrega usa o endereço do **destinatário** (ou o grupo `entrega`, se a nota tiver);
    coleta usa o endereço do **emitente** (ou o grupo `retirada`). Peso = soma do peso bruto dos
    volumes (`transp/vol/pesoB`). CT-e e eventos são recusados com aviso.
  - Excel/CSV: uma coluna `tipo` com "coleta" ou "entrega" vale linha a linha; vazia = o que foi
    escolhido na tela.
  - Nota que já saiu para rota (despachada/entregue) não é alterada se for importada de novo.
- **Chave no banco** (`pedidos_rota/<chave>`): entrega = chave de acesso da NF-e (44 dígitos) ou o
  número da nota (planilha); coleta = `C_` + o mesmo. Assim a coleta e a entrega da mesma nota
  convivem, e notas de mesmo número de emitentes diferentes não se sobrescrevem (no XML).
- **Filtro** Todos / Entregas / Coletas nas páginas Pedidos e Mapa.
- **Roteirização**: escolha Entregas, Coletas ou Entregas e coletas. Na viagem mista, o veículo
  sai com as entregas, faz todas elas e só depois as coletas: a carga a bordo nunca passa da
  capacidade (peso das entregas na saída; peso das coletas no fim). Se esse modelo falhar por
  qualquer motivo, o servidor refaz somando entregas + coletas na capacidade (mais conservador) e
  avisa na tela (`regra_carga` na resposta do `/solve`).

## Link do motorista (baixa pelo celular)

1. Ao **confirmar a saída** de uma rota, o sistema cria um link só daquela rota
   (`motorista.html#<código>`, código aleatório de 24 caracteres) que vale **7 dias**.
2. Na página **Rotas**: **Enviar pelo WhatsApp** (abre o WhatsApp com a mensagem e o link),
   **Copiar link** e **Encerrar link**. Rotas antigas têm **Criar link do motorista**.
3. O motorista abre no celular, sem senha, e vê só aquela rota: sequência, endereço, previsão
   de chegada, horário marcado, botões para Google Maps e Waze, e dá baixa:
   - **Entregue / Coletado**: quem recebeu (opcional) e foto do canhoto (opcional).
   - **Não realizado**: motivo (cliente ausente, endereço não encontrado, recusado, fechado,
     avaria, sem tempo, outro) e observação.
   - O celular pode pedir a localização; ela fica guardada junto com a baixa.
   - Sem internet, a baixa fica guardada e é enviada quando a conexão volta (sem fechar a página).
4. O escritório vê o andamento na página Rotas (feitas / não realizadas, ver foto) e o sistema
   atualiza os pedidos: feito → `entregue` ou `coletado`; não realizado → volta para `pendente`
   com a ocorrência. Só mexe no pedido se ele ainda estiver naquela rota (`rota_atual`).
5. **Devolver** a rota volta só o que não teve baixa e encerra o link; **Apagar** também encerra.

Onde fica no banco: `entregador/<código>` com `info`, `paradas` (sem as chaves internas),
`expira`, `baixas/<n>` e `fotos/<n>`. As regras deixam ler esse nó só com o código e só até
`expira`; o motorista só grava baixa (campos validados) e foto (JPEG até ~280 KB) enquanto o link
vale. A foto fica no próprio banco (não precisa de plano pago); o plano gratuito do Firebase
guarda 1 GB, o que dá alguns milhares de fotos.

## Janela de horário (agendados)

- Agendar pede **"Chegar entre"** início e fim (sem fim: 1 hora). Agendamentos antigos, só com
  a hora, valem 30 min antes e depois.
- Na roteirização, escolha **Data da viagem** e **Saída do CD**. Agendados de outro dia ficam de
  fora; os do dia vão com a janela para o motor de rotas, que respeita o horário (pode esperar
  até 3 h numa parada) dentro da jornada de 8 h. Quem não cabe aparece em "ficaram de fora".
- O resultado mostra a chegada prevista em cada parada, que também vai para o motorista.

## Colocar no ar (primeira vez)

### 1. Firebase — ativar o login (console.firebase.google.com → projeto `slog-pedidos`)

1. **Authentication → Começar → Método de login → E-mail/senha → Ativar → Salvar.**
2. **Authentication → Usuários → Adicionar usuário**: e-mail e senha de quem vai usar.
3. Abra o sistema, entre com esse e-mail. Vai aparecer o **código do usuário** (ex.: `a1B2c3…`).
4. **Realtime Database → Dados**: clique no **+** ao lado da raiz e crie
   `acesso` → dentro dele, nome = o código do usuário, valor = `true`.
5. Na tela do sistema, toque em **"Já foi liberado? Tentar de novo"**.
6. **Realtime Database → Regras**: apague o que estiver lá, cole o conteúdo de
   `firebase/database.rules.json` e clique em **Publicar**. (Publicadas em 24/10/2026; as
   pastas antigas `pedidos` e `pedidos_side`, de outro app que não é mais usado, ficaram
   guardadas sem acesso.)

Para liberar outra pessoa, repita os passos 2, 3 e 4. Para tirar o acesso, apague a linha
dela em `acesso` (e, se quiser, desative o usuário em Authentication).

### 2. Centro de distribuição da conta (opcional)

O ponto de saída padrão é Guarulhos. Para trocar, crie no banco:
`config` → `deposito` → `nome` (texto), `lat` (número), `lng` (número).
Exemplo: `nome` = `CD Barueri`, `lat` = `-23.511`, `lng` = `-46.876`.

### 3. Servidor (Railway)

O Railway publica sozinho a pasta `backend/` a cada mudança no ramo `main`.
Variáveis de ambiente usadas:

| Variável | Para quê | Obrigatória |
|---|---|---|
| `GROQ_API_KEY` | Assistente de IA | Sim, para o chat |
| `ALLOWED_ORIGINS` | Endereços que podem chamar o servidor, separados por vírgula. Se existir, precisa incluir `https://hesantss-pixel.github.io` | Não (o padrão já inclui) |
| `FIREBASE_SECRET` | Chave antiga do banco, só para `/pedidos`, `/upload-nf` e TOTVS. Sem ela, a tela salva a prévia da rota sozinha | Não |
| `FIREBASE_PROJECT_ID` / `FIREBASE_URL` | Outro projeto Firebase | Não |
| `DOCS_PUBLICAS=1` | Mostra a documentação em `/docs` | Não |

Verificação: `https://rotainteligente2sl-production.up.railway.app/status` deve responder
`"versao": "3.2.0"` e `"login": "obrigatório"`.

### 4. Tela (GitHub Pages)

Settings → Pages → Deploy from a branch → `main` / `(root)`.
Endereço: `https://hesantss-pixel.github.io/2slrotav3/`.

## Rodar no computador

Tela: dentro desta pasta, `python3 -m http.server 8080` e abra `http://localhost:8080`.

Servidor:

```bash
cd backend
pip install -r requirements.txt
GROQ_API_KEY=... uvicorn main:app --reload --port 8000
```

Para testar o servidor sem login: `AUTH_REQUIRED=0`. Para a tela usar o servidor local,
troque `BACKEND_URL` no `index.html`.

## Testes

- Servidor: `cd backend && python3 -m unittest discover -s tests`.
  - Login: token ausente, malformado, de outro projeto, vencido, recusado pelo Firebase, usuário
    sem liberação, liberado com cache, Firebase fora do ar; toda rota, menos `/status`, exige login.
  - Motor de rotas (`tests/test_vrp_coletas.py`): só entregas, só coletas, pedidos antigos sem
    tipo, viagem mista com entregas antes das coletas, capacidade, limite de paradas, plano B e
    janela de horário (ordem decidida pela janela, espera até abrir, janela que já passou,
    janela impossível pelo caminho, sem hora de saída).
    Roda com um OR-Tools simulado (`tests/fake_ortools.py`, força bruta com as mesmas regras de
    dimensão), porque o pacote não instala no ambiente de testes; as chamadas usadas são as dos
    exemplos oficiais do OR-Tools 9.9.
- Tela: testada com um Firebase simulado (login, senha errada, esqueci a senha, acesso
  pendente, liberação, dashboard, regiões a partir dos pedidos, importação de CSV,
  roteirização com o token, confirmação de saída, motoristas, agendamento, chat, sair; e
  coletas/entregas: XML como coleta e como entrega, local de retirada/entrega, nota sem peso,
  CT-e e XML quebrado recusados, CSV com coluna tipo, nota já em rota preservada, nomes com HTML
  exibidos como texto, filtros, mapa, rota mista, confirmação e devolução por chave; e link do
  motorista: data/saída/janela enviadas ao motor, agendado de outro dia fora, link criado ao
  confirmar, WhatsApp, página do motorista no celular, baixa com foto compactada e localização,
  não realizado com motivo, correção, link encerrado/cortado, escritório aplicando as baixas,
  foto no escritório, encerrar link, devolver sem desfazer o que foi entregue),
  em 1440 px e no celular (390 px).

Não testado daqui: o Firebase e o Railway de verdade (bloqueados neste ambiente), o motor
OR-Tools rodando (não instalado aqui) e o mapa com as ruas.

## Histórico

- Versão 3.2 (24/10/2026): banco fechado com as regras publicadas; link do motorista pelo
  WhatsApp com baixa (entregue/coletado/não realizado, foto do canhoto, localização) e
  acompanhamento no escritório; janela de horário no motor de rotas, data da viagem e hora de
  saída, previsão de chegada por parada; agendados de outro dia ficam fora da viagem.
- Versão 3.1 (24/10/2026): entregas e coletas — importação como entrega ou coleta (inclui XML da
  NF-e, vários arquivos de uma vez), filtro nas páginas Pedidos e Mapa, pinos diferentes,
  roteirização de entregas, coletas ou as duas na mesma viagem (entregas primeiro), chave única por
  nota, reimportação não mexe em nota já despachada, aviso de pedidos sem localização exata.
- Versão 3 (24/10/2026): identidade ROTAV3, login com e-mail e senha, liberação por usuário,
  regras do banco, servidor exigindo login, regiões montadas a partir dos próprios pedidos,
  centro de distribuição configurável, nomes de cidades padronizados na importação, cópias
  antigas removidas (a tela que vale é `index.html`; o servidor é `backend/`), correção de um
  erro de sintaxe que desligava a sincronização TOTVS.
- Versões anteriores: demonstração com a identidade da Via Verde Transportes (histórico do Git).
