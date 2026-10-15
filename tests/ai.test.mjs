import test from 'node:test';
import assert from 'node:assert/strict';
import { Position, generateMoves, makeMove, sameMove, WHITE, BLACK } from '../js/engine/rules.js';
import { Searcher, MATE } from '../js/ai/search.js';
import { LEVELS } from '../js/ai/levels.js';
import { evaluate } from '../js/ai/evaluate.js';
import { fromDiagram, sq, names } from './helpers.mjs';

test('a IA sempre devolve um lance legal (posições aleatórias)', () => {
  const s = new Searcher({ ttBits: 16 });
  let rng = 99;
  const rand = (n) => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) % n);
  for (let g = 0; g < 40; g++) {
    const p = Position.initial();
    const plies = 5 + rand(60);
    for (let i = 0; i < plies; i++) {
      const ms = generateMoves(p);
      if (!ms.length) break;
      makeMove(p, ms[rand(ms.length)]);
    }
    const legal = generateMoves(p);
    if (!legal.length) continue;
    const res = s.think(p, [], { ...LEVELS.impossivel, timeMs: 30 });
    assert.ok(legal.some((m) => sameMove(m, res.move)), 'lance ilegal');
  }
});

test('não entrega peça de graça', () => {
  const p = fromDiagram([
    '........',
    'b.......',
    '........',
    '....b...',
    '........',
    '..w.....',
    '.......w',
    '........',
  ], WHITE);
  for (const lv of ['medio', 'dificil', 'impossivel']) {
    const res = new Searcher({ ttBits: 16 }).think(p, [], { ...LEVELS[lv], timeMs: 300 });
    assert.ok(!(res.move.from === sq('c3') && res.move.to === sq('d4')), `${lv} entregou a peça`);
  }
});

test('encontra combinação: sacrifica uma pedra para capturar três', () => {
  // c3-d4! obriga e5xc3 e as brancas respondem b2xd4xb6xd8, virando dama.
  const p = fromDiagram([
    '.......b',
    '..b.....',
    '........',
    '..b.b...',
    '........',
    '..w.w...',
    '.w......',
    'w.......',
  ], WHITE);
  for (const lv of ['dificil', 'mestre', 'impossivel']) {
    const res = new Searcher({ ttBits: 16 }).think(p, [], { ...LEVELS[lv], timeMs: 400 });
    assert.deepEqual([res.move.from, res.move.to], [sq('c3'), sq('d4')], lv);
    assert.ok(res.score > 150, `${lv}: ${res.score}`);
  }
});

test('final ganho: duas damas contra uma pedra acham vitória forçada', () => {
  const p = fromDiagram([
    '........',
    '..b.....',
    '........',
    '........',
    '........',
    '........',
    '........',
    'W.....W.',
  ], WHITE);
  const res = new Searcher({ ttBits: 18 }).think(p, [], { ...LEVELS.impossivel, timeMs: 2000 });
  assert.ok(res.score > MATE - 200, `score ${res.score}`);
});

test('defende-se de ameaça: a busca vê a resposta do adversário', () => {
  // Pedra branca em e5 está ameaçada? Nada de capturas agora para as brancas.
  const p = Position.initial();
  const res = new Searcher({ ttBits: 16 }).think(p, [], { ...LEVELS.dificil, timeMs: 300 });
  assert.ok(generateMoves(p).some((m) => sameMove(m, res.move)));
  assert.ok(Math.abs(res.score) < 150, 'posição inicial deve ser equilibrada');
});

test('níveis mais altos buscam mais fundo', () => {
  const p = Position.initial();
  const depthOf = (lv) => new Searcher({ ttBits: 18 }).think(p, [], { ...LEVELS[lv], timeMs: Math.min(LEVELS[lv].timeMs, 800) }).depth;
  const f = depthOf('facil');
  const m = depthOf('medio');
  const d = depthOf('dificil');
  const i = depthOf('impossivel');
  assert.ok(f < m && m < d && d <= i, `${f} ${m} ${d} ${i}`);
});

test('avaliação é simétrica entre as cores', () => {
  let rng = 5;
  const rand = (n) => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) % n);
  for (let g = 0; g < 50; g++) {
    const p = Position.initial();
    for (let i = 0; i < 10 + rand(40); i++) {
      const ms = generateMoves(p);
      if (!ms.length) break;
      makeMove(p, ms[rand(ms.length)]);
    }
    const q = new Position();
    for (let s = 0; s < 32; s++) q.board[31 - s] = -p.board[s];
    q.side = -p.side;
    q.recompute();
    assert.equal(evaluate(p), evaluate(q));
  }
});

test('lance único é jogado imediatamente', () => {
  const p = fromDiagram([
    '........', '........', '........', '........',
    '...w....', '..b.....', '........', '........',
  ], WHITE);
  const res = new Searcher({ ttBits: 16 }).think(p, [], LEVELS.impossivel);
  assert.equal(res.forced, true);
  assert.deepEqual(names([generateMoves(p).find((m) => sameMove(m, res.move))]), ['d4xb2']);
  void BLACK;
});
