// Configuração dos níveis de dificuldade.
// Os níveis diferem em profundidade máxima, tempo, função de avaliação e
// técnicas de busca habilitadas. Nenhum nível joga aleatoriamente.

import { EVAL_BASIC, EVAL_POSITIONAL, EVAL_FULL } from './evaluate.js';

export const LEVELS = {
  facil: {
    name: 'Fácil',
    maxDepth: 2,
    timeMs: 300,
    evalLevel: EVAL_BASIC,
    useLMR: false,
    useExt: false,
    contempt: 0,
  },
  medio: {
    name: 'Médio',
    maxDepth: 4,
    timeMs: 600,
    evalLevel: EVAL_POSITIONAL,
    useLMR: false,
    useExt: false,
    contempt: 0,
  },
  dificil: {
    name: 'Difícil',
    maxDepth: 8,
    timeMs: 1200,
    evalLevel: EVAL_FULL,
    useLMR: true,
    useExt: true,
    contempt: 5,
  },
  mestre: {
    name: 'Mestre',
    maxDepth: 16,
    timeMs: 2500,
    evalLevel: EVAL_FULL,
    useLMR: true,
    useExt: true,
    contempt: 10,
    endgameBoost: true,
  },
  impossivel: {
    name: 'Impossível',
    maxDepth: 100,
    timeMs: 5000, // ajustado conforme o dispositivo (ver deviceProfile)
    evalLevel: EVAL_FULL,
    useLMR: true,
    useExt: true,
    contempt: 15,
    endgameBoost: true,
  },
};

export const LEVEL_ORDER = ['facil', 'medio', 'dificil', 'mestre', 'impossivel'];

/**
 * Ajusta tempo e tamanho da tabela de transposição aos recursos do aparelho.
 * Retorna { ttBits, impossibleTimeMs }.
 */
export function deviceProfile(nav = typeof navigator !== 'undefined' ? navigator : {}) {
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory || 4; // GB (aproximado; nem todo navegador informa)
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '');
  let ttBits = 20; // ~20 MB
  if (mem <= 2 || mobile) ttBits = 19;
  if (mem >= 8 && !mobile) ttBits = 21;
  let impossibleTimeMs = 5000;
  if (mobile || cores <= 4) impossibleTimeMs = 4000;
  if (!mobile && cores >= 8) impossibleTimeMs = 6000;
  return { ttBits, impossibleTimeMs };
}
