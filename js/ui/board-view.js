// Renderização do tabuleiro, animações e entrada por toque/mouse.
// A visão nunca decide regras: ela só mostra o estado e repassa as ações.

import { rcToSq, ROW, COL } from '../engine/geometry.js';
import { W_KING, B_KING } from '../engine/rules.js';

const CROWN_SVG =
  '<svg class="crown" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5L3 7zm2.2 12.5h13.6V21H5.2z"/></svg>';

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export class BoardView {
  /**
   * @param {HTMLElement} el
   * @param {{ onPress(sq), onClick(sq), onDrop(fromSq, toSq) }} handlers
   */
  constructor(el, handlers) {
    this.el = el;
    this.handlers = handlers;
    this.flipped = false;
    this.squares = new Array(32);
    this.pieceEls = new Map();
    this.movable = new Set();
    this.drag = null;
    this.build();
    this.bindPointer();
  }

  build() {
    this.el.innerHTML = '';
    this.cells = [];
    for (let i = 0; i < 64; i++) {
      const cell = document.createElement('div');
      cell.className = 'sq';
      cell.setAttribute('role', 'gridcell');
      this.el.appendChild(cell);
      this.cells.push(cell);
    }
    this.layer = document.createElement('div');
    this.layer.className = 'pieces';
    this.el.appendChild(this.layer);
    this.layoutCells();
  }

  setFlipped(flipped) {
    if (this.flipped === flipped) return;
    this.flipped = flipped;
    this.layoutCells();
  }

  /** Linha/coluna na tela para uma casa do tabuleiro. */
  displayRC(sq) {
    const r = ROW[sq];
    const c = COL[sq];
    return this.flipped ? [7 - r, 7 - c] : [r, c];
  }

  layoutCells() {
    for (let i = 0; i < 64; i++) {
      const dr = i >> 3;
      const dc = i & 7;
      const r = this.flipped ? 7 - dr : dr;
      const c = this.flipped ? 7 - dc : dc;
      const cell = this.cells[i];
      const sq = rcToSq(r, c);
      cell.className = sq >= 0 ? 'sq dark' : 'sq';
      cell.innerHTML = '';
      cell.removeAttribute('data-sq');
      if (sq >= 0) {
        cell.dataset.sq = sq;
        this.squares[sq] = cell;
      }
      cell.setAttribute('aria-label', 'abcdefgh'[c] + (8 - r));
      if (dr === 7) cell.insertAdjacentHTML('beforeend', `<span class="coord file">${'abcdefgh'[c]}</span>`);
      if (dc === 0) cell.insertAdjacentHTML('beforeend', `<span class="coord rank">${8 - r}</span>`);
    }
  }

  transformFor(sq) {
    const [r, c] = this.displayRC(sq);
    return `translate(${c * 100}%, ${r * 100}%)`;
  }

  /**
   * Desenha o estado.
   * view = { board, movable:Set, must:boolean, selected, targets:Map<sq,isCap>,
   *          path:number[], threats:Set, last:{from,to}|null, hint:{from,to}|null }
   */
  render(view) {
    this.cancelDrag();
    this.movable = view.movable || new Set();
    // Casas
    for (let sq = 0; sq < 32; sq++) {
      const cell = this.squares[sq];
      const cl = cell.classList;
      cl.toggle('selected', view.selected === sq);
      cl.toggle('last', !!view.last && (view.last.from === sq || view.last.to === sq));
      const isTarget = view.targets ? view.targets.has(sq) : false;
      cl.toggle('target', isTarget);
      cl.toggle('cap', isTarget && view.targets.get(sq));
      cl.toggle('path', !!view.path && view.path.includes(sq));
      cl.toggle('hint', !!view.hint && (view.hint.from === sq || view.hint.to === sq));
    }
    // Peças
    this.layer.innerHTML = '';
    this.pieceEls.clear();
    const b = view.board;
    for (let sq = 0; sq < 32; sq++) {
      const v = b[sq];
      if (!v) continue;
      const p = document.createElement('div');
      p.className = 'piece ' + (v > 0 ? 'white' : 'black');
      if (this.movable.has(sq)) p.classList.add('movable');
      if (view.must && this.movable.has(sq) && view.selected == null) p.classList.add('must');
      if (view.selected === sq) p.classList.add('selected');
      if (view.threats && view.threats.has(sq)) p.classList.add('threat');
      p.style.transform = this.transformFor(sq);
      p.innerHTML = '<div class="disc">' + (v === W_KING || v === B_KING ? CROWN_SVG : '') + '</div>';
      this.layer.appendChild(p);
      this.pieceEls.set(sq, p);
    }
  }

  /** Anima um lance (com todos os saltos) antes de o estado ser atualizado. */
  async animateMove(move) {
    const el = this.pieceEls.get(move.from);
    if (!el || typeof el.animate !== 'function') return;
    const fast = reducedMotion();
    const steps = [move.from, ...move.path];
    const isCap = move.caps.length > 0;
    const stepMs = fast ? 1 : isCap ? 260 : 220;
    const total = stepMs * (steps.length - 1);
    el.classList.add('moving');
    el.classList.remove('selected', 'must');
    const frames = steps.map((sq, i) => ({ transform: this.transformFor(sq), offset: i / (steps.length - 1) }));
    // pequeno "salto" visual nas capturas
    const anims = [el.animate(frames, { duration: total, easing: 'ease-in-out', fill: 'forwards' })];
    const disc = el.firstElementChild;
    if (isCap && disc && !fast) {
      const lift = [];
      for (let i = 0; i < steps.length - 1; i++) {
        lift.push({ transform: 'scale(1)', offset: i / (steps.length - 1) });
        lift.push({ transform: 'scale(1.18)', offset: (i + 0.5) / (steps.length - 1) });
      }
      lift.push({ transform: 'scale(1)', offset: 1 });
      anims.push(disc.animate(lift, { duration: total, easing: 'linear' }));
    }
    move.caps.forEach((csq, i) => {
      const cel = this.pieceEls.get(csq);
      if (!cel) return;
      anims.push(
        cel.animate(
          [
            { opacity: 1, filter: 'none' },
            { opacity: 0, filter: 'blur(2px)', transform: cel.style.transform + ' scale(0.5)' },
          ],
          { duration: fast ? 1 : 260, delay: fast ? 0 : stepMs * (i + 0.6), fill: 'forwards', easing: 'ease-in' },
        ),
      );
    });
    try {
      await Promise.all(anims.map((a) => a.finished));
    } catch {
      /* animação cancelada: o estado é redesenhado de qualquer forma */
    }
  }

  // ------------------------------------------------------- toque e mouse
  squareFromPoint(x, y) {
    const rect = this.el.getBoundingClientRect();
    const dc = Math.floor(((x - rect.left) / rect.width) * 8);
    const dr = Math.floor(((y - rect.top) / rect.height) * 8);
    if (dr < 0 || dr > 7 || dc < 0 || dc > 7) return -1;
    const r = this.flipped ? 7 - dr : dr;
    const c = this.flipped ? 7 - dc : dc;
    return rcToSq(r, c);
  }

  bindPointer() {
    this.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const sq = this.squareFromPoint(e.clientX, e.clientY);
      this.downSq = sq;
      if (sq >= 0 && this.movable.has(sq)) {
        this.handlers.onPress(sq);
        const el = this.pieceEls.get(sq);
        if (el) {
          this.drag = { sq, el, x0: e.clientX, y0: e.clientY, active: false, id: e.pointerId };
          try {
            this.el.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        }
      }
      e.preventDefault();
    });

    this.el.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      if (!d.active && Math.hypot(dx, dy) > 6) {
        d.active = true;
        d.el.classList.add('dragging');
      }
      if (d.active) {
        const [r, c] = this.displayRC(d.sq);
        d.el.style.transform = `translate(calc(${c * 100}% + ${dx}px), calc(${r * 100}% + ${dy}px))`;
      }
    });

    const finish = (e) => {
      const d = this.drag;
      const sq = this.squareFromPoint(e.clientX, e.clientY);
      if (d && d.id === e.pointerId) {
        this.drag = null;
        if (d.active) {
          d.el.classList.remove('dragging');
          d.el.style.transform = this.transformFor(d.sq);
          if (sq >= 0 && sq !== d.sq) this.handlers.onDrop(d.sq, sq);
        }
        return;
      }
      if (e.type === 'pointerup' && sq >= 0 && sq === this.downSq) this.handlers.onClick(sq);
      else if (e.type === 'pointerup' && sq < 0) this.handlers.onClick(-1);
    };
    this.el.addEventListener('pointerup', finish);
    this.el.addEventListener('pointercancel', (e) => {
      if (this.drag) {
        this.drag.el.classList.remove('dragging');
        this.drag.el.style.transform = this.transformFor(this.drag.sq);
      }
      this.drag = null;
      void e;
    });
  }

  cancelDrag() {
    this.drag = null;
  }
}

