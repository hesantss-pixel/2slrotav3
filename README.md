# ROTAV3 — sistema de roteirização

Sistema de roteirização de entregas e coletas da ROTAV3 Systems: pedidos a partir das notas
fiscais, mapa, rotas pelo peso e pela capacidade de cada veículo, histórico das rotas,
motoristas e assistente de IA.

## Estrutura

| Pasta / arquivo | O que é | Onde roda |
|---|---|---|
| `index.html` | A tela do sistema (um arquivo só: HTML, CSS e JavaScript) | GitHub Pages |
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

## Colocar no ar (primeira vez)

### 1. Firebase — ativar o login (console.firebase.google.com → projeto `slog-pedidos`)

1. **Authentication → Começar → Método de login → E-mail/senha → Ativar → Salvar.**
2. **Authentication → Usuários → Adicionar usuário**: e-mail e senha de quem vai usar.
3. Abra o sistema, entre com esse e-mail. Vai aparecer o **código do usuário** (ex.: `a1B2c3…`).
4. **Realtime Database → Dados**: clique no **+** ao lado da raiz e crie
   `acesso` → dentro dele, nome = o código do usuário, valor = `true`.
5. Na tela do sistema, toque em **"Já foi liberado? Tentar de novo"**.
6. **Realtime Database → Regras**: apague o que estiver lá, cole o conteúdo de
   `firebase/database.rules.json` e clique em **Publicar**.

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
`"versao": "3.0.0"` e `"login": "obrigatório"`.

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

- Servidor: `cd backend && python3 -m unittest discover -s tests` (login: token ausente,
  malformado, de outro projeto, vencido, recusado pelo Firebase, usuário sem liberação,
  liberado com cache, Firebase fora do ar; e confere que toda rota, menos `/status`, exige login).
- Tela: testada com um Firebase simulado (login, senha errada, esqueci a senha, acesso
  pendente, liberação, dashboard, regiões a partir dos pedidos, importação de CSV,
  roteirização com o token, confirmação de saída, motoristas, agendamento, chat, sair),
  em 1440 px e no celular (390 px).

Não testado daqui: o Firebase e o Railway de verdade (bloqueados neste ambiente), o motor
OR-Tools rodando (não instalado aqui) e o mapa com as ruas.

## Histórico

- Versão 3 (24/10/2026): identidade ROTAV3, login com e-mail e senha, liberação por usuário,
  regras do banco, servidor exigindo login, regiões montadas a partir dos próprios pedidos,
  centro de distribuição configurável, nomes de cidades padronizados na importação, cópias
  antigas removidas (a tela que vale é `index.html`; o servidor é `backend/`), correção de um
  erro de sintaxe que desligava a sincronização TOTVS.
- Versões anteriores: demonstração com a identidade da Via Verde Transportes (histórico do Git).
