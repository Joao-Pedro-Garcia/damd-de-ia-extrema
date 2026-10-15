# Damas · IA Extrema

Jogo de **Damas Brasileiras** (8×8, 12 peças por lado) contra uma inteligência
artificial de alto nível. Feito com HTML, CSS e JavaScript puros (módulos ES),
sem dependências e sem serviços externos: funciona offline.

## Como executar

Os módulos JavaScript e o Web Worker precisam de um servidor HTTP (abrir o
`index.html` com duplo clique não funciona por restrição do navegador).

```bash
npm start            # servidor embutido, sem dependências → http://localhost:8080
# ou
python3 -m http.server 8080
```

Também pode ser publicado como site estático (GitHub Pages, Netlify etc.).

## Testes

```bash
npm test                                   # regras e IA (node:test)
node tests/match.mjs impossivel mestre 4   # partidas IA × IA entre níveis
```

## Regras implementadas

- As brancas começam; casa escura no canto inferior esquerdo de cada jogador.
- Pedras andam uma casa na diagonal para a frente e **capturam para a frente e para trás**.
- **Captura obrigatória** com a **lei da maioria**: é obrigatório escolher a
  sequência que captura mais peças.
- Capturas múltiplas na mesma jogada; as peças capturadas só saem no final e
  não podem ser saltadas duas vezes.
- Promoção a dama somente quando a pedra **termina** a jogada na última linha
  (se passar por ela no meio de uma captura, continua como pedra).
- Damas de longo alcance: andam e capturam a distância, parando em qualquer casa
  livre após a peça capturada.
- Fim de jogo: vitória ao capturar ou bloquear todas as peças adversárias.
- Empates: repetição tripla; 20 lances seguidos só de damas sem captura;
  finais especiais (2D×2D, 2D×1D, 2D+1P×1D, 1D+1P×1D, 1D+2P×1D, 1D×1D)
  após 5 lances de cada lado.

## A inteligência artificial

A busca roda em um **Web Worker**, então a interface nunca congela.

| Técnica | Onde |
| --- | --- |
| Negamax com poda Alfa-Beta + PVS | `js/ai/search.js` |
| Aprofundamento iterativo com limite de tempo e janelas de aspiração | `think()` |
| Tabela de transposição (Zobrist 64 bits, 2¹⁹–2²¹ entradas conforme o aparelho) | `ttProbe/ttStore` |
| Ordenação: lance da TT, capturas, promoções, killer moves, history heuristic | `orderMoves()` |
| Quiescence: continua enquanto houver capturas obrigatórias | `negamax()` |
| Extensão de lance forçado e Late Move Reductions | `negamax()` |
| Detecção de repetição e regras de empate dentro da árvore | `isRepetition()` |
| Avaliação: material, avanço, centro, guarda da última linha, apoio, bordas, grande diagonal, mobilidade, pedras livres, **ameaças** (capturas que o adversário já tem), conhecimento de finais | `js/ai/evaluate.js` |

Níveis (`js/ai/levels.js`):

| Nível | Profundidade máx. | Tempo | Avaliação |
| --- | --- | --- | --- |
| Fácil | 2 | 0,3 s | material + avanço |
| Médio | 4 | 0,6 s | posicional |
| Difícil | 8 | 1,2 s | completa + LMR + extensões |
| Mestre | 16 | 2,5 s | completa, mais tempo em finais |
| Impossível | até 100 | 4–6 s (conforme o aparelho) | completa, mais tempo em finais, tabela maior |

Nenhum nível joga aleatoriamente ou erra de propósito: a diferença está apenas
em quanto a IA calcula. O nível Impossível é o mais forte que o aparelho
permite no tempo dado, mas **não é uma solução perfeita** do jogo.

Todo lance devolvido pela IA é conferido contra a lista de lances legais antes
de ser executado.

## Interface

- Clique/toque para selecionar e mover, ou arraste a peça.
- Destaque da peça selecionada, das casas de destino e das peças que serão capturadas;
  peças obrigadas a capturar pulsam.
- Em capturas múltiplas, clique direto no destino final (ou salto a salto,
  se houver mais de um caminho).
- Animação de cada salto; o estado só muda depois da animação.
- Indicador de turno, peças restantes, cronômetro opcional, histórico em notação algébrica.
- **Modo treino**: desfazer, dicas e avaliação numérica (não conta nas estatísticas).
- Preferências e estatísticas (vitórias/empates/derrotas por nível) salvas no `localStorage`.
- Efeitos sonoros sintetizados (Web Audio), com opção para desligar.

## Estrutura

```
index.html
css/styles.css
js/engine/geometry.js   geometria do tabuleiro (32 casas, vizinhos, raios)
js/engine/rules.js      regras, geração de lances, make/unmake, Zobrist, empates
js/ai/evaluate.js       avaliação estática
js/ai/search.js         busca
js/ai/levels.js         níveis e perfil do aparelho
js/ai/worker.js         Web Worker
js/ui/app.js            controlador da partida
js/ui/board-view.js     tabuleiro, animações, toque/mouse
js/ui/ai-client.js      comunicação com o worker (com fallback)
js/ui/sound.js          sons
js/ui/storage.js        preferências e estatísticas
tests/                  testes de regras e IA, partidas IA × IA
server.mjs              servidor estático para `npm start`
```
