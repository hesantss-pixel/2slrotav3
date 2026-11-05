#!/usr/bin/env bash
# Roda os testes de tela. Sobe os servidores locais, executa as suítes e mostra o resumo.
#
#   ./rodar.sh              → todas as suítes do sistema
#   ./rodar.sh t_demo       → só uma
#
# As suítes t_hero e t_oferta testam a PÁGINA DE VENDAS: precisam do repositório
# p-ginadevendasv3 servido na porta 8772. Passe o caminho em PAGINA_VENDAS, ou elas são puladas.
set -u
cd "$(dirname "$0")"
SISTEMA="$(cd ../.. && pwd)"
PORTA_SIS=8771
PORTA_VEN=8772
PAGINA_VENDAS="${PAGINA_VENDAS:-}"

subir() { # porta pasta
  curl -s -o /dev/null "http://127.0.0.1:$1/index.html" && return 0
  (cd "$2" && nohup python3 -m http.server "$1" >/dev/null 2>&1 &)
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    curl -s -o /dev/null "http://127.0.0.1:$1/index.html" && return 0
    sleep 0.4
  done
  return 1
}

subir "$PORTA_SIS" "$SISTEMA" || { echo "não consegui servir o sistema na porta $PORTA_SIS"; exit 1; }
TEM_VENDAS=0
if [ -n "$PAGINA_VENDAS" ] && subir "$PORTA_VEN" "$PAGINA_VENDAS"; then TEM_VENDAS=1; fi

mkdir -p veic
SUITES="${*:-$(ls t_*.js | sed 's/\.js$//')}"
total=0; ruins=0
for t in $SUITES; do
  case "$t" in
    t_hero|t_oferta) [ "$TEM_VENDAS" = 1 ] || { printf '%-16s pulada (defina PAGINA_VENDAS)\n' "$t"; continue; } ;;
  esac
  saida="$(timeout 500 node "$t.js" 2>&1)"
  n=$(printf '%s' "$saida" | grep -c '^OK')
  f=$(printf '%s' "$saida" | grep -c '^FALHA')
  c=$(printf '%s' "$saida" | grep -cE 'TimeoutError|^Node\.js v')
  total=$((total+n)); ruins=$((ruins+f+c))
  printf '%-16s %3s ok  %s%s\n' "$t" "$n" "$([ "$f" -gt 0 ] && echo "$f FALHA ")" "$([ "$c" -gt 0 ] && echo QUEBROU)"
  [ "$f" -gt 0 ] && printf '%s\n' "$saida" | grep '^FALHA' | sed 's/^/    /'
done
echo "────────────────────────"
echo "$total verificações, $ruins problemas"
[ "$ruins" -eq 0 ]
