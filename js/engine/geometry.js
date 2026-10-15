// Geometria do tabuleiro 8x8 de damas.
// Apenas as 32 casas escuras são jogáveis e são indexadas de 0 a 31.
// Linha 0 fica no topo (lado das pretas), linha 7 embaixo (lado das brancas).
// A casa a1 (linha 7, coluna 0) é escura, como exige a regra.

export const NUM_SQUARES = 32;

// Direções diagonais: 0 = NO, 1 = NE, 2 = SO, 3 = SE (dr, dc).
export const DIRS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

export const ROW = new Uint8Array(NUM_SQUARES);
export const COL = new Uint8Array(NUM_SQUARES);

/** Casa vizinha em cada direção: NEIGH[sq * 4 + d] (ou -1). */
export const NEIGH = new Int8Array(NUM_SQUARES * 4).fill(-1);

/** Raios diagonais completos: RAYS[sq * 4 + d] = casas em ordem de distância. */
export const RAYS = new Array(NUM_SQUARES * 4);

export function rcToSq(r, c) {
  if (r < 0 || r > 7 || c < 0 || c > 7 || ((r + c) & 1) === 0) return -1;
  return r * 4 + (c >> 1);
}

export function sqToRC(sq) {
  const r = sq >> 2;
  const c = (sq & 3) * 2 + ((r & 1) === 0 ? 1 : 0);
  return [r, c];
}

for (let sq = 0; sq < NUM_SQUARES; sq++) {
  const [r, c] = sqToRC(sq);
  ROW[sq] = r;
  COL[sq] = c;
  for (let d = 0; d < 4; d++) {
    const [dr, dc] = DIRS[d];
    NEIGH[sq * 4 + d] = rcToSq(r + dr, c + dc);
    const ray = [];
    let rr = r + dr;
    let cc = c + dc;
    while (rcToSq(rr, cc) >= 0) {
      ray.push(rcToSq(rr, cc));
      rr += dr;
      cc += dc;
    }
    RAYS[sq * 4 + d] = Int8Array.from(ray);
  }
}

/** Nome algébrico da casa (a1 = canto inferior esquerdo do lado das brancas). */
export function sqName(sq) {
  return 'abcdefgh'[COL[sq]] + (8 - ROW[sq]);
}

/** Espelho por rotação de 180° (troca o ponto de vista das cores). */
export function mirror(sq) {
  return 31 - sq;
}
