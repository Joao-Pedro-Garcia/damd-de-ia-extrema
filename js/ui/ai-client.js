// Comunicação com a IA: Web Worker (padrão) ou, se indisponível,
// execução na thread principal com tempo reduzido.

export class AIClient {
  constructor(ttBits) {
    this.ttBits = ttBits;
    this.seq = 0;
    this.pending = null;
    this.worker = null;
    this.localSearcher = null;
    this.spawn();
  }

  spawn() {
    try {
      this.worker = new Worker(new URL('../ai/worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this.onMessage(e.data);
      this.worker.onerror = (e) => {
        e.preventDefault?.();
        console.warn('Web Worker indisponível; usando a thread principal.', e.message);
        this.worker = null;
        if (this.pending) this.runLocal(this.pending);
      };
      this.worker.postMessage({ type: 'init', ttBits: this.ttBits });
    } catch (err) {
      console.warn('Web Worker indisponível; usando a thread principal.', err);
      this.worker = null;
    }
  }

  /** Retorna uma Promise com o resultado, ou null se a busca for cancelada. */
  think(position, history, options, onInfo) {
    this.cancel(false);
    return new Promise((resolve) => {
      const job = { id: ++this.seq, resolve, onInfo, position, history, options };
      this.pending = job;
      if (this.worker) {
        this.worker.postMessage({ type: 'think', id: job.id, position, history, options });
      } else {
        this.runLocal(job);
      }
    });
  }

  onMessage(msg) {
    const job = this.pending;
    if (!job || msg.id !== job.id) return;
    if (msg.type === 'info') {
      job.onInfo?.(msg.info);
    } else if (msg.type === 'result') {
      this.pending = null;
      job.resolve(msg);
    } else if (msg.type === 'error') {
      console.error('Erro na IA:', msg.message);
      this.pending = null;
      job.resolve({ move: null, error: msg.message });
    }
  }

  async runLocal(job) {
    if (!this.localSearcher) {
      const { Searcher } = await import('../ai/search.js');
      this.localSearcher = new Searcher({ ttBits: 18 });
    }
    // Deixa a interface desenhar "IA pensando" antes de bloquear.
    await new Promise((r) => setTimeout(r, 60));
    if (this.pending !== job) return;
    const opts = { ...job.options, timeMs: Math.min(job.options.timeMs, 1500) };
    const res = this.localSearcher.think(job.position, job.history, opts, job.onInfo);
    if (this.pending !== job) return;
    this.pending = null;
    const m = res.move;
    job.resolve({
      move: m && { from: m.from, to: m.to, path: m.path, capMask: m.capMask },
      score: res.score,
      depth: res.depth,
      nodes: res.nodes,
      timeMs: res.timeMs,
      forced: !!res.forced,
    });
  }

  /** Cancela a busca atual. Reinicia o worker para interromper o cálculo. */
  cancel(restart = true) {
    const job = this.pending;
    if (!job) return;
    this.pending = null;
    job.resolve(null);
    if (restart && this.worker) {
      this.worker.terminate();
      this.spawn();
    }
  }
}
