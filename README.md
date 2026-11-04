# ROTAV3 — sistema de roteirização

Sistema de roteirização de entregas e coletas da ROTAV3 Systems: pedidos a partir das notas
fiscais, mapa, rotas pelo peso e pela capacidade de cada veículo, histórico das rotas,
motoristas e assistente de IA.

## Estrutura

| Pasta / arquivo | O que é | Onde roda |
|---|---|---|
| `index.html` | A tela do sistema (um arquivo só: HTML, CSS e JavaScript) | GitHub Pages |
| `motorista.html` | A página do motorista (abre pelo link da rota, sem senha) | GitHub Pages |
| `assets/` | Logo e ícone do site | GitHub Pages |
| `backend/` | Servidor de rotas em Python (FastAPI + OR-Tools + IA) | Railway |
| `firebase/database.rules.json` | Regras de acesso do banco (Realtime Database) | Console do Firebase |

Banco e login: Firebase, projeto `slog-pedidos` (Realtime Database + Authentication).

## Visual: ícones próprios, sem emoji (versão 3.8)

Toda a interface usa **um conjunto de ícones desenhado para o sistema**, não emoji. Emoji é
desenhado pelo aparelho de quem olha: muda de forma e de cor entre Android, iPhone e Windows,
e não combina com a identidade (preto, azul-marinho, dourado, branco).

- Os ícones ficam num **sprite SVG** logo depois do `<body>` do `index.html` (e um menor no
  `motorista.html`), usados como `<svg class="ic"><use href="#i-..."/></svg>`.
- Padrão: grade 24×24, traço 1,75, pontas arredondadas, **cor herdada do texto** (`currentColor`),
  tamanho em `em` — o ícone acompanha a fonte de onde está.
- **Veículos**: Fiorino, VUC, Toco, Bitruck e Carreta são silhuetas desenhadas na **mesma escala**
  (`viewBox="0 0 48 24"`), então o tamanho do desenho mostra o porte: o Fiorino ocupa 16 das 48
  unidades e a carreta, 45. Um teste confere que essa ordem não se perde.
- **Cores das regiões** (`CORES_REGIAO`): uma família só, puxando para o dourado e o azul-marinho,
  com saturação contida. Elas ligam a lista de cidades às bolhas do mapa, por isso continuam
  distinguíveis entre si.
- Rótulos de campo em frase, não em CAIXA ALTA espaçada.
- Para acrescentar um ícone: crie o `<symbol id="i-nome">` no sprite e use `#i-nome`. Não voltar a
  usar emoji nem imagem PNG de ícone.

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

## Pedido à mão e local no mapa

- **Novo pedido** (página Pedidos): entrega ou coleta, nota/nº do pedido, cliente, CEP, rua e
  número, bairro, cidade, UF, peso, volumes e urgente. O CEP completa rua, bairro, cidade e UF
  (ViaCEP) sem apagar o que já foi digitado. Grava em `pedidos_rota/<chave>` com
  `origem: "manual"` e `criadoEm`.
- **Editar**: toque no pedido (na lista da região ou no pino da página Mapa). Trocar entrega ↔
  coleta muda a chave (`C_`), copiando os outros campos da nota (chave da NF-e, remetente…).
  Pedido que já saiu em rota abre só para leitura ("devolva a rota para mudar").
- **Excluir**: só pedidos pendentes, com confirmação.
- **Local no mapa**: "Buscar pelo endereço" usa a mesma ordem da importação (veja "Como o
  sistema acha o endereço" abaixo) e diz o que achou: o número, só a rua, só o bairro ou só a
  cidade. O pino pode ser arrastado ou colocado com um toque no mapa (`geoManual: true`). Mudar só
  o cliente ou o peso mantém o local salvo; mudar o endereço sem marcar o ponto volta para o
  centro da cidade e o endereço é localizado em segundo plano.
- A página Pedidos avisa quantos pendentes estão sem local exato (sem ponto, ou só com o bairro
  ou a cidade) e marca cada um.
- Número repetido: pergunta antes de trocar; se a nota com esse número já saiu em rota, não deixa.
- Nos dados de exemplo (banco vazio) e na demonstração com as regras antigas, as mudanças ficam
  só na tela. Cadastrar o primeiro pedido de verdade tira os pedidos de exemplo, como a importação.
- O Nominatim recebe no máximo 1 consulta por segundo (a política dele pede isso).

## Como o sistema acha o endereço (versão 3.7)

Para cada pedido, nesta ordem:

1. **Ponto já corrigido à mão para o mesmo endereço** (a empresa marcou o pino uma vez):
   usa direto, sem consultar o mapa.
2. **Endereço já localizado antes** (até 90 dias): usa direto.
3. **Rua + número** no Nominatim (OpenStreetMap), com o nome oficial da rua que o CEP dá
   (ViaCEP), a cidade e o estado. Só vale se o mapa devolver aquele número e se ele ficar a até
   6 km da rua do CEP (mais longe é provavelmente outra rua com o mesmo nome).
4. **CEP**: rua do CEP; sem a rua, o bairro; sem o bairro, a cidade.
5. **Sem CEP** (planilha ou pedido à mão): a rua na cidade; sem achar, a cidade.

O pedido guarda de onde veio o ponto em `geoPrec`: `numero`, `rua`, `bairro`, `cidade`,
`manual` (pino marcado no pedido), `lembrado` (ponto marcado antes para o endereço) ou
`endereco` (busca de antes da 3.7). `bairro` e `cidade` aparecem como "local aproximado" na lista,
no mapa e na rota.

- **Lembrar o ponto**: ao salvar um pedido com o pino marcado à mão, o ponto fica guardado em
  `empresas/<id>/config/locais/<chave>` (`{lat, lng, p: "manual", em}`) e os outros pedidos
  pendentes do mesmo endereço recebem o mesmo ponto. Notas novas do mesmo endereço já entram no
  ponto certo. Marcar de novo troca o ponto guardado.
- **Chave do endereço**: CEP (ou a cidade, sem CEP) + número + nome da rua sem acento, sem
  "Rua/Av." e com abreviações por extenso ("R. Dr. João Silva, 12" = "Rua Doutor João Silva, 12").
  Complemento ("- sala 2", "fundos") não entra. Sem o nome da rua, nada é guardado.
- O cache geral `geo_cache/<cep>` guarda só o resultado do CEP (dado público, sem número nem
  cliente); agora com a rua oficial e a precisão (`prec`). CEP gravado antes da 3.7 é procurado
  de novo uma vez para saber a precisão.
- Pedidos localizados só pelo CEP antes da 3.7 que têm número são procurados de novo uma vez: o
  ponto só muda se o número for achado (ou houver ponto marcado à mão para o endereço).
- Planilha: além de `tipo`, lê as colunas `endereço` (ou `logradouro`/`rua`), `número`
  (ou `nº`/`nro`), `bairro` e `uf`/`estado`.
- **Limite real**: o OpenStreetMap não tem o número de toda rua (em Guarulhos, muitas ruas não
  têm). Nesses casos o ponto fica na rua do CEP, e o jeito de acertar é marcar o pino uma vez.
- **Limite de uso**: o Nominatim público aceita no máximo 1 consulta por segundo e não é feito
  para uso pesado. Com muitas empresas importando muitas notas, trocar por um serviço pago de
  endereços ou um Nominatim próprio.
- Nenhuma regra nova no banco: `config` já pode ser gravado pela empresa.

## Entrada automática de pedidos (versão 3.7)

Para quem recebe pedido o dia todo e não quer ficar subindo arquivo. Fica na página
Pedidos, em **"Receber pedidos automaticamente"** (fechado por padrão). Dois caminhos,
que podem ser usados juntos:

**1. Por e-mail.** A empresa ganha dois endereços só dela, criados no botão
"Criar endereço de e-mail":

    pedidos.rotav3+<código>@gmail.com          → entregas
    pedidos.rotav3+<código>-coleta@gmail.com   → coletas

O cliente manda (ou a transportadora encaminha) o XML da NF-e para lá; aceita vários
anexos e .zip. O servidor lê a caixa a cada 1 minuto (IMAP, com senha de app) e grava
os pedidos. O código fica em `integracao_email/<código>` → `{eid}`; trocar o endereço
apaga o antigo na hora.

**2. Pelo sistema da empresa (API).** O botão "Gerar chave da API" devolve uma chave
`rv3_…` que **aparece uma vez só** (o banco guarda apenas o sha256, em
`integracao_chaves/<hash>`). Com ela:

    POST /entrada/xml       Authorization: Bearer <chave>   (XML no corpo, ou vários em multipart; ?tipo=coleta)
    POST /entrada/pedidos   Authorization: Bearer <chave>   {"tipo":"entrega","pedidos":[{nf,cidade,peso,...}]}

Regras das duas entradas:
- Os pedidos entram em `empresas/<id>/pedidos_rota` com `origem: "email"|"api"`, lidos
  com as mesmas regras da tela (mesma chave de pedido, mesma leitura da NF-e).
- **Pedido que já existe não é alterado**: reenviar a mesma nota não apaga edição nem
  local corrigido. Para mudar, use a tela.
- XML de cancelamento tira a nota dos pendentes; se já está em rota, fica e o aviso
  aparece nos recebimentos.
- Cada recebimento fica em `empresas/<id>/entrada_log` (últimos 100) e aparece em
  "Últimos recebimentos".
- Limite de 600 envios por hora por empresa; até 500 pedidos por envio; 20 MB por envio
  na API e 5 MB por XML no e-mail.
- Com a tela aberta, o pedido que chega aparece na hora, avisa no rodapé e é localizado
  no mapa sem recarregar.

Para ligar no servidor (Railway → Variables): `FIREBASE_SECRET` (já existe),
`ENTRADA_EMAIL_USUARIO`, `ENTRADA_EMAIL_SENHA` (senha de app do Google, 16 letras) e,
se quiser, `ENTRADA_EMAIL_IMAP` (padrão `imap.gmail.com`) e `ENTRADA_EMAIL_INTERVALO`
(padrão 60 s). Sem essas duas, só a entrada por API funciona, e `/status` mostra o que
está ligado em `entrada_automatica`.

## Buscar e excluir notas (nota cancelada, importada por engano…)

- **Buscar notas** (página Pedidos, também no celular): por NF, cliente, cidade, bairro ou
  endereço (sem acento), e por parte da chave de acesso ou do CEP. Vários números separados por
  espaço ou vírgula buscam uma lista de notas (NF com ou sem zeros à esquerda) e mostram as que
  não foram encontradas. A busca do topo (computador) usa a mesma busca.
- Marque as notas (ou "Selecionar todas") e toque em **Excluir notas**: confirmação, exclusão de
  uma vez no banco e **Desfazer** por 30 segundos (volta a cópia completa de cada nota).
  Nota **em rota** aparece, mas não pode ser marcada: devolva a rota na página Rotas antes.
- **XML de cancelamento**: importar o XML do evento de cancelamento da NF-e (tipo 110111 ou
  110112) acha a nota pela chave de acesso e pergunta se tira dos pendentes (com Desfazer). Se a
  nota já está em rota, avisa para devolver a rota; se não está no sistema, avisa. Carta de
  correção (110110) é recusada com mensagem.
- Excluir um pedido enquanto ele é localizado no mapa não o recria (a fila confere se ele ainda
  existe antes de gravar o local).

## Ajuste manual da rota (antes de confirmar a saída)

- Depois de gerar a rota, **Ajustar a rota** mostra, em cada parada: subir, descer, tirar da
  rota e (com mais de uma viagem) mover para outra viagem. Embaixo, **Adicionar parada** lista os
  pendentes desta viagem (mesmo tipo e data), com busca. Parada tirada continua pendente.
- A cada mudança, a tela estima na hora (linha reta) e pede ao servidor a medida da ordem nova
  (`POST /avaliar`: km, tempo total e chegada em cada parada, pelo OSRM, com 15 min por parada e
  espera pela janela). Mudanças seguidas geram uma medição só. Sem resposta do servidor, fica a
  estimativa em linha reta, com aviso.
- **Otimizar a ordem**: o motor reordena só as paradas que estão na rota (todas continuam nela).
  **Desfazer ajustes** volta todas as viagens ao que o sistema montou.
- Avisos na rota: passa da capacidade (carga máxima a bordo), mais paradas que o limite, parada
  que chega depois do horário marcado, viagem com mais de 8 horas. Ao confirmar com algum aviso,
  o sistema pergunta antes.
- Ao confirmar, espera a medição terminar e confere se todos os pedidos ainda estão pendentes
  (excluídos ou despachados em outra aba bloqueiam). A rota vai para `rotas_confirmadas` na ordem
  ajustada, com `ajustada: true`, e o link do motorista sai nessa ordem.
- Rota já confirmada não é editada (as baixas do motorista são guardadas pela posição da parada).
  Para mudar, use **Devolver** na página Rotas e gere de novo.
- "Gerar outra rota" ou sair da página Roteirização descarta a rota que não foi confirmada.

## Conta de demonstração e página Acessos

- **Acessos** (só o administrador, `ADMIN_UID` no `index.html` e nas regras): cria acesso de
  demonstração (nome e e-mail opcionais, validade de 3 a 30 dias, senha gerada) e monta a mensagem
  com link, e-mail e senha para mandar pelo WhatsApp; lista pedidos de acesso (quem entrou e não
  foi liberado) com "Liberar demonstração", "Liberar completo" e "Ignorar"; encerra demonstrações e
  tira acessos. O usuário novo é criado numa instância separada do login, então o administrador
  continua conectado.
- **Separação por empresa** (regras em `firebase/database.rules.json`): cada cliente grava em
  `empresas/<id>/` (`pedidos_rota`, `rotas`, `rotas_confirmadas`, `motoristas`, `config`) e só lê
  a própria área. Quem é de qual empresa fica em `membros/<uid>`, definido só pelo administrador
  na página Acessos ("Liberar completo", "Ligar à empresa", "Trocar empresa", "Virar cliente").
  A operação do administrador é `empresas/principal`: na primeira entrada dele com as regras novas,
  a tela copia o que estava na raiz para lá (a raiz fica como cópia de segurança, só para ele). Os
  links de motorista (`entregador/<token>`) guardam `eid`, e só a empresa dona lê as baixas.
  Com as regras antigas publicadas, a tela continua funcionando como antes (dados na raiz).
- **Conta de demonstração** (`acesso/<uid>` = `"demo"`, validade em `demos/<uid>`): começa com
  86 pedidos fictícios. Ao importar as próprias notas, elas substituem o exemplo e ficam salvas em
  `empresas/demo_<uid>`, só para essa pessoa, até a demonstração vencer ("Voltar aos dados de
  exemplo" apaga). Gerar rota (servidor real), confirmar, link do motorista de exemplo
  (`motorista.html#demo=…`, sem link real), veículo e baixas simulados, mapa e IA funcionam.
  "Virar cliente" leva as notas e rotas da demonstração para a empresa nova. Vencida, mostra
  "Seu acesso de demonstração terminou" com o WhatsApp.
- **Centro de distribuição**: em Roteirização (e na faixa da demonstração), o cliente informa o
  CEP do CD; fica em `empresas/<id>/config/deposito` e as rotas saem de lá.
- No servidor, a demonstração só usa `/solve` e `/chat`, com limite (30 rotas e 40 perguntas por
  hora, motor com no máximo 10 s). `/pedidos`, `/upload-nf` e `/sync` leem e gravam direto em
  `empresas/principal` e são só do administrador (`ADMIN_UID`, `EMPRESA_PRINCIPAL` no Railway).
- `motorista.html#demo` abre uma rota de exemplo fixa em Guarulhos (usada na página de vendas).

## Localização ao vivo do motorista

- Na página do motorista, o cartão **Localização ao vivo** fica desligado até o motorista ligar
  (consentimento). Ligado, manda a posição a cada 45 s (ou antes, se andou 150 m) para
  `entregador/<código>/posicao`, enquanto a página estiver aberta. Desliga sozinho quando todas as
  paradas têm baixa ou o link é encerrado. Reabrindo a página, volta a compartilhar se a permissão
  já foi dada.
- No escritório: veículo no mapa da rota (página Rotas) e no Mapa, com "visto há N min" (cinza
  depois de 10 min sem atualizar).
- Não é o rastreador do veículo: com a tela apagada ou em outro app, o celular pode pausar o envio.
- Página Mapa: cartão "Sua frota ainda não tem rastreador?" (pacote sistema + rastreador 4G, valor
  sob consulta) com botão para o WhatsApp da ROTAV3. Não aparece para o administrador. Diz que a
  posição do rastreador no mapa está em implantação: trocar o texto quando a integração existir.

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

## Fundo dos mapas

O fundo dos mapas é o do **OpenStreetMap** (com o crédito exigido). O da CARTO (Voyager), usado
antes, passou a exigir chave em set/2026 e mostrava "API KEY REQUIRED". A chave da CARTO é
grátis (uso comercial até 1 milhão de blocos por mês); com ela, preencha `CARTO_KEY` no
`index.html` e confira o nome do parâmetro na documentação da CARTO. Paradas no mesmo ponto
(até 30 m) aparecem num marcador só ("1–6"), e paradas sem endereço exato são avisadas.

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

### 2. Regras do banco (separação por empresa)

Realtime Database → Regras: cole o conteúdo de `firebase/database.rules.json` e clique em
Publicar. Depois, entre uma vez com a conta do administrador: a tela copia os dados antigos para
`empresas/principal`. O centro de distribuição de cada empresa é definido pelo CEP em Roteirização.

### 3. Servidor (Railway)

O Railway publica sozinho a pasta `backend/` a cada mudança no ramo `main`.
Variáveis de ambiente usadas:

| Variável | Para quê | Obrigatória |
|---|---|---|
| `GROQ_API_KEY` | Assistente de IA | Sim, para o chat |
| `ALLOWED_ORIGINS` | Endereços que podem chamar o servidor, separados por vírgula. Se existir, precisa incluir `https://hesantss-pixel.github.io` | Não (o padrão já inclui) |
| `FIREBASE_SECRET` | Chave antiga do banco: `/pedidos`, `/upload-nf`, TOTVS e **a entrada automática de pedidos**. Sem ela, a tela salva a prévia da rota sozinha | Só para a entrada automática |
| `ENTRADA_EMAIL_USUARIO` / `ENTRADA_EMAIL_SENHA` | Caixa que recebe os XML e a senha de app do Google (16 letras) | Só para a entrada por e-mail |
| `ENTRADA_EMAIL_IMAP` / `ENTRADA_EMAIL_INTERVALO` | Servidor IMAP (padrão `imap.gmail.com`) e segundos entre leituras (padrão 60) | Não |
| `FIREBASE_PROJECT_ID` / `FIREBASE_URL` | Outro projeto Firebase | Não |
| `DOCS_PUBLICAS=1` | Mostra a documentação em `/docs` | Não |

Verificação: `https://rotainteligente2sl-production.up.railway.app/status` deve responder
`"versao": "3.7.0"`, `"login": "obrigatório"` e `entrada_automatica` dizendo o que está
ligado (`api` e `email`). Enquanto o Railway não publicar a versão nova, a tela continua
funcionando com a importação de arquivo e o cartão de entrada automática avisa que o
servidor ainda não foi configurado.

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
  - Entrada automática (`tests/test_entrada.py`, `tests/test_entrada_api.py`): leitura da
    NF-e igual à da tela (grupo entrega/retirada, peso e volumes, CEP incompleto, sem
    chave, ISO-8859-1, cancelamento, carta de correção, CT-e e XML quebrado), pedido em
    JSON e suas validações, gravação sem mexer no que já existe, cancelamento de
    pendente e de nota em rota, registro dos últimos 100 recebimentos, chave e endereço
    (o antigo para de valer, a chave só guarda o hash), limite por hora, e-mail
    (código no endereço, .zip, anexo que não é XML, código desconhecido, e-mail que fica
    para depois quando o banco cai) e as rotas do servidor com um substituto do FastAPI.
  - Login: token ausente, malformado, de outro projeto, vencido, recusado pelo Firebase, usuário
    sem liberação, liberado com cache, Firebase fora do ar; toda rota, menos `/status`, exige login.
  - Motor de rotas (`tests/test_vrp_coletas.py`): só entregas, só coletas, pedidos antigos sem
    tipo, viagem mista com entregas antes das coletas, capacidade, limite de paradas, plano B e
    janela de horário (ordem decidida pela janela, espera até abrir, janela que já passou,
    janela impossível pelo caminho, sem hora de saída) e medida da rota ajustada (`/avaliar`:
    mantém a ordem, ordem ruim custa mais km, atendimento, espera da janela, jornada, limite de
    paradas e mesma conta do motor para a mesma ordem).
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
- Versão 3.5 (pedido à mão e ajuste da rota), com a separação por empresa: cadastro com CEP que
  completa o endereço, busca pelo endereço, ponto marcado no mapa, edição que mantém o local,
  troca entrega ↔ coleta preservando a nota, NF repetida, exclusão, pino do Mapa abrindo o pedido,
  dados de exemplo sem gravar; ajuste com subir/descer/tirar/adicionar, medição pelo servidor
  (e estimativa quando ele falha), várias mudanças em uma medição, otimizar, desfazer, avisos de
  capacidade, confirmação com aviso, rota salva na ordem ajustada com o link do motorista, pedido
  despachado em outra aba bloqueando a confirmação; em 1440, 390, 360 e 320 px sem rolagem para o
  lado e sem erros no console.
- Versão 3.6 (buscar e excluir): busca por número (exato primeiro), sem acento, por cidade, por
  parte da chave, lista de números com zeros à esquerda e "não encontradas", nota em rota sem
  seleção, selecionar todas, cancelar a confirmação, exclusão em lote, Desfazer com todos os
  dados, busca do topo, exclusão pelo pedido aberto com Desfazer, XML de cancelamento (pendente,
  em rota, fora do sistema), carta de correção recusada, pedido excluído durante a localização
  não volta, dados de exemplo sem gravar; celular 390/360/320 px com a barra "Excluir" presa
  embaixo.
- Versão 3.7 (entrada automática): cartão na página Pedidos, criar endereço de e-mail e
  chave da API, aviso de "guarde a chave", exemplo da API, botão Copiar, recebimentos,
  aviso quando o pedido entra sozinho com a tela aberta e conta de demonstração sem a
  função; em 1440, 390 e 320 px sem rolagem lateral e sem erros no console.
- Versão 3.7 (endereço pelo número e ponto lembrado): número achado (com "1.000" = mil) e com o
  nome oficial da rua e o estado por extenso, número fora do mapa ficando na rua, CEP só da
  cidade marcado como aproximado, pedido sem CEP achado pela rua, número longe da rua do CEP
  recusado, pino marcado à mão intocado, "R." e "Rua" + complemento como o mesmo endereço, uma
  consulta só para notas do mesmo endereço, chaves válidas no Firebase, cache antigo do CEP
  refeito sem dados de cliente, ponto marcado à mão guardado e aplicado aos outros pendentes do
  endereço, planilha com endereço/número/bairro/UF, nota nova já no ponto guardado sem consultar o
  mapa, "Buscar" no cadastro usando o ponto guardado; celular 390 e 320 px sem rolagem lateral.

Não testado daqui: o Firebase e o Railway de verdade (bloqueados neste ambiente), o motor
OR-Tools rodando (não instalado aqui) e o mapa com as ruas. O formato da resposta do Nominatim
(com o número achado e sem ele) foi conferido ao vivo em 02/11/2026.

## Histórico

- Versão 3.8 (04/11/2026): visual geral — ícones próprios em SVG no lugar dos emoji 3D e dos emoji
  de texto (sistema e página do motorista), silhuetas de veículo na mesma escala, cores de região
  harmonizadas com a marca, rótulos em frase e KPIs com um tratamento só.
- Versão 3.7 (03/11/2026): entrada automática de pedidos por e-mail (XML da NF-e numa
  caixa lida a cada minuto) e por API com chave por empresa, pedidos aparecendo na tela
  sem recarregar, e XML lido no encoding que ele declara (acentos de notas antigas).
- Versão 3.7 (02/11/2026): endereço procurado pelo número antes do CEP, ponto marcado à mão
  guardado por endereço e usado nas próximas notas (e nos outros pendentes do mesmo endereço),
  precisão do ponto em cada pedido (pedidos só com o bairro ou a cidade aparecem como
  aproximados), pedido sem CEP localizado pela rua e planilha com colunas de endereço.
- Versão 3.6 (01/11/2026): buscar notas na página Pedidos (texto, chave, CEP ou lista de
  números), excluir várias de uma vez com Desfazer, XML de cancelamento da NF-e tirando a nota dos
  pendentes, e a fila de localização deixou de recriar pedido excluído.
- Versão 3.5 (01/11/2026): pedido à mão (cadastrar, editar, excluir), local corrigido no mapa
  (busca pelo endereço ou pino arrastado), aviso de pedidos sem local exato, ajuste manual da rota
  antes de confirmar (ordem, tirar, adicionar, mover entre viagens, otimizar, desfazer) com nova
  medição pelo servidor (`POST /avaliar`), avisos de capacidade/horário/jornada e cabeçalho sem
  rolagem lateral em celulares de 320 px.
- Versão 3.4 (31/10/2026): separação por empresa (`empresas/<id>`, `membros/<uid>`), operação do
  administrador em `empresas/principal` com cópia automática da raiz, demonstração com as notas do
  cliente salvas na própria área e "Virar cliente", CD pelo CEP por empresa, servidor sem acesso
  direto ao banco para clientes.
- Versão 3.3 (24/10/2026): conta de demonstração (dados fictícios, nada gravado), página Acessos
  para o administrador, localização ao vivo pelo celular do motorista, motorista de demonstração
  (`#demo`), regras do banco com administrador, pedidos de acesso e posição.
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
- Versões anteriores: no histórico do Git.
