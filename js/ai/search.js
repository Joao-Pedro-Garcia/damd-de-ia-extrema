// Motor de busca da IA.
//
// Técnicas:
//  - Negamax com poda Alfa-Beta e Principal Variation Search (PVS)
//  - Aprofundamento iterativo com limite de tempo e janelas de aspiração
//  - Tabela de transposição indexada por Zobrist (64 bits)
//  - Ordenação: lance da TT, capturas (maiores primeiro), promoções,
//    killer moves e history heuristic
//  - Quiescence: em profundidade 0 a busca continua enquanto houver
//    capturas (que são obrigatórias), evitando avaliar posições instáveis
//  - Extensão de lance forçado (única jogada legal)
//  - Late Move Reductions em lances quietos tardios
//  - Detecção de repetição e das regras de empate dentro da árvore
//  - Mais tempo e profundidade em finais com poucas peças

import {
  Position,
  generateMoves,
  makeMove,
  unmakeMove,
  isSpecialEnding,
  maxCaptureCount,
  hasQuietMove,
  QUIET_DRAW_PLIES,
  SPECIAL_ENDING_PLIES,
} from '../engine/rules.js';
import { evaluate, EVAL_FULL } from './evaluate.js';

export const MATE = 100000;
const INF = 1000000;
const MAX_PLY = 128;
const MATE_BOUND = MATE - MAX_PLY * 2;

const TT_EXACT = 1;
const TT_LOWER = 2;
const TT_UPPER = 3;

const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

class StopSearch extends Error {}

export class Searcher {
  constructor({ ttBits = 20 } = {}) {
    const size = 1 << ttBits;
    this.ttMask = size - 1;
    this.ttLo = new Int32Array(size);
    this.ttHi = new Int32Array(size);
    this.ttScore = new Int32Array(size);
    this.ttMoveFT = new Int16Array(size).fill(-1);
    this.ttMoveCap = new Int32Array(size);
    this.ttDepth = new Int8Array(size);
    this.ttFlag = new Uint8Array(size);
    this.ttAge = new Uint8Array(size);
    this.age = 0;

    this.killers = new Int16Array(MAX_PLY * 2).fill(-1);
    this.history = new Int32Array(32 * 32);
    this.hashLo = new Int32Array(1024 + MAX_PLY);
    this.hashHi = new Int32Array(1024 + MAX_PLY);
  }

  clear() {
    this.ttFlag.fill(0);
    this.history.fill(0);
    this.killers.fill(-1);
  }

  // ------------------------------------------------------------------ TT
  ttProbe(pos) {
    const i = pos.hashLo & this.ttMask;
    if (this.ttFlag[i] !== 0 && this.ttLo[i] === pos.hashLo && this.ttHi[i] === pos.hashHi) return i;
    return -1;
  }

  ttStore(pos, depth, flag, score, move, ply) {
    const i = pos.hashLo & this.ttMask;
    const sameKey = this.ttLo[i] === pos.hashLo && this.ttHi[i] === pos.hashHi;
    if (this.ttFlag[i] !== 0 && this.ttAge[i] === this.age && !sameKey && this.ttDepth[i] > depth + 2) return;
    if (score > MATE_BOUND) score += ply;
    else if (score < -MATE_BOUND) score -= ply;
    this.ttLo[i] = pos.hashLo;
    this.ttHi[i] = pos.hashHi;
    this.ttScore[i] = score;
    this.ttDepth[i] = depth > 127 ? 127 : depth;
    this.ttFlag[i] = flag;
    this.ttAge[i] = this.age;
    if (move) {
      this.ttMoveFT[i] = move.from | (move.to << 5);
      this.ttMoveCap[i] = move.capMask;
    } else if (!sameKey) {
      this.ttMoveFT[i] = -1;
    }
  }

  // --------------------------------------------------------------- empate
  drawScore() {
    // Leve "contempt": a IA prefere jogar a empatar quando a posição é igual.
    return this.pos.side === this.rootSide ? -this.contempt : this.contempt;
  }

  isRepetition(ply) {
    const pos = this.pos;
    const cur = this.histBase + ply;
    const limit = cur - pos.quiet;
    const lo = pos.hashLo;
    const hi = pos.hashHi;
    for (let i = cur - 2; i >= limit && i >= 0; i -= 2) {
      if (this.hashLo[i] === lo && this.hashHi[i] === hi) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ ordenação
  orderMoves(moves, ttIdx, ply) {
    let ttFT = -1;
    let ttCap = 0;
    if (ttIdx >= 0) {
      ttFT = this.ttMoveFT[ttIdx];
      ttCap = this.ttMoveCap[ttIdx];
    }
    const k1 = this.killers[ply * 2];
    const k2 = this.killers[ply * 2 + 1];
    const n = moves.length;
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      const ft = m.from | (m.to << 5);
      let s;
      if (ft === ttFT && m.capMask === ttCap) s = 1e9;
      else if (m.caps.length > 0) {
        let kings = 0;
        for (const v of m.capVals) if (v === 2 || v === -2) kings++;
        s = 1e8 + kings * 1000 + (m.promote ? 500 : 0);
      } else if (m.promote) s = 9e7;
      else if (ft === k1) s = 8e7;
      else if (ft === k2) s = 7e7;
      else s = this.history[ft];
      m._s = s;
    }
    moves.sort((a, b) => b._s - a._s);
  }

  // --------------------------------------------------------------- busca
  negamax(depth, alpha, beta, ply, isPV) {
    if ((++this.nodes & 1023) === 0 && now() > this.deadline) this.stopped = true;
    if (this.stopped) throw new StopSearch();
    const pos = this.pos;
    if (ply > this.selDepth) this.selDepth = ply;

    this.hashLo[this.histBase + ply] = pos.hashLo;
    this.hashHi[this.histBase + ply] = pos.hashHi;

    if (ply > 0) {
      if (pos.quiet >= QUIET_DRAW_PLIES) return this.drawScore();
      if (pos.egPlies >= SPECIAL_ENDING_PLIES && isSpecialEnding(pos)) return this.drawScore();
      if (pos.quiet >= 4 && this.isRepetition(ply)) return this.drawScore();
      // Poda por distância de vitória.
      const ma = -MATE + ply;
      const mb = MATE - ply - 1;
      if (alpha < ma) alpha = ma;
      if (beta > mb) beta = mb;
      if (alpha >= beta) return alpha;
    }

    // Quiescence: sem capturas pendentes, avalia; com capturas, continua.
    // (Verifica capturas sem gerar a lista completa de lances.)
    if (depth <= 0 || ply >= MAX_PLY - 1) {
      if (maxCaptureCount(pos, pos.side) === 0) {
        if (!hasQuietMove(pos)) return -MATE + ply; // bloqueado = derrota
        return evaluate(pos, this.evalLevel);
      }
      if (ply >= MAX_PLY - 1) return evaluate(pos, this.evalLevel);
    }

    const moves = generateMoves(pos);
    if (moves.length === 0) return -MATE + ply; // sem lances = derrota
    const isCapture = moves[0].caps.length > 0;

    const ttIdx = this.ttProbe(pos);
    if (ttIdx >= 0 && !isPV && this.ttDepth[ttIdx] >= depth) {
      let s = this.ttScore[ttIdx];
      if (s > MATE_BOUND) s -= ply;
      else if (s < -MATE_BOUND) s += ply;
      const f = this.ttFlag[ttIdx];
      if (f === TT_EXACT || (f === TT_LOWER && s >= beta) || (f === TT_UPPER && s <= alpha)) return s;
    }

    // Extensão de lance forçado (muito comum em combinações de damas).
    let ext = 0;
    if (this.useExt && moves.length === 1 && depth > 0 && ply < this.rootDepth * 2 + 8) ext = 1;

    if (moves.length > 1) this.orderMoves(moves, ttIdx, ply);

    const alphaOrig = alpha;
    let best = -INF;
    let bestMove = null;
    const k1 = this.killers[ply * 2];
    const k2 = this.killers[ply * 2 + 1];

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const newDepth = depth - 1 + ext;
      makeMove(pos, m);
      let score;
      try {
        if (i === 0) {
          score = -this.negamax(newDepth, -beta, -alpha, ply + 1, isPV);
        } else {
          let r = 0;
          if (this.useLMR && depth >= 3 && i >= 3 && !isCapture && !m.promote && ext === 0) {
            const ft = m.from | (m.to << 5);
            if (ft !== k1 && ft !== k2) r = i >= 8 && depth >= 6 ? 2 : 1;
          }
          score = -this.negamax(newDepth - r, -alpha - 1, -alpha, ply + 1, false);
          if (score > alpha && r > 0) score = -this.negamax(newDepth, -alpha - 1, -alpha, ply + 1, false);
          if (score > alpha && score < beta) score = -this.negamax(newDepth, -beta, -alpha, ply + 1, true);
        }
      } finally {
        unmakeMove(pos, m);
      }

      if (score > best) {
        best = score;
        bestMove = m;
        if (ply === 0) {
          // Só aceita como melhor lance da raiz se provou ser melhor que alfa.
          if (score > alpha) {
            this.iterBest = m;
            this.iterScore = score;
          }
        }
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            if (!isCapture) {
              const ft = m.from | (m.to << 5);
              if (ft !== this.killers[ply * 2]) {
                this.killers[ply * 2 + 1] = this.killers[ply * 2];
                this.killers[ply * 2] = ft;
              }
              this.history[ft] += depth * depth;
              if (this.history[ft] > 1e7) for (let h = 0; h < 1024; h++) this.history[h] >>= 1;
            }
            break;
          }
        }
      }
    }

    const flag = best <= alphaOrig ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
    this.ttStore(pos, depth < 0 ? 0 : depth, flag, best, bestMove, ply);
    return best;
  }

  /** Variação principal recuperada da tabela de transposição. */
  extractPV(maxLen) {
    const pos = this.pos;
    const pv = [];
    const seen = new Set();
    while (pv.length < maxLen) {
      const idx = this.ttProbe(pos);
      if (idx < 0 || this.ttMoveFT[idx] < 0) break;
      const key = pos.hashKey;
      if (seen.has(key)) break;
      seen.add(key);
      const ft = this.ttMoveFT[idx];
      const cap = this.ttMoveCap[idx];
      const m = generateMoves(pos).find((x) => (x.from | (x.to << 5)) === ft && x.capMask === cap);
      if (!m) break;
      pv.push(m);
      makeMove(pos, m);
    }
    for (let i = pv.length - 1; i >= 0; i--) unmakeMove(pos, pv[i]);
    return pv;
  }

  /**
   * Pensa sobre a posição e devolve o melhor lance encontrado.
   * @param posObj   posição serializada (Position.toObject())
   * @param history  [[hashLo, hashHi], ...] posições anteriores da partida
   *                 desde o último lance irreversível (sem a atual)
   * @param opts     { maxDepth, timeMs, evalLevel, useLMR, useExt, contempt }
   * @param onInfo   callback de progresso por profundidade
   */
  think(posObj, history = [], opts = {}, onInfo = null) {
    const start = now();
    const pos = posObj instanceof Position ? posObj.clone() : Position.fromObject(posObj);
    this.pos = pos;
    this.rootSide = pos.side;
    this.evalLevel = opts.evalLevel ?? EVAL_FULL;
    this.useLMR = opts.useLMR ?? true;
    this.useExt = opts.useExt ?? true;
    this.contempt = opts.contempt ?? 0;
    this.nodes = 0;
    this.selDepth = 0;
    this.stopped = false;
    this.age = (this.age + 1) & 255;
    this.killers.fill(-1);
    for (let h = 0; h < 1024; h++) this.history[h] >>= 2;

    const hist = history.slice(-1000);
    this.histBase = hist.length;
    for (let i = 0; i < hist.length; i++) {
      this.hashLo[i] = hist[i][0];
      this.hashHi[i] = hist[i][1];
    }

    const rootMoves = generateMoves(pos);
    if (rootMoves.length === 0) return { move: null, score: -MATE, depth: 0, nodes: 0, timeMs: 0, pv: [] };
    if (rootMoves.length === 1) {
      return { move: rootMoves[0], score: 0, depth: 0, nodes: 1, timeMs: 0, pv: [rootMoves[0]], forced: true };
    }

    const maxDepth = Math.min(opts.maxDepth ?? 64, MAX_PLY - 10);
    let timeMs = opts.timeMs ?? 1000;
    const pieces = pos.wm + pos.wk + pos.bm + pos.bk;
    if (opts.endgameBoost && pieces <= 8) timeMs *= 1.4; // busca de finais mais cuidadosa
    this.deadline = start + timeMs;
    let softLimit = start + timeMs * 0.5;

    let bestMove = rootMoves[0];
    let bestScore = 0;
    let completedDepth = 0;
    let pv = [bestMove];

    for (let depth = 1; depth <= maxDepth; depth++) {
      this.rootDepth = depth;
      this.iterBest = null;
      let alpha = -INF;
      let beta = INF;
      let delta = 35;
      if (depth >= 4 && Math.abs(bestScore) < MATE_BOUND) {
        alpha = bestScore - delta;
        beta = bestScore + delta;
      }
      let score;
      let aborted = false;
      try {
        for (;;) {
          score = this.negamax(depth, alpha, beta, 0, true);
          if (score <= alpha) {
            alpha = Math.max(-INF, alpha - delta * 4);
            if (delta > 300) alpha = -INF;
            delta *= 4;
            this.iterBest = null;
            continue;
          }
          if (score >= beta) {
            beta = Math.min(INF, beta + delta * 4);
            if (delta > 300) beta = INF;
            delta *= 4;
            continue;
          }
          break;
        }
      } catch (e) {
        if (!(e instanceof StopSearch)) throw e;
        aborted = true;
      }

      if (aborted) {
        if (this.iterBest) {
          bestMove = this.iterBest;
          bestScore = this.iterScore;
        }
        break;
      }

      const prevScore = bestScore;
      if (this.iterBest) bestMove = this.iterBest;
      bestScore = score;
      completedDepth = depth;
      pv = this.extractPV(depth + 4);
      if (!pv.length || !(pv[0].from === bestMove.from && pv[0].to === bestMove.to && pv[0].capMask === bestMove.capMask)) {
        pv = [bestMove];
      }

      const elapsed = now() - start;
      if (onInfo) {
        onInfo({
          depth,
          selDepth: this.selDepth,
          score: bestScore,
          nodes: this.nodes,
          timeMs: elapsed,
          nps: Math.round((this.nodes * 1000) / Math.max(1, elapsed)),
          pv: pv.map((m) => ({ from: m.from, to: m.to, path: m.path, capMask: m.capMask })),
        });
      }

      // Vitória/derrota forçada encontrada dentro do horizonte: não há o que melhorar.
      if (Math.abs(bestScore) > MATE_BOUND && depth >= MATE - Math.abs(bestScore) + 2) break;
      // Se a avaliação caiu muito, usa mais tempo para achar uma defesa.
      if (depth >= 5 && bestScore < prevScore - 40) softLimit = Math.max(softLimit, start + timeMs * 0.8);
      if (now() > softLimit) break;
    }

    return {
      move: bestMove,
      score: bestScore,
      depth: completedDepth,
      selDepth: this.selDepth,
      nodes: this.nodes,
      timeMs: now() - start,
      pv,
    };
  }
}
