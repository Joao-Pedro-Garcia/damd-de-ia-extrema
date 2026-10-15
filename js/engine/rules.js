// Regras das Damas Brasileiras (8x8, 12 peças por lado).
//
// - As brancas começam.
// - Pedras andam uma casa na diagonal para a frente.
// - Pedras capturam para a frente e para trás.
// - Damas são de longo alcance: andam e capturam a distância, podendo
//   parar em qualquer casa livre após a peça capturada.
// - A captura é obrigatória e vale a Lei da Maioria: deve-se escolher a
//   sequência que captura o maior número de peças (pedra e dama valem igual).
// - Peças capturadas só saem do tabuleiro ao final da jogada e não podem ser
//   saltadas duas vezes (bloqueiam a passagem durante a sequência).
// - Uma pedra só é promovida se TERMINAR a jogada na última linha. Se passar
//   por ela no meio de uma captura múltipla, continua como pedra.
// - Empates: repetição tripla de posição; 20 lances sucessivos de damas sem
//   captura nem movimento de pedra (40 meio-lances); finais especiais
//   (2D x 2D, 2D x 1D, 2D+1P x 1D, 1D+1P x 1D, 1D+2P x 1D, 1D x 1D) após
//   5 lances de cada lado.

import { NUM_SQUARES, NEIGH, RAYS, ROW, sqName } from './geometry.js';

export const WHITE = 1;
export const BLACK = -1;

export const EMPTY = 0;
export const W_MAN = 1;
export const W_KING = 2;
export const B_MAN = -1;
export const B_KING = -2;

export const QUIET_DRAW_PLIES = 40; // 20 lances de cada lado
export const SPECIAL_ENDING_PLIES = 10; // 5 lances de cada lado

// ---------------------------------------------------------------------------
// Zobrist hashing (64 bits divididos em duas metades de 32 bits).
// Gerador determinístico: o mesmo hash na interface e no Web Worker.
// ---------------------------------------------------------------------------
let seed = 0x2545f491;
function rnd32() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return seed | 0;
}
export const Z_LO = new Int32Array(NUM_SQUARES * 4);
export const Z_HI = new Int32Array(NUM_SQUARES * 4);
for (let i = 0; i < NUM_SQUARES * 4; i++) {
  Z_LO[i] = rnd32();
  Z_HI[i] = rnd32();
}
export const Z_SIDE_LO = rnd32();
export const Z_SIDE_HI = rnd32();

/** Índice do tipo de peça para a tabela Zobrist. */
export function pieceIndex(p) {
  return p === W_MAN ? 0 : p === W_KING ? 1 : p === B_MAN ? 2 : 3;
}

// ---------------------------------------------------------------------------
// Posição
// ---------------------------------------------------------------------------
export class Position {
  constructor() {
    this.board = new Int8Array(NUM_SQUARES);
    this.side = WHITE;
    this.wm = 0; // pedras brancas
    this.wk = 0; // damas brancas
    this.bm = 0;
    this.bk = 0;
    this.quiet = 0; // meio-lances só de damas, sem captura (regra dos 20 lances)
    this.egPlies = 0; // meio-lances desde a última mudança de material
    this.hashLo = 0;
    this.hashHi = 0;
    this.undo = []; // pilha de [quiet, egPlies]
  }

  static initial() {
    const p = new Position();
    for (let sq = 0; sq < 12; sq++) p.board[sq] = B_MAN;
    for (let sq = 20; sq < 32; sq++) p.board[sq] = W_MAN;
    p.side = WHITE;
    p.recompute();
    return p;
  }

  /** Cria uma posição a partir de um objeto serializável. */
  static fromObject(o) {
    const p = new Position();
    p.board.set(o.board);
    p.side = o.side;
    p.quiet = o.quiet | 0;
    p.egPlies = o.egPlies | 0;
    p.recompute();
    return p;
  }

  toObject() {
    return { board: Array.from(this.board), side: this.side, quiet: this.quiet, egPlies: this.egPlies };
  }

  clone() {
    return Position.fromObject(this.toObject());
  }

  /** Recalcula contagens e hash a partir do tabuleiro. */
  recompute() {
    this.wm = this.wk = this.bm = this.bk = 0;
    let lo = 0;
    let hi = 0;
    for (let sq = 0; sq < NUM_SQUARES; sq++) {
      const v = this.board[sq];
      if (v === EMPTY) continue;
      if (v === W_MAN) this.wm++;
      else if (v === W_KING) this.wk++;
      else if (v === B_MAN) this.bm++;
      else this.bk++;
      const z = sq * 4 + pieceIndex(v);
      lo ^= Z_LO[z];
      hi ^= Z_HI[z];
    }
    if (this.side === BLACK) {
      lo ^= Z_SIDE_LO;
      hi ^= Z_SIDE_HI;
    }
    this.hashLo = lo;
    this.hashHi = hi;
  }

  get hashKey() {
    return (this.hashHi >>> 0).toString(16) + ':' + (this.hashLo >>> 0).toString(16);
  }

  pieceCount(side) {
    return side === WHITE ? this.wm + this.wk : this.bm + this.bk;
  }
}

// ---------------------------------------------------------------------------
// Movimento
// ---------------------------------------------------------------------------
// {
//   from, to,            casas de origem e destino
//   path: number[],      casas de pouso em ordem (termina em `to`)
//   caps: number[],      casas das peças capturadas, na ordem da captura
//   capVals: number[],   valores das peças capturadas (para desfazer)
//   capMask: number,     bitmask de 32 bits das casas capturadas
//   piece,               peça que se move
//   promote: boolean
// }

function makeMoveObj(from, to, path, caps, capVals, capMask, piece, promote) {
  return { from, to, path, caps, capVals, capMask, piece, promote };
}

export function sameMove(a, b) {
  return a.from === b.from && a.to === b.to && a.capMask === b.capMask;
}

// Estado temporário da geração de capturas (evita alocações na recursão).
const pathBuf = new Int8Array(32);
const capBuf = new Int8Array(32);
let gBoard = null;
let gSide = 0;
let gFrom = 0;
let gPiece = 0;
let gBest = 0;
let gOut = null;

function recordCapture(cur, depth, capMask) {
  if (depth < gBest) return;
  if (depth > gBest) {
    gBest = depth;
    if (gOut) gOut.length = 0;
  }
  if (!gOut) return; // só contando
  // Remove duplicatas (mesma origem, destino e conjunto capturado).
  for (let i = 0; i < gOut.length; i++) {
    const m = gOut[i];
    if (m.from === gFrom && m.to === cur && m.capMask === capMask) return;
  }
  const path = Array.from(pathBuf.subarray(0, depth));
  const caps = Array.from(capBuf.subarray(0, depth));
  const capVals = caps.map((s) => gBoard[s]);
  const isMan = gPiece === W_MAN || gPiece === B_MAN;
  const promote = isMan && ROW[cur] === (gSide === WHITE ? 0 : 7);
  gOut.push(makeMoveObj(gFrom, cur, path, caps, capVals, capMask, gPiece, promote));
}

function manCaptures(cur, depth, capMask) {
  const b = gBoard;
  const side = gSide;
  let found = false;
  for (let d = 0; d < 4; d++) {
    const n = NEIGH[cur * 4 + d];
    if (n < 0) continue;
    const v = b[n];
    if (v === EMPTY || v > 0 === side > 0) continue;
    if (capMask & (1 << n)) continue;
    const l = NEIGH[n * 4 + d];
    if (l < 0 || b[l] !== EMPTY) continue;
    found = true;
    pathBuf[depth] = l;
    capBuf[depth] = n;
    manCaptures(l, depth + 1, capMask | (1 << n));
  }
  if (!found && depth > 0) recordCapture(cur, depth, capMask);
}

function kingCaptures(cur, depth, capMask) {
  const b = gBoard;
  const side = gSide;
  let found = false;
  for (let d = 0; d < 4; d++) {
    const ray = RAYS[cur * 4 + d];
    const len = ray.length;
    let i = 0;
    while (i < len && b[ray[i]] === EMPTY) i++;
    if (i >= len - 1) continue;
    const n = ray[i];
    const v = b[n];
    if (v > 0 === side > 0) continue; // peça própria bloqueia
    if (capMask & (1 << n)) continue; // peça já capturada bloqueia
    let j = i + 1;
    while (j < len && b[ray[j]] === EMPTY) {
      found = true;
      pathBuf[depth] = ray[j];
      capBuf[depth] = n;
      kingCaptures(ray[j], depth + 1, capMask | (1 << n));
      j++;
    }
  }
  if (!found && depth > 0) recordCapture(cur, depth, capMask);
}

/**
 * Gera as capturas máximas do lado `side` (Lei da Maioria).
 * Retorna o número de peças capturadas (0 se não houver captura).
 * Se `out` for null, apenas conta.
 */
function generateCaptures(pos, side, out) {
  const b = pos.board;
  gBoard = b;
  gSide = side;
  gBest = 0;
  gOut = out;
  for (let sq = 0; sq < NUM_SQUARES; sq++) {
    const p = b[sq];
    if (p === EMPTY || p > 0 !== side > 0) continue;
    gFrom = sq;
    gPiece = p;
    b[sq] = EMPTY; // a peça sai da origem durante a sequência
    if (p === W_MAN || p === B_MAN) manCaptures(sq, 0, 0);
    else kingCaptures(sq, 0, 0);
    b[sq] = p;
  }
  gOut = null;
  gBoard = null;
  return gBest;
}

/** Maior número de peças que `side` pode capturar agora (0 = nenhuma). */
export function maxCaptureCount(pos, side) {
  return generateCaptures(pos, side, null);
}

function generateQuiet(pos, out) {
  const b = pos.board;
  const side = pos.side;
  const promoRow = side === WHITE ? 0 : 7;
  const d0 = side === WHITE ? 0 : 2;
  for (let sq = 0; sq < NUM_SQUARES; sq++) {
    const p = b[sq];
    if (p === EMPTY || p > 0 !== side > 0) continue;
    if (p === W_MAN || p === B_MAN) {
      for (let d = d0; d < d0 + 2; d++) {
        const n = NEIGH[sq * 4 + d];
        if (n >= 0 && b[n] === EMPTY) {
          out.push(makeMoveObj(sq, n, [n], [], [], 0, p, ROW[n] === promoRow));
        }
      }
    } else {
      for (let d = 0; d < 4; d++) {
        const ray = RAYS[sq * 4 + d];
        for (let i = 0; i < ray.length; i++) {
          const n = ray[i];
          if (b[n] !== EMPTY) break;
          out.push(makeMoveObj(sq, n, [n], [], [], 0, p, false));
        }
      }
    }
  }
}

/** Todas as jogadas legais do lado a mover. */
export function generateMoves(pos) {
  const out = [];
  if (generateCaptures(pos, pos.side, out) > 0) return out;
  generateQuiet(pos, out);
  return out;
}

/** Existe alguma jogada legal? (mais rápido que gerar tudo). */
export function hasAnyMove(pos) {
  if (maxCaptureCount(pos, pos.side) > 0) return true;
  const b = pos.board;
  const side = pos.side;
  const d0 = side === WHITE ? 0 : 2;
  for (let sq = 0; sq < NUM_SQUARES; sq++) {
    const p = b[sq];
    if (p === EMPTY || p > 0 !== side > 0) continue;
    const isMan = p === W_MAN || p === B_MAN;
    for (let d = isMan ? d0 : 0; d < (isMan ? d0 + 2 : 4); d++) {
      const n = NEIGH[sq * 4 + d];
      if (n >= 0 && b[n] === EMPTY) return true;
    }
  }
  return false;
}

function addPiece(pos, sq, v, delta) {
  if (v === W_MAN) pos.wm += delta;
  else if (v === W_KING) pos.wk += delta;
  else if (v === B_MAN) pos.bm += delta;
  else pos.bk += delta;
  const z = sq * 4 + pieceIndex(v);
  pos.hashLo ^= Z_LO[z];
  pos.hashHi ^= Z_HI[z];
}

/** Executa um movimento gerado por `generateMoves` nesta mesma posição. */
export function makeMove(pos, m) {
  const b = pos.board;
  pos.undo.push(pos.quiet, pos.egPlies);
  const p = b[m.from];
  b[m.from] = EMPTY;
  addPiece(pos, m.from, p, -1);
  const caps = m.caps;
  for (let i = 0; i < caps.length; i++) {
    const s = caps[i];
    addPiece(pos, s, b[s], -1);
    b[s] = EMPTY;
  }
  const np = m.promote ? (p > 0 ? W_KING : B_KING) : p;
  b[m.to] = np;
  addPiece(pos, m.to, np, 1);
  pos.side = -pos.side;
  pos.hashLo ^= Z_SIDE_LO;
  pos.hashHi ^= Z_SIDE_HI;
  const isMan = p === W_MAN || p === B_MAN;
  pos.quiet = caps.length > 0 || isMan ? 0 : pos.quiet + 1;
  pos.egPlies = caps.length > 0 || m.promote ? 0 : pos.egPlies + 1;
}

/** Desfaz o último `makeMove(pos, m)`. */
export function unmakeMove(pos, m) {
  const b = pos.board;
  pos.side = -pos.side;
  pos.hashLo ^= Z_SIDE_LO;
  pos.hashHi ^= Z_SIDE_HI;
  const np = b[m.to];
  addPiece(pos, m.to, np, -1);
  b[m.to] = EMPTY;
  const caps = m.caps;
  for (let i = 0; i < caps.length; i++) {
    const s = caps[i];
    b[s] = m.capVals[i];
    addPiece(pos, s, m.capVals[i], 1);
  }
  b[m.from] = m.piece;
  addPiece(pos, m.from, m.piece, 1);
  pos.egPlies = pos.undo.pop();
  pos.quiet = pos.undo.pop();
}

/** Final especial que é declarado empate após 5 lances de cada lado. */
export function isSpecialEnding(pos) {
  return specialPair(pos.wk, pos.wm, pos.bk, pos.bm) || specialPair(pos.bk, pos.bm, pos.wk, pos.wm);
}

function specialPair(sk, sm, wk, wm) {
  if (wm !== 0) return false;
  if (wk === 1) return (sk === 1 && sm <= 2) || (sk === 2 && sm <= 1);
  if (wk === 2) return sk === 2 && sm === 0;
  return false;
}

/**
 * Situação da partida.
 * `history` = chaves de hash (Position.hashKey) das posições anteriores,
 * incluindo a atual por último.
 * Retorna { over, winner (WHITE/BLACK/0), reason }.
 */
export function gameStatus(pos, history = []) {
  if (!hasAnyMove(pos)) {
    const noPieces = pos.pieceCount(pos.side) === 0;
    return {
      over: true,
      winner: -pos.side,
      reason: noPieces ? 'sem-pecas' : 'bloqueado',
    };
  }
  if (pos.quiet >= QUIET_DRAW_PLIES) return { over: true, winner: 0, reason: 'vinte-lances' };
  if (isSpecialEnding(pos) && pos.egPlies >= SPECIAL_ENDING_PLIES) {
    return { over: true, winner: 0, reason: 'final-especial' };
  }
  if (history.length) {
    const key = pos.hashKey;
    let count = 0;
    // Só posições desde o último lance irreversível podem se repetir.
    const start = Math.max(0, history.length - 1 - pos.quiet);
    for (let i = start; i < history.length; i++) if (history[i] === key) count++;
    if (count >= 3) return { over: true, winner: 0, reason: 'repeticao' };
  }
  return { over: false, winner: 0, reason: '' };
}

/** Notação algébrica: "c3-d4" ou "c3xe5xg7". */
export function moveToString(m) {
  if (m.caps.length === 0) return sqName(m.from) + '-' + sqName(m.to);
  return [m.from, ...m.path].map(sqName).join('x');
}

/** Contagem de nós (perft), usada nos testes de regras. */
export function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = generateMoves(pos);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) {
    makeMove(pos, m);
    n += perft(pos, depth - 1);
    unmakeMove(pos, m);
  }
  return n;
}
