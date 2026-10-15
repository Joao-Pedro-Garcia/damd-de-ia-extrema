import { Position, WHITE, BLACK, W_MAN, W_KING, B_MAN, B_KING } from '../js/engine/rules.js';
import { rcToSq, sqName } from '../js/engine/geometry.js';

/** Cria posição a partir de 8 linhas (topo = linha 8). w/W brancas, b/B pretas. */
export function fromDiagram(rows, side = WHITE) {
  const p = new Position();
  rows.forEach((line, r) => {
    [...line.replace(/\s/g, '')].forEach((ch, c) => {
      const v = { w: W_MAN, W: W_KING, b: B_MAN, B: B_KING }[ch];
      if (!v) return;
      const sq = rcToSq(r, c);
      if (sq < 0) throw new Error(`casa clara em ${r},${c}`);
      p.board[sq] = v;
    });
  });
  p.side = side;
  p.recompute();
  return p;
}

export const sq = (name) => rcToSq(8 - Number(name[1]), name.charCodeAt(0) - 97);
export const names = (moves) => moves.map((m) => [m.from, ...m.path].map(sqName).join(m.caps.length ? 'x' : '-')).sort();
export { WHITE, BLACK };
