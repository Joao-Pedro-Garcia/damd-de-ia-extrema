import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Position, generateMoves, makeMove, unmakeMove, perft, gameStatus, isSpecialEnding,
  W_KING, B_KING, W_MAN,
} from '../js/engine/rules.js';
import { fromDiagram, sq, names, WHITE, BLACK } from './helpers.mjs';

test('posição inicial: 12 peças de cada lado e 7 lances', () => {
  const p = Position.initial();
  assert.equal(p.wm, 12);
  assert.equal(p.bm, 12);
  assert.deepEqual(names(generateMoves(p)), ['a3-b4', 'c3-b4', 'c3-d4', 'e3-d4', 'e3-f4', 'g3-f4', 'g3-h4']);
});

test('perft da posição inicial', () => {
  const p = Position.initial();
  assert.equal(perft(p, 1), 7);
  assert.equal(perft(p, 2), 49);
  assert.equal(perft(p, 3), 302);
});

test('pedra captura para trás', () => {
  const p = fromDiagram([
    '........', '........', '........', '........',
    '...w....', '..b.....', '........', '........',
  ], WHITE);
  // branca em d4, preta em c3 (atrás): captura d4xb2
  assert.deepEqual(names(generateMoves(p)), ['d4xb2']);
});

test('captura é obrigatória', () => {
  const p = fromDiagram([
    '........', '........', '........', '..b.....',
    '...w....', '........', '.....w..', '........',
  ], WHITE);
  assert.deepEqual(names(generateMoves(p)), ['d4xb6']);
});

test('lei da maioria: deve capturar o maior número de peças', () => {
  const p = fromDiagram([
    '........',
    '........',
    '...b.b..',
    '........',
    '...b....',
    '..w.....',
    '.......w',
    '......b.',
  ], WHITE);
  // c3xe5xg7? não: d6/f6. c3xe5 captura d4, depois e5xc7 (d6) ou e5xg7 (f6).
  const moves = generateMoves(p);
  assert.ok(moves.every((m) => m.caps.length === 2), names(moves).join(','));
  assert.deepEqual(names(moves), ['c3xe5xc7', 'c3xe5xg7']);
});

test('dama captura a distância e escolhe a casa de pouso', () => {
  const p = fromDiagram([
    '........', '........', '........', '........',
    '........', '..b.....', '........', 'W.......',
  ], WHITE);
  // a1 x c3 → pode parar em d4, e5, f6, g7, h8
  assert.deepEqual(names(generateMoves(p)), ['a1xd4', 'a1xe5', 'a1xf6', 'a1xg7', 'a1xh8']);
});

test('dama: pouso precisa permitir a continuação máxima', () => {
  const p = fromDiagram([
    '........',
    '........',
    '........',
    '......b.',
    '........',
    '..b.....',
    '........',
    'W.......',
  ], WHITE);
  // a1xc3 só pode pousar em f6, de onde continua f6xh4 capturando g5.
  assert.deepEqual(names(generateMoves(p)), ['a1xf6xh4']);
  const p2 = fromDiagram([
    '........',
    '........',
    '.....b..',
    '........',
    '........',
    '..b.....',
    '........',
    'W.......',
  ], WHITE);
  // a1xc3, pousa em d4 e captura f6 de... d4 NE: e5, f6(b), g7 vazio → d4xg7 ou h8? h8 é (0,7): após f6 vem g7, h8.
  // Pousar em e5: e5 NE é f6 → g7/h8 também. Todas com 2 capturas.
  const moves = generateMoves(p2);
  assert.ok(moves.length > 0 && moves.every((m) => m.caps.length === 2));
  assert.deepEqual([...new Set(moves.map((m) => m.to))].sort(), [sq('g7'), sq('h8')].sort());
});

test('peça capturada não pode ser saltada duas vezes (bloqueia a passagem)', () => {
  // Dama em a1 com peças em c3 e e3/c5 formando um "laço" em volta.
  const p = fromDiagram([
    '........',
    '........',
    '........',
    '........',
    '........',
    '..b.b...',
    '........',
    'W.......',
  ], WHITE);
  const moves = generateMoves(p);
  for (const m of moves) {
    assert.equal(new Set(m.caps).size, m.caps.length);
  }
});

test('promoção só ao terminar a jogada na última linha', () => {
  // Pedra branca em c7 pula d8? Monta: branca em b6, pretas em c7 e e7.
  // b6xd8 (passa pela última linha) e continua d8xf6 capturando e7: termina em f6 sem promover.
  const p = fromDiagram([
    '........',
    '..b.b...',
    '.w......',
    '........',
    '........',
    '........',
    '........',
    '........',
  ], WHITE);
  const moves = generateMoves(p);
  assert.deepEqual(names(moves), ['b6xd8xf6']);
  assert.equal(moves[0].promote, false);
  makeMove(p, moves[0]);
  assert.equal(p.board[sq('f6')], W_MAN);

  const q = fromDiagram([
    '........', '..b.....', '.w......', '........',
    '........', '........', '........', '........',
  ], WHITE);
  const m2 = generateMoves(q);
  assert.deepEqual(names(m2), ['b6xd8']);
  assert.equal(m2[0].promote, true);
  makeMove(q, m2[0]);
  assert.equal(q.board[sq('d8')], W_KING);
});

test('promoção simples das pretas', () => {
  const p = fromDiagram([
    '........', '........', '........', '........',
    '........', '........', '.b......', '........',
  ], BLACK);
  const moves = generateMoves(p);
  assert.ok(moves.every((m) => m.promote));
  makeMove(p, moves[0]);
  assert.equal(p.board[moves[0].to], B_KING);
});

test('make/unmake restaura posição e hash em partidas aleatórias', () => {
  let rng = 12345;
  const rand = (n) => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) % n);
  for (let g = 0; g < 200; g++) {
    const p = Position.initial();
    const stack = [];
    for (let ply = 0; ply < 150; ply++) {
      const moves = generateMoves(p);
      if (!moves.length) break;
      const before = { b: Array.from(p.board), lo: p.hashLo, hi: p.hashHi, q: p.quiet };
      const m = moves[rand(moves.length)];
      makeMove(p, m);
      const check = p.clone();
      assert.equal(check.hashLo, p.hashLo, 'hash incremental');
      assert.equal(check.wm + check.wk, p.wm + p.wk);
      unmakeMove(p, m);
      assert.deepEqual(Array.from(p.board), before.b);
      assert.equal(p.hashLo, before.lo);
      assert.equal(p.hashHi, before.hi);
      assert.equal(p.quiet, before.q);
      makeMove(p, m);
      stack.push(m);
    }
  }
});

test('fim de jogo: sem peças e bloqueio', () => {
  const p = fromDiagram([
    '........', '........', '........', '........',
    '........', '........', '........', 'w.......',
  ], BLACK);
  assert.deepEqual(gameStatus(p), { over: true, winner: WHITE, reason: 'sem-pecas' });
  // Pedra preta em a7? bloqueada: preta em h8? Monta preta em a3 bloqueada por brancas em b2 e c1.
  const q = fromDiagram([
    '........', '........', '........', '........',
    '........', 'b.......', '.w......', '..w.....',
  ], BLACK);
  assert.deepEqual(gameStatus(q), { over: true, winner: WHITE, reason: 'bloqueado' });
});

test('empate pela regra dos 20 lances de damas', () => {
  const p = fromDiagram([
    '.W......', '........', '........', '........',
    '........', '........', '........', '......B.',
  ], WHITE);
  p.quiet = 40;
  assert.equal(gameStatus(p).reason, 'vinte-lances');
});

test('empate em final especial após 5 lances de cada', () => {
  const p = fromDiagram([
    '.W......', '........', '...W....', '........',
    '........', '........', '........', '......B.',
  ], WHITE);
  assert.ok(isSpecialEnding(p));
  p.egPlies = 10;
  assert.equal(gameStatus(p).reason, 'final-especial');
});

test('empate por repetição tripla', () => {
  const p = fromDiagram([
    '.W......', '........', '........', '........',
    '........', '........', '........', '......B.',
  ], WHITE);
  const hist = [p.hashKey];
  const seq = [['b8', 'a7'], ['g1', 'h2'], ['a7', 'b8'], ['h2', 'g1']];
  for (let rep = 0; rep < 2; rep++) {
    for (const [f, t] of seq) {
      const m = generateMoves(p).find((x) => x.from === sq(f) && x.to === sq(t));
      assert.ok(m, `${f}-${t}`);
      makeMove(p, m);
      hist.push(p.hashKey);
    }
  }
  assert.equal(gameStatus(p, hist).reason, 'repeticao');
});
