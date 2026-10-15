// Controlador do jogo: liga regras, IA e interface.

import {
  Position,
  WHITE,
  BLACK,
  generateMoves,
  makeMove,
  gameStatus,
  moveToString,
  sameMove,
} from '../engine/rules.js';
import { LEVELS, deviceProfile } from '../ai/levels.js';
import { MATE } from '../ai/search.js';
import { BoardView } from './board-view.js';
import { Sound } from './sound.js';
import { AIClient } from './ai-client.js';
import { loadPrefs, savePrefs, loadStats, saveStats } from './storage.js';

const $ = (id) => document.getElementById(id);

const REASONS = {
  'sem-pecas': 'Todas as peças foram capturadas.',
  bloqueado: 'Não restaram movimentos possíveis.',
  'vinte-lances': '20 lances seguidos só de damas, sem capturas.',
  'final-especial': 'Final de poucas damas sem progresso em 5 lances de cada lado.',
  repeticao: 'A mesma posição se repetiu três vezes.',
};

const MIN_AI_DELAY = 450; // ms: dá tempo de ver o lance do jogador

class Game {
  constructor() {
    this.prefs = loadPrefs();
    if (!LEVELS[this.prefs.level]) this.prefs.level = 'impossivel';
    this.stats = loadStats();
    this.profile = deviceProfile();
    this.sound = new Sound(this.prefs.sound);
    this.ai = new AIClient(this.profile.ttBits);
    this.view = new BoardView($('board'), {
      onPress: (sq) => this.onPress(sq),
      onClick: (sq) => this.onClick(sq),
      onDrop: (from, to) => this.onDrop(from, to),
    });
    this.aiToken = 0;
    this.busy = false;
    this.bindControls();
    this.applyPrefsToControls();
    this.newGame();
    setInterval(() => this.tickClock(), 250);
  }

  // ================================================================ partida
  newGame() {
    this.ai.cancel();
    this.aiToken++;
    this.gameId = (this.gameId || 0) + 1;
    this.thinking = false;
    this.pos = Position.initial();
    this.playerSide = Number(this.prefs.color) === BLACK ? BLACK : WHITE;
    this.level = this.prefs.level;
    this.trainingUsed = !!this.prefs.training;
    this.snapshots = [];
    this.moves = []; // { text, side, capture }
    this.keys = [this.pos.hashKey]; // repetição (inclui a atual)
    this.hashes = []; // [lo, hi] das posições anteriores (para a IA)
    this.lastMove = null;
    this.hint = null;
    this.over = false;
    this.result = null;
    this.busy = false;
    this.clocks = { [WHITE]: 0, [BLACK]: 0 };
    this.turnStart = performance.now();
    this.lastInfo = null;
    $('ai-info').textContent = 'A IA ainda não jogou.';
    this.view.setFlipped(this.playerSide === BLACK);
    this.resetSelection();
    this.refresh();
    if (this.pos.side !== this.playerSide) this.aiTurn();
  }

  get playerTurn() {
    return !this.over && !this.busy && this.pos.side === this.playerSide;
  }

  resetSelection() {
    this.selected = null;
    this.prefix = [];
    this.legal = this.over ? [] : generateMoves(this.pos);
  }

  // ============================================================ entrada
  candidates() {
    if (this.selected == null) return [];
    const k = this.prefix.length;
    return this.legal.filter((m) => {
      if (m.from !== this.selected) return false;
      for (let i = 0; i < k; i++) if (m.path[i] !== this.prefix[i]) return false;
      return m.path.length > k;
    });
  }

  onPress(sq) {
    if (!this.playerTurn) return;
    // Uma dama pode terminar uma captura circular na própria origem.
    if (this.selected === sq && this.targetMap().has(sq)) return this.chooseTarget(sq);
    if (this.legal.some((m) => m.from === sq)) {
      if (this.selected !== sq) {
        this.selected = sq;
        this.prefix = [];
        this.hint = null;
        this.sound.select();
        this.refresh();
      }
    }
  }

  onClick(sq) {
    if (!this.playerTurn) return;
    if (sq >= 0 && this.selected != null && this.targetMap().has(sq)) return this.chooseTarget(sq);
    if (sq >= 0 && this.selected != null && this.candidates().some((m) => m.to === sq)) return this.chooseTarget(sq);
    if (sq >= 0 && this.legal.some((m) => m.from === sq)) return; // já tratado em onPress
    if (this.selected != null) {
      if (sq >= 0 && this.pos.board[sq] !== 0 && this.pos.board[sq] > 0 === (this.playerSide > 0)) {
        this.flashStatus(this.legal[0]?.caps.length ? 'Captura obrigatória com outra peça!' : 'Essa peça não pode se mover.', 'warn');
        this.sound.illegal();
      }
      this.selected = null;
      this.prefix = [];
      this.refresh();
    } else if (sq >= 0 && this.pos.board[sq] !== 0 && this.pos.board[sq] > 0 === (this.playerSide > 0)) {
      this.flashStatus(this.legal[0]?.caps.length ? 'Captura obrigatória com outra peça!' : 'Essa peça não pode se mover.', 'warn');
      this.sound.illegal();
    }
  }

  onDrop(from, to) {
    if (!this.playerTurn) return;
    if (this.selected !== from) {
      this.selected = from;
      this.prefix = [];
    }
    if (this.targetMap().has(to) || this.candidates().some((m) => m.to === to)) this.chooseTarget(to);
    else {
      this.sound.illegal();
      this.refresh();
    }
  }

  /** Próximas casas possíveis da peça selecionada: Map<sq, éCaptura>. */
  targetMap() {
    const map = new Map();
    const k = this.prefix.length;
    for (const m of this.candidates()) map.set(m.path[k], m.caps.length > 0);
    return map;
  }

  chooseTarget(sq) {
    const cands = this.candidates();
    // Atalho: clicar direto no destino final quando ele é único.
    const endsHere = cands.filter((m) => m.to === sq);
    if (endsHere.length === 1) return this.playerMove(endsHere[0]);
    const k = this.prefix.length;
    const next = cands.filter((m) => m.path[k] === sq);
    if (next.length === 0) {
      if (endsHere.length > 1) this.flashStatus('Mais de um caminho termina aqui: indique os saltos um a um.', 'warn');
      return;
    }
    // Com a lei da maioria todas as capturas têm o mesmo tamanho:
    // se este salto completa uma sequência, o lance está definido.
    const done = next.find((m) => m.path.length === k + 1);
    if (done) return this.playerMove(done);
    this.prefix = [...this.prefix, sq];
    this.sound.select();
    this.refresh();
  }

  async playerMove(move) {
    this.busy = true;
    this.hint = null;
    this.selected = null;
    this.prefix = [];
    if (!(await this.performMove(move))) return;
    this.busy = false;
    this.afterMove();
  }

  // ========================================================= execução
  /** Anima e aplica um lance. Retorna false se a partida mudou no meio. */
  async performMove(move) {
    const gameId = this.gameId;
    this.snapshots.push({
      pos: this.pos.toObject(),
      keys: this.keys.length,
      hashes: this.hashes.length,
      moves: this.moves.length,
      lastMove: this.lastMove,
      clocks: { ...this.clocks },
    });
    this.addClockTime();
    // A animação acontece sobre o estado ANTIGO; só depois o estado muda.
    this.refresh(); // busy = true: tabuleiro travado durante a animação
    if (move.caps.length) this.sound.capture(move.caps.length);
    else this.sound.move();
    await this.view.animateMove(move);
    if (gameId !== this.gameId) return false;
    this.hashes.push([this.pos.hashLo, this.pos.hashHi]);
    const side = this.pos.side;
    const text = moveToString(move);
    makeMove(this.pos, move);
    this.keys.push(this.pos.hashKey);
    this.moves.push({ text, side, capture: move.caps.length > 0 });
    this.lastMove = { from: move.from, to: move.to };
    if (move.promote) this.sound.promote();
    this.turnStart = performance.now();
    this.resetSelection();
    return true;
  }

  afterMove() {
    const st = gameStatus(this.pos, this.keys);
    if (st.over) return this.finish(st);
    this.refresh();
    if (this.pos.side !== this.playerSide) this.aiTurn();
  }

  async aiTurn() {
    const token = ++this.aiToken;
    this.thinking = true;
    this.refresh();
    const t0 = performance.now();
    const level = LEVELS[this.level];
    const options = { ...level };
    if (this.level === 'impossivel') options.timeMs = this.profile.impossibleTimeMs;
    const res = await this.ai.think(
      this.pos.toObject(),
      this.hashes.slice(this.hashes.length - this.pos.quiet),
      options,
      (info) => {
        if (token === this.aiToken) this.showInfo(info, true);
      },
    );
    if (token !== this.aiToken || !res) return; // cancelada (desfazer / nova partida)
    const wait = MIN_AI_DELAY - (performance.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (token !== this.aiToken) return;

    // Garante que o lance da IA é legal nesta posição.
    let move = res.move && this.legal.find((m) => sameMove(m, res.move));
    if (!move) {
      console.warn('IA não devolveu um lance válido; usando o primeiro lance legal.', res);
      move = this.legal[0];
    }
    this.thinking = false;
    this.busy = true;
    if (res.depth != null) {
      this.lastInfo = res;
      this.showInfo(res, false);
    }
    if (!(await this.performMove(move))) return;
    this.busy = false;
    if (token !== this.aiToken) return;
    this.afterMove();
  }

  finish(st) {
    this.over = true;
    this.thinking = false;
    this.result = st;
    this.addClockTime();
    this.resetSelection();
    this.refresh();
    let outcome;
    if (st.winner === 0) outcome = 'd';
    else outcome = st.winner === this.playerSide ? 'w' : 'l';
    const counted = !this.trainingUsed;
    if (counted) {
      const s = (this.stats[this.level] ||= { w: 0, l: 0, d: 0 });
      s[outcome]++;
      saveStats(this.stats);
      this.renderStats();
    }
    const titles = { w: 'Você venceu!', l: 'A IA venceu', d: 'Empate' };
    const icons = { w: '🏆', l: '🤖', d: '🤝' };
    if (outcome === 'w') this.sound.win();
    else if (outcome === 'l') this.sound.lose();
    else this.sound.draw();
    const extra = counted ? '' : ' (Partida de treino: não conta nas estatísticas.)';
    setTimeout(() => {
      this.modal({
        icon: icons[outcome],
        title: titles[outcome],
        text: (REASONS[st.reason] || '') + extra,
        buttons: [
          { label: 'Ver tabuleiro', value: false },
          { label: 'Nova partida', value: true, primary: true },
        ],
      }).then((again) => {
        if (again) this.newGame();
      });
    }, 500);
  }

  undo() {
    if (!this.prefs.training || this.snapshots.length === 0 || this.busy) return;
    this.ai.cancel();
    this.aiToken++;
    this.gameId++;
    this.thinking = false;
    this.busy = false;
    // Volta até ser a vez do jogador, desfazendo pelo menos um lance dele.
    let snap;
    do {
      snap = this.snapshots.pop();
    } while (this.snapshots.length && snap.pos.side !== this.playerSide);
    // Se só havia o lance inicial da IA, volta ao início e ela joga de novo.
    this.pos = Position.fromObject(snap.pos);
    this.keys.length = snap.keys;
    this.hashes.length = snap.hashes;
    this.moves.length = snap.moves;
    this.lastMove = snap.lastMove;
    this.clocks = snap.clocks;
    this.turnStart = performance.now();
    this.over = false;
    this.result = null;
    this.hint = null;
    this.trainingUsed = true;
    this.resetSelection();
    this.refresh();
    if (this.pos.side !== this.playerSide) this.aiTurn();
  }

  async showHint() {
    if (!this.prefs.training || !this.playerTurn) return;
    const token = this.aiToken;
    this.trainingUsed = true;
    this.busy = true;
    this.flashStatus('Calculando dica…');
    const res = await this.ai.think(
      this.pos.toObject(),
      this.hashes.slice(this.hashes.length - this.pos.quiet),
      { ...LEVELS.mestre, timeMs: 1500 },
      null,
    );
    this.busy = false;
    if (token !== this.aiToken || !res || !res.move) return this.refresh();
    this.hint = { from: res.move.from, to: res.move.to };
    this.selected = res.move.from;
    this.prefix = [];
    this.refresh();
    this.flashStatus('Dica: ' + moveToString(this.legal.find((m) => sameMove(m, res.move)) || this.legal[0]), 'good');
  }

  // ============================================================ relógio
  addClockTime() {
    const t = performance.now();
    if (!this.over) this.clocks[this.pos.side] += t - this.turnStart;
    this.turnStart = t;
  }

  tickClock() {
    if (!this.prefs.clock) return;
    const live = { ...this.clocks };
    if (!this.over) live[this.pos.side] += performance.now() - this.turnStart;
    const fmt = (ms) => {
      const s = Math.floor(ms / 1000);
      return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    };
    $('clock-bottom').textContent = fmt(live[this.playerSide]);
    $('clock-top').textContent = fmt(live[-this.playerSide]);
  }

  // ============================================================ desenho
  renderBoard({ lockInput = false } = {}) {
    const canPlay = !lockInput && this.playerTurn;
    const movable = new Set();
    if (canPlay) for (const m of this.legal) movable.add(m.from);
    const cands = canPlay ? this.candidates() : [];
    const targets = canPlay ? this.targetMap() : new Map();
    // Atalhos de destino final (útil em capturas múltiplas)
    for (const m of cands) if (!targets.has(m.to)) targets.set(m.to, m.caps.length > 0);
    const threats = new Set();
    for (const m of cands) for (const c of m.caps) threats.add(c);
    this.view.render({
      board: this.pos.board,
      movable,
      must: canPlay && this.legal.length > 0 && this.legal[0].caps.length > 0,
      selected: canPlay ? this.selected : null,
      targets,
      path: this.prefix,
      threats,
      last: this.lastMove,
      hint: this.hint,
    });
  }

  refresh() {
    this.renderBoard();
    this.renderPlayers();
    this.renderStatus();
    this.renderHistory();
    this.renderStats();
    const training = !!this.prefs.training;
    $('btn-undo').hidden = !training;
    $('btn-hint').hidden = !training;
    $('btn-undo').disabled = this.snapshots.length === 0 || this.busy;
    $('btn-hint').disabled = !this.playerTurn;
  }

  renderPlayers() {
    const ai = -this.playerSide;
    $('ai-name').textContent = 'IA · ' + LEVELS[this.level].name;
    $('thinking').hidden = !this.thinking;
    const counts = (side) => {
      const men = side === WHITE ? this.pos.wm : this.pos.bm;
      const kings = side === WHITE ? this.pos.wk : this.pos.bk;
      const cls = side === WHITE ? 'white' : 'black';
      return (
        `<span class="chip" title="Pedras"><i class="mini ${cls}"></i>${men}</span>` +
        `<span class="chip" title="Damas"><i class="mini ${cls} king"></i>${kings}</span>` +
        `<span class="chip" title="Peças capturadas pelo adversário">−${12 - men - kings}</span>`
      );
    };
    $('count-top').innerHTML = counts(ai);
    $('count-bottom').innerHTML = counts(this.playerSide);
    const active = this.over ? 0 : this.pos.side;
    $('bar-top').classList.toggle('active', active === ai);
    $('bar-bottom').classList.toggle('active', active === this.playerSide);
    $('clock-top').hidden = !this.prefs.clock;
    $('clock-bottom').hidden = !this.prefs.clock;
    this.tickClock();
  }

  renderStatus() {
    if (this.statusTimer) return; // mensagem temporária em exibição
    const el = $('status');
    el.className = 'status';
    if (this.over) {
      const w = this.result.winner;
      el.textContent = w === 0 ? 'Empate' : w === this.playerSide ? 'Você venceu!' : 'A IA venceu';
      el.classList.add(w === this.playerSide ? 'good' : w === 0 ? 'x' : 'warn');
      return;
    }
    if (this.pos.side !== this.playerSide) {
      el.textContent = 'IA pensando…';
      return;
    }
    const cap = this.legal.length && this.legal[0].caps.length;
    if (cap) {
      el.textContent = cap > 1 ? `Captura obrigatória: ${cap} peças (lei da maioria)` : 'Captura obrigatória!';
      el.classList.add('warn');
      if (this.prefix.length) el.textContent += ' — continue os saltos';
    } else {
      el.textContent = 'Sua vez';
    }
  }

  flashStatus(text, cls = '') {
    const el = $('status');
    el.textContent = text;
    el.className = 'status ' + cls;
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      this.renderStatus();
    }, 2200);
  }

  renderHistory() {
    const ol = $('history');
    if (!this.moves.length) {
      ol.innerHTML = '<li class="empty">Nenhum lance ainda.</li>';
      return;
    }
    // A primeira coluna é sempre das brancas.
    let html = '';
    const last = this.moves.length - 1;
    for (let i = 0; i < this.moves.length; i += 2) {
      const a = this.moves[i];
      const b = this.moves[i + 1];
      const cell = (m, idx) =>
        m ? `<span class="mv${m.capture ? ' cap' : ''}${idx === last ? ' last' : ''}">${m.text}</span>` : '<span></span>';
      html += `<li><span class="num">${i / 2 + 1}.</span>${cell(a, i)}${cell(b, i + 1)}</li>`;
    }
    ol.innerHTML = html;
    ol.scrollTop = ol.scrollHeight;
  }

  renderStats() {
    const s = this.stats[this.prefs.level] || { w: 0, l: 0, d: 0 };
    $('stats-level').textContent = '· ' + LEVELS[this.prefs.level].name;
    $('stats').innerHTML =
      `<div class="stat w"><b>${s.w}</b><span>Vitórias</span></div>` +
      `<div class="stat d"><b>${s.d}</b><span>Empates</span></div>` +
      `<div class="stat l"><b>${s.l}</b><span>Derrotas</span></div>`;
  }

  showInfo(info, live) {
    const parts = [];
    if (info.forced) {
      $('ai-info').innerHTML = 'Lance forçado (única jogada legal).';
      return;
    }
    parts.push(`Profundidade <b>${info.depth}</b>${info.selDepth ? ` (seletiva ${info.selDepth})` : ''}`);
    parts.push(`<b>${formatNodes(info.nodes)}</b> posições`);
    if (info.timeMs != null) parts.push(`${(info.timeMs / 1000).toFixed(1)} s`);
    let text = parts.join(' · ');
    if (this.prefs.training && info.score != null) {
      // Avaliação do ponto de vista do jogador.
      const s = -info.score;
      let ev;
      if (Math.abs(s) > MATE - 500) ev = s > 0 ? 'vitória forçada sua' : 'vitória forçada da IA';
      else ev = (s > 0 ? '+' : '') + (s / 100).toFixed(2) + ' pedras para você';
      text += `<br>Avaliação: <b>${ev}</b>`;
    }
    if (live) text = 'Pensando… ' + text;
    $('ai-info').innerHTML = text;
  }

  // =========================================================== controles
  bindControls() {
    $('btn-new').addEventListener('click', () => this.confirmNewGame());
    $('btn-undo').addEventListener('click', () => this.undo());
    $('btn-hint').addEventListener('click', () => this.showHint());
    $('btn-sound').addEventListener('click', () => this.setSound(!this.prefs.sound));
    $('chk-sound').addEventListener('change', (e) => this.setSound(e.target.checked));
    $('btn-menu').addEventListener('click', () => {
      $('panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('chk-clock').addEventListener('change', (e) => {
      this.prefs.clock = e.target.checked;
      savePrefs(this.prefs);
      this.refresh();
    });
    $('chk-training').addEventListener('change', (e) => {
      this.prefs.training = e.target.checked;
      if (this.prefs.training && this.moves.length && !this.over) this.trainingUsed = true;
      if (!this.prefs.training) this.hint = null;
      savePrefs(this.prefs);
      if (this.lastInfo) this.showInfo(this.lastInfo, false);
      this.refresh();
    });
    $('sel-level').addEventListener('change', (e) => this.changeSetting('level', e.target.value, e.target));
    $('sel-color').addEventListener('change', (e) => this.changeSetting('color', Number(e.target.value), e.target));
    $('btn-reset-stats').addEventListener('click', async () => {
      const ok = await this.modal({
        title: 'Zerar estatísticas?',
        text: 'Vitórias, empates e derrotas de todos os níveis serão apagados.',
        buttons: [
          { label: 'Cancelar', value: false },
          { label: 'Zerar', value: true, danger: true },
        ],
      });
      if (ok) {
        this.stats = {};
        saveStats(this.stats);
        this.renderStats();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.selected != null && $('modal').hidden) {
        this.selected = null;
        this.prefix = [];
        this.refresh();
      }
    });
  }

  applyPrefsToControls() {
    $('sel-level').value = this.prefs.level;
    $('sel-color').value = String(this.prefs.color);
    $('chk-training').checked = !!this.prefs.training;
    $('chk-clock').checked = !!this.prefs.clock;
    $('chk-sound').checked = !!this.prefs.sound;
    $('btn-sound').setAttribute('aria-pressed', String(!!this.prefs.sound));
  }

  setSound(on) {
    this.prefs.sound = on;
    this.sound.enabled = on;
    savePrefs(this.prefs);
    this.applyPrefsToControls();
    if (on) this.sound.select();
  }

  inProgress() {
    return !this.over && this.moves.length > 0;
  }

  async changeSetting(key, value, control) {
    if (this.inProgress()) {
      const ok = await this.modal({
        title: 'Iniciar nova partida?',
        text: 'Para mudar ' + (key === 'level' ? 'a dificuldade' : 'a cor das peças') + ', a partida atual será encerrada.',
        buttons: [
          { label: 'Cancelar', value: false },
          { label: 'Nova partida', value: true, primary: true },
        ],
      });
      if (!ok) {
        control.value = String(this.prefs[key]);
        return;
      }
    }
    this.prefs[key] = value;
    savePrefs(this.prefs);
    this.newGame();
  }

  async confirmNewGame() {
    if (this.inProgress()) {
      const ok = await this.modal({
        title: 'Reiniciar a partida?',
        text: 'A partida atual será abandonada.',
        buttons: [
          { label: 'Cancelar', value: false },
          { label: 'Reiniciar', value: true, primary: true },
        ],
      });
      if (!ok) return;
    }
    this.newGame();
  }

  modal({ icon = '', title, text, buttons }) {
    const box = $('modal');
    $('modal-icon').textContent = icon;
    $('modal-title').textContent = title;
    $('modal-text').textContent = text;
    const actions = $('modal-actions');
    actions.innerHTML = '';
    return new Promise((resolve) => {
      const close = (v) => {
        box.hidden = true;
        document.removeEventListener('keydown', onKey);
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') close(false);
      };
      for (const b of buttons) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
        btn.textContent = b.label;
        btn.addEventListener('click', () => close(b.value));
        actions.appendChild(btn);
      }
      box.onclick = (e) => {
        if (e.target === box) close(false);
      };
      document.addEventListener('keydown', onKey);
      box.hidden = false;
      actions.lastElementChild?.focus();
    });
  }
}

function formatNodes(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' mi';
  if (n >= 1e3) return Math.round(n / 1e3) + ' mil';
  return String(n);
}

window.game = new Game();
