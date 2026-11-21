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
| `assets/veic/` | Desenho dos cinco veículos da frota (SVG próprio) | GitHub Pages |
| `backend/` | Servidor de rotas em Python (FastAPI + OR-Tools + IA) | Railway |
| `tests/` | Testes: `tests/tela` (Playwright) e `tests/notas` (notas de exemplo) | Só no computador |
| `firebase/database.rules.json` | Regras de acesso do banco (Realtime Database) | Console do Firebase |

Banco e login: Firebase, projeto `slog-pedidos` (Realtime Database + Authentication).

## Como o acesso funciona

1. A pessoa entra com **e-mail e senha** (Firebase Authentication).
2. O sistema confere se o usuário está **liberado** em `acesso/<código do usuário>` = `true`.
   Quem entra sem estar liberado vê a tela "Acesso aguardando liberação" com o código para
   mandar ao administrador.
3. As **regras do banco** (`firebase/database.rules.json`) só deixam ler e gravar quem está
   liberado. Ninguém consegue se liberar sozinho: `acesso/` só é alterado pelo console.
4. O **servidor** confere o mesmo login em toda chamada (menos `/status` e `/health`), perguntando ao
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
  - PDF do DANFE: lê nome, endereço, bairro, CEP, município, UF, volumes e peso pela posição na
    página (ver "O PDF da nota passou a ser lido de verdade"). É experimental e pede confirmação;
    nota sem CEP e sem município não entra.
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
  (`POST /avaliar`: km e chegada em cada parada, pelo OSRM, com 15 min por parada e
  espera pela janela). Mudanças seguidas geram uma medição só. Sem resposta do servidor, fica a
  estimativa em linha reta, com aviso.
- **Otimizar a ordem**: o motor reordena só as paradas que estão na rota (todas continuam nela).
  **Desfazer ajustes** volta todas as viagens ao que o sistema montou.
- Avisos na rota: passa da capacidade (carga máxima a bordo), mais paradas que o limite, parada
  que chega depois do horário marcado. Ao confirmar com algum aviso,
  o sistema pergunta antes.
- Ao confirmar, espera a medição terminar e confere se todos os pedidos ainda estão pendentes
  (excluídos ou despachados em outra aba bloqueiam). A rota vai para `rotas_confirmadas` na ordem
  ajustada, com `ajustada: true`, e o link do motorista sai nessa ordem.
- Rota já confirmada não é editada (as baixas do motorista são guardadas pela posição da parada).
  Para mudar, use **Devolver** na página Rotas e gere de novo.
- "Gerar outra rota" ou sair da página Roteirização descarta a rota que não foi confirmada.

## Km rodado, tempo real e pinos aprendidos (versão 3.12)

O sistema passou a comparar o planejado com o que aconteceu na rua. Tudo depende do link do
motorista; sem ele, a rota continua só com o planejado.

- **Km do painel — saiu da tela do motorista em 18/11/2026.** O link pedia o odômetro na saída
  e na chegada, com foto, e gravava em `entregador/<código>/hodometro/{ini,fim}` e
  `fotos_hod/{ini,fim}`. Esse cartão foi removido: o motorista não digita mais nada. O escritório
  continua **lendo** `hodometro` e copiando para `rotas_confirmadas/<id>/km_painel`, e as rotas
  antigas continuam mostrando o número e as fotos; para rota nova, a coluna "Km painel" fica
  vazia e o km rodado vem só do caminho pelo GPS, abaixo.
- **Caminho pelo GPS.** Com a localização ao vivo ligada, o celular grava um ponto a cada 20 s ou
  75 m, só com precisão de até 50 m, em `entregador/<código>/trilha` (só acrescenta: `lat`, `lng`,
  `t`, `acc`, `v`). Quando todas as paradas têm baixa, o escritório manda para `POST /km-rastro`
  os pontos do caminho **e a posição de cada baixa** (com a hora da baixa), e guarda a resposta em
  `rotas_confirmadas/<id>/km_gps`. O botão "calcular pelo GPS" faz o mesmo à mão.
- **Limite que não tem como contornar numa página web:** nenhum navegador manda a posição de
  página escondida (especificação W3C de Geolocalização). Com a tela apagada ou com o Waze/Maps na
  frente, o caminho para; por isso a resposta separa o medido do estimado. Para diminuir o buraco:
  com a localização ligada, a página pede para a tela ficar acesa (Screen Wake Lock; o navegador
  solta quando a página sai da frente) e, quando o motorista volta para ela, lê a posição na hora.
  Sem caminho nenhum, mas com a posição das baixas, o km sai **estimado entre as baixas** pelas ruas
  (`km_gps.so_baixas: true`; não entra no "Km GPS" do relatório). Caminho contínuo só com app
  instalado (Capacitor com plugin de localização em segundo plano, com declaração e vídeo na Play
  Store): não feito.
- **`POST /km-rastro`** (`backend/km_rastro.py`). Limpa o rastro (precisão pior que 50 m, salto
  acima de ~160 km/h, ponto a menos de 15 m do anterior, que é o veículo parado tremendo), divide
  onde o sinal sumiu (mais de 3 min ou 3 km entre dois pontos), casa cada trecho com as ruas pelo
  OSRM `/match` em blocos de 100 pontos (**km medido**) e liga as lacunas pelo `/route` (**km
  estimado**). O raio mandado ao `/match` é a precisão ÷ 2, entre 5 e 25 m: o navegador dá o raio
  de 95% e o OSRM quer o desvio padrão. Quando o `/match` devolve o trecho em pedaços (parada de
  entrega, ponto ruim), o espaço entre eles também entra: até 200 m como medido, acima disso como
  estimado (pelo `/route` se passar de 300 m). Pedaço casado mais longo que 1,5 × o caminho dos
  próprios pontos + 500 m é volta inventada pelo casamento e entra como estimado. Devolve
  `km_total`, `km_medido`, `km_estimado`, `cobertura` (medido ÷ total) e `casado` (`false` =
  servidor de rotas fora, km em linha reta entre os pontos). Até 6.000 pontos por pedido. Segue o
  limite de 1 consulta por segundo do servidor público.
- **Planejado × realizado.** Na página Rotas, cada rota com link mostra: km planejado, do painel
  (alerta "confira as fotos" quando foge mais de 50% do planejado) e pelo GPS (com o % medido);
  o tempo entre duas baixas seguidas dividido pelo previsto (tira os 15 min de atendimento dos
  dois lados; mediana dos trechos); e quantas paradas foram feitas fora da ordem planejada. Os
  Relatórios trazem o mesmo bloco para o período, quatro colunas novas na tabela de rotas e cinco
  na planilha (km painel, km GPS, % casado com as ruas, tempo real ÷ planejado, fora da ordem).
  A impressão do relatório sai em paisagem.
- **Ajuste de tempo por empresa (`config/fator_tempo`).** O OSRM calcula o tempo sem trânsito.
  O administrador define, em Acessos → "Tempo de viagem de cada empresa", um número de 0,5 a 3
  que multiplica os tempos do OSRM no motor (`fator_tempo` em `/solve` e `/avaliar`). A sugestão
  vem das baixas dos últimos 60 dias (tempo real ÷ planejado × ajuste usado na rota, mediana) e
  só aparece com 20 trechos em 3 rotas medidas pelas ruas. A rota confirmada guarda o
  `fator_tempo` usado. O cliente vê o ajuste na confirmação e não pode mudar; a mudança vale na
  hora, mesmo com a página dele aberta. Demonstrações ficam de fora.
- **Custo da rota (`CUSTO_METRO_S`).** O motor passou a escolher a ordem pelo tempo de viagem
  mais 0,02 s por metro (antes, só a distância). Isso evita trocar uma avenida rápida por um atalho
  lento só porque é mais curto. Muda na variável `CUSTO_METRO_S` (0 = só tempo).
- **Pino aprendido nas entregas.** A baixa grava a posição com a precisão em
  `entregador/<código>/gps/<n>`. Quando duas rotas diferentes dão baixa "feito" no mesmo endereço
  com GPS de até 30 m, a menos de 50 m uma da outra, a mediana vira o ponto do endereço
  (`config/locais/<chave>`, `p: "aprendido"`, com o ponto que estava antes em `antes`). Ponto
  marcado à mão manda; baixa a mais de 5 km do pino (30 km se o pedido só tinha bairro ou cidade)
  é ignorada. Os pendentes do mesmo endereço passam para o ponto aprendido e as próximas notas já
  entram nele. O aprendizado é de cada empresa: um cliente não vê o ponto aprendido de outro.
- **Sem o número.** Pedido que o mapa achou só na rua (sem o número) ganha a etiqueta "sem o
  número" em Pedidos e no resultado da rota, um aviso na lista e uma linha na confirmação.

**Privacidade (LGPD).** O caminho pelo GPS é dado de localização do motorista. Só é gravado com a
localização ligada por ele, enquanto a página está aberta, e fica no nó do link. A página do
motorista tem "O que esta página grava" (o quê, quem vê, para quê). Falta, e depende de decisão
da ROTAV3 com orientação jurídica: o contrato de tratamento de dados com cada transportadora (ela
é a controladora; a ROTAV3, a operadora), o aviso completo ao motorista e o prazo para apagar os
pontos do caminho (a pesquisa de 14/11 sugere 90 a 180 dias para os pontos e o prazo do cliente
para o resumo e as fotos).

**Regras do banco:** esta versão grava nós novos no link do motorista (`hodometro`, `fotos_hod`,
`trilha`, `gps`). Enquanto as regras novas não forem publicadas, essas gravações são recusadas e o
resto funciona como antes (o motorista vê "Não deu para salvar o km").

## O tempo saiu da tela (16/11/2026)

A tela mostrava quanto a rota ia demorar, e o número confundia: três entregas apareciam como
"8h" porque a **espera de um pedido com hora marcada** entra na conta (o veículo fica parado até
abrir a janela do cliente). O motor continua calculando tempo — precisa dele para respeitar o
horário marcado e a jornada de 8 h, e o servidor continua devolvendo `mins` —, mas a tela não
mostra mais:

- o tempo total da viagem (resultado da roteirização, montagem no mapa, página Rotas, relatório
  e o KPI do painel, que virou "Km das rotas");
- os avisos "a viagem passa de 8 horas" e "perto das 8 horas de jornada";
- a previsão de chegada em paradas **sem hora marcada**, no escritório e na página do motorista.

O que ficou: **km, peso e quantidade de paradas**; a previsão de chegada **só nas paradas com
hora marcada**, junto da janela do cliente; e o aviso de parada que chega depois do horário
marcado. No relatório, "Tempo real ÷ planejado" e "Tempo entre as paradas" continuam, porque
medem o que **aconteceu** na rua, não uma previsão — e alimentam o ajuste de tempo por empresa.

## Teste de N dias com o sistema inteiro (17/11/2026)

Até aqui havia dois estados: **demonstração** (dados fictícios, com prazo) e **acesso
completo** (tudo real, para sempre). Faltava o do meio, que é o que o cliente pede:
*"me dá o sistema de verdade por três dias"*.

Demonstração não serve para isso, e de propósito — na conta de demonstração o sistema
**não cria link real de motorista** (usa o de exemplo e simula o veículo andando no mapa),
**não calcula km por GPS** e **desliga a entrada automática por e-mail**. Um teste com
essas três coisas fora não é teste.

Agora o prazo em `demos/<uid>.expira` vale para os **dois** papéis. Com acesso completo e
prazo gravado, a pessoa usa o sistema inteiro e a conta fecha sozinha no dia marcado; sem
prazo gravado, não vence (cliente pagante). Nada mudou no nó nem nas regras do banco.

Na tela **Acessos**:

- "Liberar completo" agora pergunta a empresa **e por quantos dias** (0 = sem prazo);
- a lista "Acesso completo" mostra `teste até 20/11` ou `venceu em 20/11`, com botão
  **Pôr prazo / Mudar prazo** ao lado de "Trocar empresa" e "Tirar acesso";
- "Virar cliente" pergunta o prazo novo em vez de herdar o vencimento da demonstração —
  sem isso, promover alguém no último dia da demonstração trancaria a conta na hora;
- quem tem acesso completo sai da lista "Acessos de demonstração", para não aparecer duas
  vezes.

A tela de vencimento passou a dizer "Seu acesso de teste terminou", que serve para os dois.

Testes: `tests/tela/t_prazo.js`.

## O mapa presta contas do que não mostra (17/11/2026)

"Os pedidos de coleta não aparecem no mapa." Os dois mapas desenham coleta certo — azul-
marinho com borda dourada no mapa geral, `pino coleta` no mapa de montar rota; há teste
para os dois. O que acontecia é que o mapa **esconde duas coisas e não dizia**:

- pedido **sem endereço exato** não vira pino: entra na bolha cinza da cidade;
- pedido **agendado para outro dia** some do mapa até o dia chegar.

Quem tem poucas coletas, e todas em endereço industrial sem número na rua, vê um mapa só
com os pinos verdes das entregas e conclui que a coleta sumiu do sistema. O contador em
cima ainda dizia "Coletas 10", o que piorava: dez existem, nenhuma aparece.

Agora, embaixo do mapa, uma linha fecha a conta de todo pedido do filtro:

> 94 pedidos têm pino próprio no mapa. 116 pedidos estão sem endereço exato (106 entregas
> e 10 coletas) e aparecem na bolha da cidade, sem pino próprio — toque no pedido e use
> **corrigir** para marcar o ponto. 7 estão agendados para outros dias e só aparecem no dia.

A quebra por tipo só aparece com o filtro em "Todos" (com o filtro em Coletas seria
repetir o que já está escrito no filtro), e a linha some quando não há nada escondido.

Achado de brinde: `lista.filter(_agendadoFuturo)` passa o índice do array como segundo
argumento, que em `_agendadoFuturo(o, dia)` é o dia — a partir do segundo item a conta
dava errado. Vale para `_saiHoje` também. As duas são as únicas funções de dois
argumentos usadas assim no arquivo; as outras (`_aprox`, `_semNumero`, `_idDe`,
`_manNoMapa`) recebem um só e estão seguras.

Testes: `tests/tela/t_mapa_coletas.js`.

## Km rodado: sem caminho gravado não existe km rodado (16/11/2026)

Duas rotas iguais, dirigidas por caminhos diferentes — uma dando várias voltas —, davam
**o mesmo km**. A conta estava certa; o problema era de onde vinha o número.

O km pelo GPS tem dois caminhos no `/km-rastro`:

1. **com a trilha gravada** pelo celular: casa os pontos com as ruas no OSRM `/match` e soma.
   Testado em `backend/tests/test_km_rastro.py`: 40 pontos em linha reta dão 2,9 km; os mesmos
   extremos dando 3 voltas num quarteirão dão 5,0 km. Ou seja, **com a trilha o km enxerga as
   voltas**;
2. **sem trilha nenhuma**, sobram as posições das baixas. Elas ficam longe no tempo, viram
   trechos de um ponto só e o km vira a ligação entre elas pelo `/route` — **o menor caminho
   entre as paradas**. Esse número sai igual por qualquer trajeto: não mede nada.

O caso 2 aparecia na mesma linha dos outros km, como `entre as baixas 31,2 km`, com a ressalva
em letra pequena. Lido de relance, parecia km rodado.

**Na tela do motorista** (`motorista.html`) o estado do caminho agora fica à vista durante a
rota, embaixo de "Localização ao vivo", porque falhar calado era o pior dos mundos:

- `Caminho: N pontos gravados.` — está indo;
- `⚠️ … este link não tem permissão para gravar` — o banco recusou. Acontece quando as regras
  do `firebase/database.rules.json` (nó `trilha`, versão 3.12) **não foram publicadas**: a
  localização ao vivo e as baixas continuam funcionando, só o caminho é recusado. Antes, três
  recusas e a página desistia sem avisar ninguém;
- `⚠️ O GPS está impreciso demais (±N m)` — nenhum ponto passa do limite de 50 m;
- `⚠️ O caminho parou de ser gravado (sem internet?)` — continua tentando e volta sozinho.

**No escritório**, a estimativa entre as baixas saiu da linha de km e virou aviso: "Sem km pelo
GPS nesta rota … esse número sai igual por qualquer trajeto — não mede o que foi rodado". O km
pelo GPS de verdade passa a mostrar também **quantos pontos** sustentam a medida. Uma rota cujo
km_gps ficou marcado `so_baixas` é recalculada uma vez por sessão, caso a trilha tenha chegado
depois. O relatório já ignorava o `so_baixas` e continua ignorando.

Testes: `tests/tela/t_trilha.js` e `TesteCaminhoImporta` em `backend/tests/test_km_rastro.py`.
O `push` do Firebase simulado passou a recusar caminho sem permissão, como o SDK de verdade.

## Faixa de demonstração retirada com os dados de exemplo (19/11/2026)

A pedido do Henrique (atrapalhava a apresentação), a faixa do topo "Conta de demonstração: dados
fictícios… Falar com a ROTAV3 · Saída das rotas…" **não aparece mais** enquanto a demonstração
mostra os pedidos de exemplo. Ela só aparece quando a pessoa importa as próprias notas, porque aí
diz onde elas ficam salvas e tem o botão "Voltar aos dados de exemplo". Os nomes do exemplo
continuam fictícios (e os motoristas "(exemplo)"); **na apresentação, dizer que os pedidos são de
demonstração**. Testes: `t_demo` (sem faixa no exemplo; com as notas, a faixa volta) e `t_prazo`.

## Sem a palavra "demonstração" na conta de demonstração; prazo conferido com a aba aberta (19/11/2026)

- A pedido do Henrique, para a apresentação: a conta de demonstração não mostra mais "demonstração"
  em lugar nenhum (tela, celular, link do motorista de exemplo). Onde é preciso deixar claro que os
  dados não são reais, ficou **"exemplo"**: "pedidos de exemplo" no card de pedidos, aviso nos
  Relatórios e na planilha, "Exemplo: o link abre a tela do motorista…" na página Rotas, posição
  "(simulada)" e "Rota de exemplo" na tela do motorista. O selo do topo "Pedidos de exemplo"
  continua só para conta de verdade com o banco vazio (cliente novo vendo o exemplo). O alerta
  "Modo demonstração ativo" do painel saiu. Página Acessos (só o administrador) não mudou.
- **Revisão dos acessos:**
  - O prazo (demonstração e acesso completo com prazo, como o teste de 3 dias) era conferido só ao
    entrar. Com a aba aberta, o cliente seguia usando depois de vencer. Agora a tela confere de novo
    a cada 5 minutos e quando a aba volta para a frente, e mostra "Seu acesso de teste terminou"
    (`_vigiarPrazo`). As regras do banco continuam barrando a gravação só da **demonstração** vencida;
    o acesso completo vencido é barrado pela tela (para barrar no banco também, as regras teriam de
    olhar o prazo em `demos/` — fica para quando houver mais clientes em teste).
  - A mensagem pronta do acesso de demonstração pedia ao cliente para "informar o CEP do centro de
    distribuição em Roteirização", o que não existe desde a 3.11 (só o administrador define o CD).
    Agora pede o endereço para o Henrique configurar.
- Teste: `t_prazo` (prazo vencendo com a aba aberta), `t_login` (selo "Pedidos de exemplo").

## Ponto no mapa conferido: mesma cidade e mesma rua (19/11/2026)

Henrique viu, nas rotas de teste, pedido "de Guarulhos" com o ponto em outro lugar. A leitura das
notas estava certa (o XML é lido campo a campo); o erro vinha de **transformar o endereço em ponto**.
O Nominatim (OpenStreetMap) devolve o resultado **mais parecido**, não o certo, e o sistema aceitava
qualquer resposta. Conferido ao vivo: o CEP 07224-010 (Rua Umbuzeiro, Cidade Industrial Satélite)
voltava como "Rua São Sebastião do Umbuzeiro", em Vila Rio, a ~5 km, marcado como "rua" (exato).

Agora toda resposta do Nominatim é conferida (`_mesmaCidade`, `_mesmaRua`):

- **Mesma cidade** (e mesmo estado) que o CEP ou a nota dizem, pelos campos `city`/`town`/
  `municipality` do endereço que ele devolve.
- **Mesma rua**, quando se procurou uma rua (nome comparado sem acento, sem "Rua/Av." e com as
  abreviações por extenso). "São Sebastião do Umbuzeiro" ≠ "Umbuzeiro".
- A rua do CEP passou a ser procurada pela busca estruturada (rua + cidade + estado), como o número.
- O que não passa cai para o passo seguinte (bairro, depois cidade) e aparece como **"local
  aproximado · corrigir"**. Aproximado e dito é melhor do que errado com cara de certo; o ponto
  marcado à mão uma vez fica guardado para as próximas notas do endereço.
- **O que já estava gravado** (`GEO_VERSAO = 2`): CEPs do cache geral, pontos automáticos guardados
  por endereço e pedidos **pendentes** localizados antes disso são procurados de novo, uma vez. Se a
  busca conferida acha o número, vale o novo. Se só acha o bairro ou a cidade, o ponto antigo fica
  quando está na mesma região (até 4 km do bairro, 15 km da cidade), mas passa a aparecer como
  aproximado; longe disso, troca. Ponto marcado à mão, lembrado, aprendido nas baixas, pedido em
  rota e a conta de demonstração com dados de exemplo não são mexidos. O pedido conferido grava
  `geoV: 2`.
- Na primeira vez que uma conta com pedidos pendentes abrir depois disso, a barra "Localizando
  pedidos no mapa" aparece por alguns minutos (1 consulta por segundo ao Nominatim).
- **Serviço de endereços fora do ar** (ViaCEP ou Nominatim sem resposta; erro marcado com `rede`):
  o ponto antigo fica como estava e não é marcado como conferido; a conferência para até a tela
  abrir de novo (não repete consulta a cada mudança nos pedidos); o aviso diz "fica para depois", e
  não "sem localização". Pedido novo usa o CEP guardado no cache para não ficar sem ponto, marcado
  como não conferido (`nv`), sem gravar `geoV` nem guardar o ponto por endereço. Quando a busca
  responde mas não acha nada na cidade, o cache antigo do CEP **não** é usado (pode ser o errado).
- **Limite que continua:** o OpenStreetMap não tem o número nem o nome de muitas ruas de Guarulhos.
  Esses pedidos ficam aproximados até alguém marcar o pino uma vez. O servidor de rotas próprio
  (OSRM) **não** resolve isso: ele mede o caminho entre os pontos, não acha os pontos.
- Teste: `t_geo` (rua de outro nome recusada, rua de outra cidade recusada, ponto antigo em outra
  cidade refeito, ponto antigo da região mantido como aproximado, lembrado e em rota intactos,
  versão gravada no cache e no pedido). Os simuladores do Nominatim em `t_geo`, `t_ajuste` e
  `t_notas_teste` passaram a devolver a cidade e o estado, como o de verdade.

## Km pelas ruas já na montagem (18/11/2026)

Na montagem no mapa, o km era a soma em **linha reta** entre as paradas, e o km pelas ruas só
aparecia depois de "Usar esta rota". Em Guarulhos a diferença passa do dobro (10 km na montagem
viravam 25 km). Agora:

- Quando a pessoa para de tocar por 1,2 s, a tela chama o **`POST /avaliar`** com as paradas na
  ordem dos toques — a **mesma conta** que mede a rota depois de "Usar esta rota". Volta o km pelas
  ruas e o traçado de uma vez. A tela mostra "**24,8 km** pelas ruas, na ordem escolhida".
- **Enquanto mede**, mostra "Medindo o km pelas ruas…" e **nenhum número**: o de linha reta
  enganava justamente nesse momento.
- **Sem resposta do servidor de rotas** (fora do ar, sem login, mais de 100 paradas, OSRM só em
  linha reta), volta a "≈ X km em linha reta", com o motivo ao lado. Nunca apresenta linha reta
  como km de estrada.
- Sequência já medida (desfazer e refazer) volta da memória da tela, sem nova consulta. Ao usar
  a rota, o km medido entra direto no resultado (não pisca o de linha reta) e o `/avaliar` de
  sempre confirma o km e calcula os horários com as janelas.
- A medição da montagem manda as janelas como `null`: janela muda horário, não km.
- Custo: cada pausa vira uma tabela e uma rota no OSRM (antes, só a rota). Com o servidor público
  (1 consulta por segundo), a resposta leva uns 2 s. Mais um motivo para o OSRM próprio.
- Testes: `t_manual` (medindo sem número, km medido igual ao de usar a rota, ordem dos toques,
  volta à linha reta sem servidor) e `t_tracado` (uma medição por pausa, sem volta, traçado e km
  da tela, sequência guardada).

## Ver o pedido inteiro pelo pino (18/11/2026)

Na montagem da rota no mapa, o toque simples continua colocando e tirando o ponto da rota. Para
**ver o pedido inteiro** sem mexer na rota:

- **celular:** segurar o dedo no ponto (~0,5 s; um tremido de mais de 10 px cancela);
- **computador:** botão direito no ponto;
- **teclado:** Tab até o ponto e tecla **V**.

Abre uma janela só de leitura (`#modal-ver`, `verPedidoGrupo`) com: peso bruto e líquido,
volumes com a espécie (caixa, palete…), **quanto da capacidade do veículo escolhido o pedido
ocupa** (barra verde, âmbar a partir de 90 %, vermelha acima de 100 %), cliente, remetente (ou
onde coletar e o destinatário, na coleta), endereço, como o ponto foi achado, telefone (link de
ligar), agendamento e horário, emissão, valor da nota, **lista de produtos** e a observação da
nota. Pino com várias notas no mesmo endereço mostra todas e a soma. Um botão coloca ou tira da
rota; Esc, ✕, "Fechar" ou tocar fora fecham e o foco volta ao pino. O CD não abre nada.

- **De onde vêm os produtos:** do XML da NF-e (`det/prod`: `xProd`, `qCom`, `uCom`). A importação
  pela tela (`_detalhesNota` no `index.html`) e a entrada automática (`_detalhes_nota` no
  `backend/entrada.py`) gravam os mesmos campos no pedido: `produtos` (até 30, `{d, q, u}`),
  `produtosTotal` (só quando a nota tem mais de 30), `volumes` (só os que têm espécie,
  `{q, esp}`), `pesoLiq`, `valor` (`total/ICMSTot/vNF`), `obsNota` (`infAdic/infCpl`, até 500
  letras) e `emissao` (AAAA-MM-DD). Campo sem valor não é gravado. O mesmo arquivo
  (`backend/tests/nfe_produtos.xml`) é lido nos dois testes para os dois lados darem igual.
- **Não tem produtos:** pedido de planilha, de PDF, digitado à mão, da conta de demonstração ou de
  XML importado antes desta versão. A janela diz isso. **Não reimporte** para ganhar a lista: a
  reimportação substitui o pedido pendente e perde o ponto e o agendamento já acertados.
- **"Se é muito grande":** a NF-e não tem campo de medida (altura, largura, cubagem). O tamanho
  aparece pelo peso, pelos volumes, pela espécie e pela parte do veículo; a janela avisa isso.
- O que a janela lê além do que a tela carrega (telefone, produtos…) vem de `pedidosCrus`, o
  pedido como está no banco. A rota confirmada e o link do motorista **não** levam os produtos
  (as paradas continuam gravadas só com os campos de sempre).
- Teste: `tests/tela/t_ver_pedido.js` (botão direito, tecla V, dedo segurado com e sem o menu
  de contexto do Android, toque curto, notas juntas, pedido maior que o veículo, texto da nota
  que tenta virar HTML, e a importação do XML gravando igual ao backend).

## Km pelas ruas acima de 100 pedidos (18/11/2026)

O servidor público do OSRM recusa matriz com mais de 100 × 100 = **10.000 células**. O motor
desistia cedo: passou de 100 pontos, media **tudo em linha reta a 40 km/h** — não só o km da
rota, mas a escolha de quais pedidos entram e em que ordem. Com 200 notas pendentes, *toda*
rota saía assim, e o relatório marcava "linha reta (mais de 100 paradas)" em vermelho.

Duas mudanças, uma no motor e uma na tela.

**1. Matriz em blocos (`vrp_solver.py`).** Acima de `OSRM_LIMIT` pontos, a matriz passa a ser
pedida em pedaços com os parâmetros `sources`/`destinations` do `/table`: cada consulta leva
algumas linhas contra todos os destinos, respeitando o teto de células, e as respostas são
emendadas aqui. Para 200 pontos são 4 consultas de 50 × 200; para 400, 16. O teto é
`OSRM_MAX_BLOCOS` (padrão 20, ou seja ~450 pedidos): acima dele a rota demoraria demais e o km
volta a sair em linha reta, avisado como antes. Qualquer falha no meio — servidor fora,
resposta de tamanho inesperado — cai para a linha reta sem quebrar a rota. Num OSRM próprio não
há espera de 1 s entre consultas, então os blocos saem quase de imediato.

**2. Roteirizar por cidade (`index.html`).** Na tela de roteirização, abaixo de "O que entra
nesta viagem", um campo **"De qual cidade"** lista as cidades com pedido pendente do tipo e do
dia escolhidos, da que tem mais para a que tem menos, com a contagem. Escolhendo uma, só os
pedidos dela entram no cálculo — que é como a operação planeja de verdade, e deixa a viagem
bem abaixo do limite. A nota embaixo do campo diz quantos pedidos entram e, acima de 450,
avisa que o km vai sair em linha reta. A cidade escolhida some da lista quando muda o tipo ou
o dia: nesse caso a escolha volta para "todas" em vez de deixar a viagem vazia.

Testes: `TesteMatrizEmBlocos` em `backend/tests/test_vrp_coletas.py` (confere o número de
consultas, o tamanho de cada bloco, a emenda posição a posição e os três caminhos de falha) e
`tests/tela/t_cidade_rota.js`.

## O agendado voltava verde ao sair da rota (18/11/2026)

Na montagem manual, o pedido agendado para o dia da viagem é vermelho. Tocando nele ele entra
na rota; tocando de novo ele sai — e voltava **verde**, como se fosse um pedido comum. Quem
estava montando a rota perdia de vista o que tem hora marcada.

`_manIcone` desenha o pino com as classes `pino coleta hoje sel`. Mas `_manPintar`, que repinta
**só o pino tocado** sem redesenhar o mapa inteiro, remontava a classe sem o `hoje`. O primeiro
toque não mostrava o erro (o vermelho sai de baixo do `sel` mesmo), e o segundo deixava o
pino verde. As duas funções agora montam a classe igual.

Teste: `tests/tela/t_agendado.js` — toca, confere `sel` e `hoje` juntos, toca de novo e confere
que o `hoje` continua lá.

## O PDF da nota passou a ser lido de verdade (18/11/2026)

A leitura de PDF criava **um pedido para cada número de 5 a 9 dígitos** que achasse no texto
(valor, CNPJ, código de produto — qualquer um), sem endereço nenhum, com "Sem cidade" e um
ponto **sorteado a até 1 km do CD**. No mapa o pedido caía na bolha da cidade, mas na rota
aquele ponto inventado entrava como se fosse o endereço do cliente.

Agora o DANFE é lido **pela posição na página**, não pela ordem do texto. O DANFE é desenhado
em caixas: o rótulo em letra miúda em cima, o valor em letra maior embaixo. Cada emissor
escreve o texto do PDF numa ordem diferente, então o leitor agrupa os pedaços em linhas pelo Y,
acha o rótulo e pega o que está logo abaixo dele, na mesma coluna — o próximo texto miúdo da
mesma linha fecha a coluna à direita. Sai disso:

| Campo | De onde vem |
|---|---|
| Nome do cliente | `NOME/RAZÃO SOCIAL` da seção **DESTINATÁRIO/REMETENTE** |
| Endereço e bairro | `ENDEREÇO` e `BAIRRO/DISTRITO` da mesma seção |
| CEP, município, UF | `CEP`, `MUNICÍPIO`, `UF` (também separa "SÃO PAULO - SP" numa só caixa) |
| Volumes e peso | `QUANTIDADE` e `PESO BRUTO` (ou líquido) da seção **TRANSPORTADOR / VOLUMES** |
| Número da nota | das posições 26 a 34 da **chave de acesso**, ou do rótulo `Nº` |

A seção importa: o DANFE repete `NOME`, `ENDEREÇO`, `MUNICÍPIO` e `UF` na parte do
transportador, e sem limitar a faixa de Y o endereço da transportadora entrava no lugar do
endereço do cliente. Na **coleta** o ponto é o do emitente, que no DANFE é um bloco de texto
solto ao lado do título "DANFE" — daí a coluna ser cortada pelo X.

O que mudou no resultado:

- **ponto inventado, nunca mais.** O pedido entra como o do XML: `geoStatus: pendente` com CEP,
  `sem_cep` sem ele, e é o geocodificador que acha o ponto. Sem pino exato até achar;
- **nota sem CEP e sem município não é importada.** Aparece na mensagem: "1 nota do PDF ficou
  de fora: sem CEP e sem município legíveis — use o XML dela";
- **2ª via e 2ª folha da mesma nota** caem no mesmo pedido (a chave de acesso é o id);
- a folha sem número e sem chave (continuação) é ignorada em vez de virar pedido;
- o arquivo sem nenhuma nota legível é recusado com o motivo, em vez de importar lixo.

O aviso de "leitura experimental" continua, porque continua sendo: cada emissor desenha o DANFE
de um jeito. **XML segue sendo o caminho certo** — de lá sai tudo isso sem adivinhação.

Testes: `tests/tela/t_pdf.js`, com DANFEs gerados por `tests/tela/pdf/gerar_danfe.py` (layout da
SEFAZ, dados fictícios). O `pdf.js` vem de CDN e a bateria roda sem internet, então o teste usa
o texto **com a posição de cada pedaço** (`tests/tela/pdf/*.json`, extraído dos PDFs gerados) —
é o mesmo formato que o `pdf.js` entrega ao navegador. Para conferir a ponta a ponta, importe
`tests/tela/pdf/danfe-exemplo.pdf` no sistema aberto no navegador.

## O motorista não digita mais o km do painel (18/11/2026)

O cartão **"Km do painel"** saiu da página do motorista. Era a primeira coisa que ele via no link
e pedia duas digitações por rota (odômetro na saída e na chegada) mais duas fotos. Em rota com
dez entregas isso é trabalho que ninguém faz direito, e o número só servia para conferir o que o
GPS já mede sozinho.

O que saiu: o cartão, as duas validações (chegada menor que a saída, mais de 2.000 km), a foto do
painel e o `salvarHod`. O motorista agora abre o link e vê direto as paradas.

O que ficou: o escritório continua **lendo** `entregador/<código>/hodometro` e `fotos_hod` e
copiando para `rotas_confirmadas/<id>/km_painel`, então toda rota que já tem esse dado gravado
continua mostrando o km e as fotos na página Rotas, nos Relatórios e na planilha. Para rota nova
esses campos ficam vazios: o km rodado passa a vir só do **caminho pelo GPS**, que não depende de
ninguém digitar nada.

Testes: `tests/tela/t_km_realizado.js` (confere que o cartão sumiu da tela do motorista e que o
escritório continua lendo o dado das rotas antigas) e `tests/tela/t_motorista.js`.

## O painel só conta rota confirmada (16/11/2026)

Os cartões **ROTAS** e **KM DAS ROTAS** do painel mostravam a última roteirização *aberta na
tela*, confirmada ou não — e não saíam mais de lá. Quem só experimentou a roteirização via
"1 rota · 31,2 km" no painel sem ter mandado veículo nenhum para a rua. Pior: cada clique em
"Gerar Rota Agora" gravava essa prévia em `empresas/<eid>/rotas`, um nó que existia só para
alimentar esse cartão.

Agora:

- a prévia **não é gravada**. A rota montada fica só na tela até "Confirmar saída do veículo";
- os dois cartões contam as **rotas confirmadas que estão valendo** — exatamente a lista que a
  página Rotas mostra (`rotas_confirmadas` sem as devolvidas e as apagadas), pela função
  `_rotasAtivas()`;
- sem rota confirmada: **0** e **0 km**, com "nenhuma rota confirmada" / "confirme uma rota
  para ver". Não existe mais a estimativa "~N rotas" a partir dos pendentes, que era um chute;
- devolver ou apagar a rota devolve o painel a zero na hora.

O nó `rotas` continua sendo copiado na troca de empresa e limpo no "apagar tudo", para não
deixar lixo nas contas antigas. Testes: `tests/tela/t_painel_rotas.js`.

## Fim da rota: na última parada (versão 3.11)

A rota **não volta ao CD** por padrão: o motor escolhe a ordem sem contar a volta, e km, tempo,
jornada e desenho param na última parada. Em Roteirização, **"Voltar ao CD no fim da rota"** inclui
a volta (fica lembrado no aparelho). O servidor recebe `volta` em `/solve` e `/avaliar` e devolve
`volta` em cada rota; a rota confirmada guarda `volta`. Rota confirmada antes da 3.11 não tem o campo
e é desenhada com a volta, como foi calculada.

## Traçado pelas ruas (versão 3.10)

O km e o tempo sempre foram medidos pelas ruas (OSRM `/table`), mas o desenho da rota no mapa
ligava as paradas em linha reta. Agora o servidor pede ao OSRM o serviço `/route`, com as paradas
**na ordem da rota** (do CD ao CD), e devolve a linha pelas ruas em `tracado` (polyline6, a mesma
codificação do Google com 6 casas decimais). A tela desenha essa linha.

- **Onde aparece:** resultado da roteirização (`/solve` devolve um `tracado` por rota), rota
  ajustada ou otimizada (`/avaliar` devolve o da ordem nova), página Rotas e montagem no mapa.
- **Montagem no mapa:** enquanto a pessoa toca nos pontos, a linha é um rascunho reto e tracejado.
  Quando ela para por pouco mais de 1 segundo, a tela pede o caminho e a linha vira o trajeto.
  Sequência já pedida volta da memória, sem nova consulta. Desde 18/11/2026 o pedido é o
  `POST /avaliar` (km pelas ruas + traçado), não mais o `/tracado` (ver "Km pelas ruas já na
  montagem").
- **Guardado na rota confirmada** (`rotas_confirmadas/<id>/tracado`): a página Rotas desenha sem
  perguntar ao servidor. Rota confirmada antes desta versão pede o traçado uma vez, uma rota por
  vez, e guarda.
- **Sem traçado** (servidor de rotas fora, ou mais de 100 pontos no `/table`): linha reta
  **tracejada**, com o aviso "Linha reta entre as paradas" no canto do mapa. Enquanto mede uma
  ordem nova: "Buscando o caminho pelas ruas…".
- Rota com mais de `OSRM_ROUTE_MAX` pontos (padrão 50) é pedida em partes, emendadas no servidor.
- O servidor guarda na memória os últimos 500 traçados (mesma sequência não consulta de novo).
- No servidor público do OSRM: no máximo 1 consulta por segundo somando todos os usuários
  (`OSRM_INTERVALO`) e um User-Agent com o nome e o site da ROTAV3, como a política dele pede.
  Crédito "Rotas: OSRM" no canto do mapa.
- **Limite de uso:** o servidor público é para uso **não comercial**. Serve para desenvolvimento
  e demonstração. No primeiro cliente pagante, subir um OSRM próprio (recorte Sudeste ou SP da
  Geofabrik) e apontar `OSRM_URL` para ele: `/table` e `/route` saem do mesmo servidor.
- O traçado não sabe de ZMRC, rodízio nem restrição para caminhão (o perfil é de carro). Para
  navegar, o motorista continua usando Google Maps ou Waze pelos botões.

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
- **Centro de distribuição** (versão 3.11): definido **só pelo administrador**, na página Acessos,
  card "Centro de distribuição de cada empresa", pelo CEP (ponto na rua) ou colando as coordenadas
  do Google Maps (ponto exato). Fica em `empresas/<id>/config/deposito`. O cliente vê "Saída das
  rotas: …" e não troca. Nas regras do banco, `config/locais` continua da empresa e
  `config/deposito` só o administrador grava (precisa publicar as regras de novo no console).
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
- O cartão "Sua frota ainda não tem rastreador?" da página Mapa foi **retirado em 19/11/2026**: a
  primeira transportadora da apresentação já tem rastreamento na frota, e a oferta de um rastreador
  "em implantação" ficava estranha. Só volta quando a integração com rastreador existir.

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
`expira`, `baixas/<n>` e `fotos/<n>`; desde a 3.12, também `trilha` e
`gps/<n>` (ver "Km rodado, tempo real e pinos aprendidos"). `hodometro` e `fotos_hod` continuam
sendo lidos nas rotas antigas, mas desde 18/11/2026 nada na tela do motorista escreve neles. As regras deixam ler esse nó só com o código e só até
`expira`; o motorista só grava baixa (campos validados) e foto (JPEG até ~280 KB) enquanto o link
vale. A foto fica no próprio banco (não precisa de plano pago); o plano gratuito do Firebase
guarda 1 GB, o que dá alguns milhares de fotos.

## Mapa e endereços do Google (21/11/2026)

**Fundo dos mapas.** Todos os mapas do sistema usam o mapa do Google (Map Tiles API, blocos 2D
"roadmap", em português), desenhado pelo Leaflet. A chave do mapa (`GOOGLE_MAPS_KEY`, no
`index.html`) é de navegador: fica no código de propósito e só funciona nos endereços liberados no
Google Cloud (`rotav3.com.br/*`, `*.rotav3.com.br/*`, `hesantss-pixel.github.io/*`) e só para a
Map Tiles API. O sistema cria uma sessão (`createSession`, vale cerca de 2 semanas, guardada no
navegador em `rv3_gtiles`), mostra o **logo do Google** no canto de baixo à esquerda e o texto de
direitos que o Google devolve para a área visível (`/tile/v1/viewport`), como as regras dele pedem.
Se o Google recusar a sessão (chave errada, site não liberado, sem internet), o mapa volta sozinho
ao **OpenStreetMap** e tenta o Google de novo depois de 2 minutos.

**Endereço no número.** A geocodificação do Google passa pelo servidor (`POST /geocode`, com
login): a chave fica só no Railway (`GOOGLE_GEOCODING_KEY`) e nunca vai para a tela. O servidor
(`backend/geocode_google.py`) só devolve o ponto quando é da **mesma cidade e UF** e, para
"número", do **mesmo número** (ROOFTOP ou interpolado); só a rua conta como "rua"; resposta de
bairro ou cidade é descartada. Guarda as respostas por 24 h na memória e tem limite diário
(`GOOGLE_GEOCODING_LIMITE_DIA`, padrão 1000) para a conta não disparar.

Ordem na tela (`_localizarPedido`): ponto marcado à mão → ponto aprendido nas entregas → ponto
guardado do endereço → **Google** → número no OpenStreetMap → rua do Google → o que o CEP deu.

Regras do Google que o sistema segue:
- O ponto do Google só é usado quando o mapa do Google abriu (o resultado tem de aparecer num mapa
  do Google). Sem o mapa do Google, o sistema nem consulta o servidor.
- A coordenada do Google fica guardada no máximo **30 dias**. O pedido guarda `geoFonte: "google"`
  e `geoEm` (quando foi achado); o endereço guardado em `config/locais` leva `f: "g"`. Pedido
  pendente com ponto do Google mais velho que 30 dias é procurado de novo; se não der para
  renovar, o ponto sai e o pedido aparece como "sem localização".
- **Limite:** as rotas que já saíram guardam as coordenadas das paradas para o histórico; essas
  não são apagadas aos 30 dias.
- O Google pede que o site tenha **Termos de Uso** e **Política de Privacidade** públicos.

Vale também para as **contas de demonstração** (21/11/2026), sem limite por conta: a empresa que
testa vê o pino no número. Os pedidos fictícios da demonstração não consultam o Google. O único
teto é o diário do servidor inteiro (`GOOGLE_GEOCODING_LIMITE_DIA`).

Pedidos pendentes que estavam aproximados (rua, bairro ou cidade) passam **uma vez** pelo Google
(`geoG: 1` marca que já passaram). Se o Google achar o número, o ponto troca; se não, fica como
estava. Sem a chave no servidor (`/status` mostra `"geocodificacao_google": "sem chave"`), o
sistema pergunta uma vez por sessão e segue com ViaCEP + OpenStreetMap, sem refazer nada.

Custo (tabela do Google conferida em 21/11/2026): 10 mil geocodificações grátis por mês e
depois US$ 5 por mil; 100 mil blocos de mapa 2D grátis por mês e depois US$ 0,60 por mil. Cada
bloco é um quadrado de 256 px: abrir um mapa na tela cheia carrega uns 20 a 30, e arrastar ou
aproximar carrega mais. Vale pôr um **limite de cota diária** e um **alerta de orçamento** no
Google Cloud.

Paradas no mesmo ponto (até 30 m) aparecem num marcador só ("1–6"), e paradas sem endereço exato
são avisadas.

## Janela de horário (agendados)

- **No mapa** (versão 3.11): agendado para outro dia não aparece (nem no mapa do Dashboard, nem na
  página Mapa, nem na montagem da rota). No dia marcado, ou se já passou, aparece **em vermelho**,
  com "Agendado: sai hoje · chegar entre …" no ponto. A legenda conta os de hoje e os que ficaram
  de fora.
- **Nas listas** (16/11/2026): cada pedido agendado leva a marca 📅 — vermelha quando sai no dia
  ou está atrasado, cinza com a data quando está guardado para outro dia (`_chipAgenda`). Aparece
  na página Pedidos, na busca de notas e na busca do modal de agendar; o cartão da região conta
  "N saem hoje", e no painel "Precisa sair hoje" e "Atrasado" saem em vermelho. Sem isso, quem
  agendava pela tela não via marca nenhuma e parecia que o agendamento não tinha pegado.
- **Telas que se atualizam na hora** (`_atualizarTelasPedidos`): agendar, tirar o agendamento,
  terminar a fila de localização de endereços, desfazer uma exclusão e devolver rota na
  demonstração redesenham o painel, a lista e o mapa grande. Antes era preciso sair da página e
  voltar — e durante uma importação os pinos ficavam no centro da cidade mesmo depois de o
  endereço ter sido achado.
- **Tirar o agendamento**: reabrir um pedido agendado traz a data e a hora salvas e o botão
  "Tirar o agendamento". Antes não havia como desfazer, e o pedido ficava fora do mapa.

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
`empresas/principal`. O centro de distribuição e o ajuste de tempo de cada empresa são definidos
pelo administrador em Acessos. **Sempre que este arquivo mudar, publique de novo** (a 3.11 tirou
do cliente a troca do CD; a 3.12 abriu os nós novos do link do motorista).
Os testes `tests/tela/t_regras.js` conferem a lógica das regras com um avaliador simplificado
(`tests/tela/regras.js`); não substituem publicar e testar no Firebase de verdade.

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
| `GROQ_MODEL` | Modelo do assistente (padrão `openai/gpt-oss-120b`). Quando a Groq desligar um modelo, troca-se aqui | Não |
| `GROQ_HISTORICO` | Quantas mensagens anteriores vão em cada pergunta (padrão 6). Mais = mais tokens por pergunta | Não |
| `OSRM_URL` / `OSRM_LIMIT` / `OSRM_TIMEOUT` | Servidor de distâncias pelas ruas (endereço completo do serviço `/table`), máximo de pontos por consulta (padrão 100) e segundos de espera (padrão 10). O padrão é o servidor público de demonstração do OSRM, que não é para uso comercial | Não, até ter servidor próprio |
| `CUSTO_METRO_S` | Quanto cada metro pesa na escolha da ordem, em segundos (padrão 0,02). 0 = o motor escolhe só pelo tempo | Não |
| `GOOGLE_GEOCODING_KEY` | Chave do Google só com a Geocoding API, para achar o número da casa. **Nunca** vai para a tela, o código ou um commit | Não (sem ela, o endereço vem do OpenStreetMap) |
| `GOOGLE_GEOCODING_LIMITE_DIA` | Máximo de consultas ao Google por dia (padrão 1000) | Não |
| `OSRM_ROUTE_URL` / `OSRM_ROUTE_MAX` / `OSRM_INTERVALO` | Serviço `/route` do traçado (padrão: o mesmo servidor do `OSRM_URL`, trocando `/table/` por `/route/`), pontos por consulta antes de dividir em partes (padrão 50) e segundos entre consultas ao servidor público (padrão 1) | Não |

Python fixado em `backend/.python-version` (3.12) e bibliotecas com versão exata em
`backend/requirements.txt`. O `backend/railway.toml` manda o Railway publicar só quando algo em
`backend/` muda e chamar `/health` antes de trocar de versão: o `/health` confere se o motor de
rotas (OR-Tools resolvendo 3 pontos, sem internet), o SDK do assistente e a leitura de NF carregam.
Se uma atualização de biblioteca quebrar algum deles, responde 503 e o Railway **mantém a versão
anterior no ar**.

Verificação: `https://rotainteligente2sl-production.up.railway.app/status` deve responder
`"login": "obrigatório"`, `entrada_automatica` dizendo o que está ligado (`api` e `email`),
a `"versao"` do servidor e, em `"codigo"`, os 7 primeiros caracteres do commit que o Railway
publicou. **É assim que se confere se uma mudança no servidor foi mesmo para o ar**: o
`codigo` tem de bater com o último commit do ramo `main` que mexeu em `backend/`. Em
`"componentes"`, `motor_de_rotas`, `assistente` e `leitura_de_nf` devem dizer `"ok"`
(`assistente: "sem chave"` = falta `GROQ_API_KEY`). Enquanto o Railway não publicar a versão nova, a tela continua
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
    sem liberação, liberado com cache, Firebase fora do ar; toda rota, menos `/status` e
    `/health`, exige login. A chave do banco (que vai na URL) não aparece em resposta de erro
    nem no log, nem no traceback.
  - Assistente (`tests/test_groq_agent.py`): os dados do dia vão só na pergunta atual, o histórico
    não cresce, e cada erro da Groq (limite por minuto, pergunta grande demais, chave, fora do ar)
    vira uma frase que diz o que fazer, sem o texto cru da API.
  - Leitura de NF (`tests/test_nf_parser.py`): planilha e PDF de verdade (openpyxl, pdfplumber).
    No PDF, o número sai da chave de acesso ou do "Nº 000.004.521" do DANFE.
  - `/health`: recusa o deploy quando o motor de rotas não carrega; assistente sem chave não recusa.
  - Motor de rotas (`tests/test_vrp_coletas.py`): só entregas, só coletas, pedidos antigos sem
    tipo, viagem mista com entregas antes das coletas, capacidade, limite de paradas, plano B e
    janela de horário (ordem decidida pela janela, espera até abrir, janela que já passou,
    janela impossível pelo caminho, sem hora de saída) e medida da rota ajustada (`/avaliar`:
    mantém a ordem, ordem ruim custa mais km, atendimento, espera da janela, jornada, limite de
    paradas e mesma conta do motor para a mesma ordem).
    Roda com um OR-Tools simulado (`tests/fake_ortools.py`, força bruta com as mesmas regras de
    dimensão), porque o pacote não instala no ambiente de testes; as chamadas usadas são as dos
    exemplos oficiais do OR-Tools 9.9.
- Tela: `cd tests/tela && ./rodar.sh` (precisa de Node e Playwright: `npx playwright install chromium`).
  O script sobe o servidor local na porta 8771 e roda tudo; `./rodar.sh t_demo` roda uma só.
  As suítes `t_hero` e `t_oferta` são da página de vendas: passe o caminho dela em
  `PAGINA_VENDAS=/caminho/p-ginadevendasv3 ./rodar.sh`, senão são puladas.
  Hoje são 922 verificações em 33 suítes do sistema (19/11/2026). Nenhuma chama a internet: o Firebase é simulado
  (`tests/tela/fakefb`), o Leaflet vem de `tests/tela/vendor` e ViaCEP/Nominatim/OSRM são cortados.
  `t_xss.js` é a trava de segurança: falha se alguém tirar o `esc()` de um texto que vem de fora.
  `t_tracado.js` confere o traçado pelas ruas: o decodificador contra uma resposta real do OSRM
  (`backend/tests/dados/osrm_route_guarulhos.json`), a linha contínua quando há traçado, tracejada
  com aviso quando não há, o traçado guardado na rota confirmada, a rota antiga recebendo o
  traçado uma vez e a montagem no mapa pedindo o caminho só quando a pessoa para de tocar.
  `t_km_realizado.js` (3.12) faz o caminho inteiro: ajuste de tempo indo para o motor e mudando
  com a página aberta, aviso "sem o número", o km do painel fora da tela do motorista e ainda
  lido nas rotas antigas,
  caminho pelo GPS com o celular andando, GPS da baixa, planejado × realizado na rota, relatório e
  planilha, pino aprendido em duas rotas e a sugestão do ajuste em Acessos.
  `t_agendado.js` cobre o pedido agendado em todas as telas: vermelho no mapa e na lista, cinza
  com a data para outro dia, contagem no cartão da região, marca na busca, tela que se atualiza
  ao agendar e o botão de tirar o agendamento.
  `t_regras.js` confere as regras do banco (nós novos do link, ajuste e CD só pelo administrador).
  `t_planilha.js` importa a planilha de demonstração (`demo/pedidos-teste-sao-paulo-120.csv`) e
  confere o que a leitura precisa acertar: peso no formato brasileiro ("1.050,50" = 1050,5 kg),
  telefone do destinatário, coluna de tipo, nome de cidade padronizado, aviso de nota sem peso,
  endereço sem número, CEP inválido e NF repetida.

## Planilha de demonstração (`demo/`)

`demo/pedidos-teste-sao-paulo-120.xlsx` (e o mesmo em `.csv`): 120 notas de um dia em toda a São
Paulo e região, para demonstrar o sistema. 35 ruas com **CEP conferido** (OpenCEP, 16/11/2026);
clientes, pesos, volumes e telefones são fictícios — os telefones usam a faixa `(11) 90000-00xx`,
que não existe, então o arquivo **não serve para disparar mensagem**. As linhas estão na ordem das
notas fiscais, com a geografia embaralhada de propósito. Traz pegadinhas (3 notas na mesma porta,
endereço sem número, CEP com 7 dígitos, nota sem peso, peso "1.050,50", nota de 2.800 kg, NF
repetida, cidade escrita de 3 jeitos, 10 coletas). `demo/gerar.py` refaz o arquivo. O roteiro da
demonstração está em `claude/demonstracao-120-pedidos.md`, no projeto do Claude.
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

- Versão 3.12 (14/11/2026): **planejado × realizado**. Km do painel com foto e caminho pelo GPS no
  link do motorista, `POST /km-rastro` (OSRM `/match`), tempo real ÷ planejado e paradas fora da
  ordem na página Rotas e nos Relatórios, ajuste de tempo por empresa com sugestão tirada das
  baixas, custo da rota por tempo + distância, pino aprendido nas entregas e aviso dos pedidos sem
  o número. Ver "Km rodado, tempo real e pinos aprendidos".
- Versão 3.11 (14/11/2026): rota termina na última parada (volta ao CD opcional), agendado de
  outro dia fora do mapa e o do dia em vermelho, CD de cada empresa definido só pelo administrador.
- Versão 3.10 (11/11/2026): rota desenhada pelas ruas (OSRM `/route`), não mais em linha reta.

- Versão 3.9.1 (08/11/2026): o sistema passou a **guardar como mediu a distância** de cada rota.
  O servidor já dizia (`fonte_distancia`) e a tela já avisava na Roteirização, mas o aviso morria
  ali: a rota confirmada não registrava nada. Agora `rotas_confirmadas/<id>/fonte_dist` guarda
  `OSRM` (pelas ruas), `Haversine:limite` (passou de 100 paradas) ou `Haversine:indisponivel`
  (servidor de rotas sem resposta). A página Rotas marca a rota com "km em linha reta", e os
  Relatórios avisam quantas rotas e quantos km do período vieram de linha reta, com uma coluna
  "Medida" por rota e na planilha. Rotas anteriores a esta versão aparecem como "não registrado".
- Versão 3.9 (08/11/2026): página **Relatórios**. Soma as rotas confirmadas do período (hoje,
  7, 30 dias, este mês, mês passado) e cruza com o que ficou gravado em cada pedido: a `baixa`
  (entregue/coletado) e a `ocorrencia` (não realizado, com motivo). Mostra rotas, paradas
  planejadas, feitas, não feitas, sem baixa, porcentagem de sucesso, km planejado e peso; os
  motivos das não realizadas; uma tabela por rota e outra por motorista. Exporta planilha CSV
  (separador `;` e BOM, para o Excel em português abrir com acento) e imprime em PDF com o
  layout limpo. Não depende do nó `entregador/<token>/baixas`, que expira em 7 dias.
- Versão 3.8 (04/11/2026): os cinco veículos da frota deixaram de ser emoji e passaram a ter
  desenho próprio (`assets/veic/*.svg`). Antes, toco, bitruck e carreta usavam o mesmo 🚛, o que
  não deixava diferenciar um do outro. Agora cada um aparece de perfil com os eixos de verdade
  (toco 2, bitruck 3, carreta cavalo trucado + 3 do semirreboque) e na mesma escala, então o
  tamanho do desenho mostra o porte. Aparecem na roteirização, no atalho dos motoristas fixos,
  na página Motoristas e no cadastro de motorista.
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
