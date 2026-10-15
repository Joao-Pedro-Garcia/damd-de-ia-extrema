// Função de avaliação estática.
// Retorna a pontuação do ponto de vista do lado a mover (centésimos de pedra).
//
// Termos considerados (no nível completo):
//  - material (pedra = 100, dama ≈ 3,2 pedras, valor cresce no final)
//  - avanço/promoção das pedras (mais importante no final)
//  - controle do centro
//  - guarda da última linha (impede promoções adversárias)
//  - estrutura: pedras apoiadas por trás, pedras na borda
//  - domínio da grande diagonal e das diagonais duplas pelas damas
//  - mobilidade
//  - pedras "livres" a caminho da promoção (runaway)
//  - ameaças: capturas que o adversário já tem disponíveis
//  - conhecimento de finais: troca quando à frente, finais empatados, cerco

import { NUM_SQUARES, NEIGH, RAYS, ROW, COL } from '../engine/geometry.js';
import { WHITE, W_MAN, W_KING, B_MAN, B_KING, maxCaptureCount } from '../engine/rules.js';

export const MAN_VALUE = 100;
export const KING_VALUE = 320;

export const EVAL_BASIC = 0;
export const EVAL_POSITIONAL = 1;
export const EVAL_FULL = 2;

// Tabelas pré-calculadas do ponto de vista das brancas (casa sq).
const ADV_MG = [0, 2, 4, 7, 10, 14, 20, 0];
const ADV_EG = [0, 6, 12, 18, 26, 36, 50, 0];
const CENTER = new Int8Array(NUM_SQUARES);
const EDGE = new Uint8Array(NUM_SQUARES);
const LONG_DIAG = new Uint8Array(NUM_SQUARES);
const DOUBLE_DIAG = new Uint8Array(NUM_SQUARES);

for (let sq = 0; sq < NUM_SQUARES; sq++) {
  const r = ROW[sq];
  const c = COL[sq];
  if (r >= 2 && r <= 5 && c >= 2 && c <= 5) CENTER[sq] = r >= 3 && r <= 4 && c >= 3 && c <= 4 ? 2 : 1;
  EDGE[sq] = c === 0 || c === 7 ? 1 : 0;
  LONG_DIAG[sq] = r + c === 7 ? 1 : 0; // a1-h8
  DOUBLE_DIAG[sq] = Math.abs(r - c) === 1 ? 1 : 0; // b1-h7 e a2-g8
}

// Guarda da última linha: c1 e g1 (brancas) / f8 e b8 (pretas).
const W_GUARD = [29, 31]; // c1 = (7,2) -> 29 ; g1 = (7,6) -> 31
const B_GUARD = [2, 0]; // espelhos

function phaseOf(total) {
  // 0 = abertura (24 peças) … 16 = final (≤ 6 peças)
  const p = Math.round(((24 - total) * 16) / 18);
  return p < 0 ? 0 : p > 16 ? 16 : p;
}

/** Avaliação do ponto de vista do lado a mover. */
export function evaluate(pos, level = EVAL_FULL) {
  const b = pos.board;
  const wCount = pos.wm + pos.wk;
  const bCount = pos.bm + pos.bk;
  if (wCount === 0) return pos.side === WHITE ? -90000 : 90000;
  if (bCount === 0) return pos.side === WHITE ? 90000 : -90000;

  const total = wCount + bCount;
  const ph = phaseOf(total);
  const mg = 16 - ph;
  const kingVal = KING_VALUE + ph * 3;

  const wMat = pos.wm * MAN_VALUE + pos.wk * kingVal;
  const bMat = pos.bm * MAN_VALUE + pos.bk * kingVal;
  let score = wMat - bMat;

  if (level === EVAL_BASIC) {
    for (let sq = 0; sq < NUM_SQUARES; sq++) {
      const v = b[sq];
      if (v === W_MAN) score += ADV_MG[7 - ROW[sq]];
      else if (v === B_MAN) score -= ADV_MG[ROW[sq]];
    }
    return pos.side === WHITE ? score : -score;
  }

  let wMob = 0;
  let bMob = 0;
  let pst = 0;

  for (let sq = 0; sq < NUM_SQUARES; sq++) {
    const v = b[sq];
    if (v === 0) continue;
    if (v === W_MAN) {
      const adv = 7 - ROW[sq];
      pst += (ADV_MG[adv] * mg + ADV_EG[adv] * ph) >> 4;
      pst += (CENTER[sq] * 6 * mg) >> 4;
      if (EDGE[sq]) pst -= (3 * mg) >> 4;
      // apoio por trás (SO/SE): borda ou peça própria
      const s1 = NEIGH[sq * 4 + 2];
      const s2 = NEIGH[sq * 4 + 3];
      if ((s1 < 0 || b[s1] > 0) && (s2 < 0 || b[s2] > 0)) pst += 4;
      const f1 = NEIGH[sq * 4];
      const f2 = NEIGH[sq * 4 + 1];
      if (f1 >= 0 && b[f1] === 0) wMob++;
      if (f2 >= 0 && b[f2] === 0) wMob++;
    } else if (v === B_MAN) {
      const adv = ROW[sq];
      pst -= (ADV_MG[adv] * mg + ADV_EG[adv] * ph) >> 4;
      pst -= (CENTER[sq] * 6 * mg) >> 4;
      if (EDGE[sq]) pst += (3 * mg) >> 4;
      const s1 = NEIGH[sq * 4];
      const s2 = NEIGH[sq * 4 + 1];
      if ((s1 < 0 || b[s1] < 0) && (s2 < 0 || b[s2] < 0)) pst -= 4;
      const f1 = NEIGH[sq * 4 + 2];
      const f2 = NEIGH[sq * 4 + 3];
      if (f1 >= 0 && b[f1] === 0) bMob++;
      if (f2 >= 0 && b[f2] === 0) bMob++;
    } else {
      // Damas: centralização, diagonais e mobilidade de longo alcance.
      let k = CENTER[sq] * 4 + LONG_DIAG[sq] * (10 + ph) + DOUBLE_DIAG[sq] * 5;
      let mob = 0;
      for (let d = 0; d < 4; d++) {
        const ray = RAYS[sq * 4 + d];
        for (let i = 0; i < ray.length && b[ray[i]] === 0; i++) mob++;
      }
      if (v === W_KING) {
        pst += k;
        wMob += mob >> 1;
      } else {
        pst -= k;
        bMob += mob >> 1;
      }
    }
  }
  score += pst;

  // Guarda da última linha enquanto o adversário ainda não tem damas.
  if (mg > 4) {
    if (pos.bk === 0) for (const s of W_GUARD) if (b[s] === W_MAN) score += (12 * mg) >> 4;
    if (pos.wk === 0) for (const s of B_GUARD) if (b[s] === B_MAN) score -= (12 * mg) >> 4;
  }

  if (level === EVAL_POSITIONAL) {
    score += (wMob - bMob) * 2;
    return pos.side === WHITE ? score : -score;
  }

  // ---------------- Avaliação completa ----------------
  score += (wMob - bMob) * 3;
  // Bloqueio total é derrota; pouca mobilidade é perigosa.
  if (wMob === 0 && pos.wk === 0) score -= 40;
  if (bMob === 0 && pos.bk === 0) score += 40;

  // Pedras livres a caminho da promoção.
  score += runaway(b, pos);

  // Ameaças: o lado a mover não tem capturas (senão a busca continuaria);
  // se o adversário já ameaça capturar, há perigo real.
  const threat = maxCaptureCount(pos, -pos.side);
  if (threat > 0) {
    const pen = 22 + (threat - 1) * 70;
    score += pos.side === WHITE ? -pen : pen;
  }

  // Finais.
  score += endgame(pos, wMat, bMat, total, b);

  return pos.side === WHITE ? score : -score;
}

function runaway(b, pos) {
  let s = 0;
  if (pos.bk === 0) {
    for (let sq = 0; sq < 16; sq++) {
      if (b[sq] !== W_MAN) continue;
      const r = ROW[sq];
      if (coneFree(b, sq, -1, r)) s += 70 - r * 12;
    }
  }
  if (pos.wk === 0) {
    for (let sq = 16; sq < NUM_SQUARES; sq++) {
      if (b[sq] !== B_MAN) continue;
      const r = 7 - ROW[sq];
      if (coneFree(b, sq, 1, r)) s -= 70 - r * 12;
    }
  }
  return s;
}

// Verifica se nenhuma peça inimiga está no "cone" à frente da pedra.
function coneFree(b, sq, dir, dist) {
  const r0 = ROW[sq];
  const c0 = COL[sq];
  const enemy = dir < 0 ? -1 : 1;
  for (let k = 1; k <= dist + 1; k++) {
    const r = r0 + dir * k;
    if (r < 0 || r > 7) break;
    for (let c = c0 - k; c <= c0 + k; c++) {
      if (c < 0 || c > 7 || ((r + c) & 1) === 0) continue;
      const v = b[r * 4 + (c >> 1)];
      if (v !== 0 && (v > 0 ? 1 : -1) === enemy) return false;
    }
  }
  return true;
}

function endgame(pos, wMat, bMat, total, b) {
  let s = 0;
  const diff = wMat - bMat;
  // Quem está à frente quer trocar peças; quem está atrás quer evitar trocas.
  if (diff !== 0 && total < 20) s += Math.trunc((diff * (24 - total)) / 60);

  const noMen = pos.wm === 0 && pos.bm === 0;
  if (noMen && total <= 5) {
    const wk = pos.wk;
    const bk = pos.bk;
    // Finais de damas teoricamente empatados com jogo correto.
    if ((wk <= 2 && bk >= 1 && bk <= 2 && wk >= 1) || wk === bk) return -Math.trunc(diff * 0.85);
    if (wk >= 3 && bk === 1) s += lonelyKing(b, B_KING, W_KING);
    if (bk >= 3 && wk === 1) s -= lonelyKing(b, W_KING, B_KING);
  } else if (total <= 8) {
    // Damas do lado mais forte perseguem as peças adversárias.
    if (diff > 150) s += chase(b, W_KING, -1);
    else if (diff < -150) s -= chase(b, B_KING, 1);
  }
  return s;
}

// 3+ damas contra 1: ganho se o lado forte dominar a grande diagonal.
function lonelyKing(b, loneVal, strongVal) {
  let lone = -1;
  let strongOnLong = 0;
  for (let sq = 0; sq < NUM_SQUARES; sq++) {
    if (b[sq] === loneVal) lone = sq;
    else if (b[sq] === strongVal && LONG_DIAG[sq]) strongOnLong = 1;
  }
  if (lone < 0) return 0;
  if (LONG_DIAG[lone]) return -120; // dama solitária na grande diagonal segura o empate
  let s = strongOnLong ? 80 : 0;
  // Encurrala a dama solitária longe do centro.
  s -= CENTER[lone] * 15;
  return s;
}

function chase(b, kingVal, enemySign) {
  let s = 0;
  for (let sq = 0; sq < NUM_SQUARES; sq++) {
    if (b[sq] !== kingVal) continue;
    let best = 14;
    for (let t = 0; t < NUM_SQUARES; t++) {
      const v = b[t];
      if (v === 0 || (v > 0 ? 1 : -1) !== enemySign) continue;
      const d = Math.max(Math.abs(ROW[sq] - ROW[t]), Math.abs(COL[sq] - COL[t]));
      if (d < best) best = d;
    }
    s += (14 - best) * 2;
  }
  return s;
}
