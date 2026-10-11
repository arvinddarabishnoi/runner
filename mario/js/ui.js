// DOM layer: menu, HUD, overlays and toasts. Reads state, never owns gameplay.

const $ = (sel) => document.querySelector(sel);

export class UI {
  constructor() {
    this.el = {
      hud: $('#hud'),
      lives: $('#hud-lives'),
      coins: $('#hud-coins'),
      score: $('#hud-score'),
      time: $('#hud-time'),
      level: $('#hud-level'),
      menu: $('#menu'),
      name: $('#player-name'),
      levelList: $('#level-list'),
      board: $('#leaderboard'),
      boardTitle: $('#board-title'),
      playBtn: $('#play-btn'),
      pause: $('#pause'),
      clear: $('#clear'),
      clearTitle: $('#clear-title'),
      clearStats: $('#clear-stats'),
      lifeLost: $('#life-lost'),
      gameover: $('#gameover'),
      gameoverStats: $('#gameover-stats'),
      toast: $('#toast'),
      touch: $('#touch'),
      mute: $('#mute-btn'),
    };
    this.toastTimer = null;
  }

  // ---- menu -------------------------------------------------------------
  showMenu() {
    this.hideAll();
    this.el.menu.hidden = false;
    this.el.hud.hidden = true;
    this.el.touch.hidden = true;
  }

  renderLevels(levels, unlocked, selectedId, onPick) {
    const list = this.el.levelList;
    list.replaceChildren();
    levels.forEach((lvl, i) => {
      const locked = i + 1 > unlocked;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'level-card' + (locked ? ' locked' : '') + (lvl.id === selectedId ? ' selected' : '');
      btn.disabled = locked;
      btn.dataset.id = lvl.id;
      btn.innerHTML = `<span class="lc-num">${i + 1}</span><span class="lc-name"></span>
        <span class="lc-meta"></span>`;
      btn.querySelector('.lc-name').textContent = lvl.name;
      btn.querySelector('.lc-meta').textContent = locked ? 'Locked — clear the previous level' : `Time ${lvl.timeLimit}s`;
      btn.addEventListener('click', () => onPick(lvl.id));
      list.append(btn);
    });
  }

  renderLeaderboard(levelName, rows, highlightName) {
    this.el.boardTitle.textContent = `Leaderboard — ${levelName}`;
    const board = this.el.board;
    board.replaceChildren();
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No runs yet. Be the first!';
      board.append(li);
      return;
    }
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      if (r.name === highlightName) li.classList.add('me');
      const rank = document.createElement('span'); rank.textContent = `${i + 1}.`;
      const name = document.createElement('span'); name.className = 'bn'; name.textContent = r.name;
      const score = document.createElement('span'); score.className = 'bs'; score.textContent = r.score.toLocaleString();
      li.append(rank, name, score);
      board.append(li);
    });
  }

  setPlayBusy(busy, label = 'Play') {
    this.el.playBtn.disabled = busy;
    this.el.playBtn.textContent = busy ? 'Loading…' : label;
  }

  // ---- HUD ----------------------------------------------------------------
  showHud(levelName, touchEnabled) {
    this.el.hud.hidden = false;
    this.el.level.textContent = levelName;
    this.el.touch.hidden = !touchEnabled;
  }

  updateHud(session, timeLeft) {
    this.el.lives.textContent = `× ${session.lives}`;
    this.el.coins.textContent = `× ${String(session.coins).padStart(2, '0')}`;
    this.el.score.textContent = session.score.toLocaleString();
    this.el.time.textContent = String(Math.ceil(timeLeft)).padStart(3, '0');
  }

  setMuted(muted) {
    this.el.mute.textContent = muted ? '🔇' : '🔊';
    this.el.mute.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
  }

  // ---- overlays -----------------------------------------------------------
  hideAll() {
    for (const k of ['pause', 'clear', 'lifeLost', 'gameover']) this.el[k].hidden = true;
  }

  showPause(show) { this.el.pause.hidden = !show; }

  showClear({ levelName, score, bonus, coins, time, nextName }) {
    this.el.clearTitle.textContent = `${levelName} cleared!`;
    this.el.clearStats.replaceChildren(
      statRow('Clear bonus', `+${bonus.toLocaleString()}`),
      statRow('Total score', score.toLocaleString()),
      statRow('Coins', String(coins)),
      statRow('Time used', `${time.toFixed(1)}s`),
    );
    this.el.clear.querySelector('#next-btn').textContent = nextName ? `Next: ${nextName}` : 'Back to menu';
    this.el.clear.hidden = false;
  }

  showGameOver({ levelName, score, rank }) {
    this.el.gameoverStats.replaceChildren(
      statRow('Level', levelName),
      statRow('Score', score.toLocaleString()),
      statRow('Leaderboard rank', rank ? `#${rank}` : 'not ranked'),
    );
    this.el.gameover.hidden = false;
  }

  flashLifeLost(livesLeft) {
    this.el.lifeLost.querySelector('.ll-text').textContent =
      `Lives left: ${livesLeft}`;
    this.el.lifeLost.hidden = false;
  }

  hideLifeLost() { this.el.lifeLost.hidden = true; }

  toast(message, ms = 2800) {
    const t = this.el.toast;
    t.textContent = message;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }
}

function statRow(label, value) {
  const row = document.createElement('div');
  row.className = 'stat';
  const a = document.createElement('span'); a.textContent = label;
  const b = document.createElement('strong'); b.textContent = value;
  row.append(a, b);
  return row;
}
