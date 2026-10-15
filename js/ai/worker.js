// Web Worker da IA: executa a busca fora da thread da interface.
import { Searcher } from './search.js';

let searcher = null;

function plain(m) {
  return m ? { from: m.from, to: m.to, path: m.path, capMask: m.capMask } : null;
}

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    searcher = new Searcher({ ttBits: msg.ttBits || 20 });
    self.postMessage({ type: 'ready' });
    return;
  }
  if (msg.type === 'think') {
    if (!searcher) searcher = new Searcher({ ttBits: 20 });
    try {
      const res = searcher.think(msg.position, msg.history, msg.options, (info) =>
        self.postMessage({ type: 'info', id: msg.id, info }),
      );
      self.postMessage({
        type: 'result',
        id: msg.id,
        move: plain(res.move),
        score: res.score,
        depth: res.depth,
        nodes: res.nodes,
        timeMs: res.timeMs,
        forced: !!res.forced,
      });
    } catch (err) {
      self.postMessage({ type: 'error', id: msg.id, message: String(err && err.message) });
    }
  }
};
