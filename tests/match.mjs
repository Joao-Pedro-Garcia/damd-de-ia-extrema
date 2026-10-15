// Partidas IA x IA para comparar níveis.
// Uso: node tests/match.mjs [nivelA] [nivelB] [partidas] [fatorDeTempo]
import { Position, generateMoves, makeMove, gameStatus, sameMove, WHITE } from '../js/engine/rules.js';
import { Searcher } from '../js/ai/search.js';
import { LEVELS } from '../js/ai/levels.js';

export function playGame(levelW, levelB, { timeScale = 1, maxPlies = 300, openingPlies = 0, seed = 1 } = {}) {
  const pos = Position.initial();
  const engines = { [WHITE]: new Searcher({ ttBits: 18 }), [-WHITE]: new Searcher({ ttBits: 18 }) };
  const levels = { [WHITE]: levelW, [-WHITE]: levelB };
  const keys = [pos.hashKey];
  const hashes = [];
  let rng = seed;
  for (let ply = 0; ply < maxPlies; ply++) {
    const st = gameStatus(pos, keys);
    if (st.over) return { ...st, plies: ply };
    const legal = generateMoves(pos);
    let move;
    if (ply < openingPlies) {
      // abertura variada (somente para diversificar os testes)
      rng = (rng * 1103515245 + 12345) & 0x7fffffff;
      move = legal[rng % legal.length];
    } else {
      const lv = LEVELS[levels[pos.side]];
      const res = engines[pos.side].think(pos, hashes.slice(-pos.quiet), { ...lv, timeMs: lv.timeMs * timeScale });
      move = legal.find((m) => sameMove(m, res.move));
      if (!move) throw new Error('IA devolveu lance ilegal');
    }
    hashes.push([pos.hashLo, pos.hashHi]);
    makeMove(pos, move);
    keys.push(pos.hashKey);
  }
  return { over: true, winner: 0, reason: 'limite', plies: maxPlies };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [a = 'impossivel', b = 'facil', n = '4', ts = '0.3'] = process.argv.slice(2);
  const score = { [a]: 0, [b]: 0, empate: 0 };
  for (let g = 0; g < Number(n); g++) {
    const aWhite = g % 2 === 0;
    const r = playGame(aWhite ? a : b, aWhite ? b : a, { timeScale: Number(ts), openingPlies: 2, seed: 7 + (g >> 1) * 31 });
    const winner = r.winner === 0 ? 'empate' : (r.winner === WHITE) === aWhite ? a : b;
    score[winner]++;
    console.log(`partida ${g + 1}: ${aWhite ? a : b} (brancas) x ${aWhite ? b : a} → ${winner} (${r.reason}, ${r.plies} meio-lances)`);
  }
  console.log(score);
}
