// Application shell: menu flow, campaign run (lives, score carry-over), the
// fixed-step game loop and the glue between Game, Renderer, SoundBank and UI.
import { Game, STATES } from './game.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { SoundBank } from './audio.js';
import { loadImages, preloadSounds } from './assets.js';
import { api } from './api.js';
import { UI } from './ui.js';
import { RULES, VIEW_W, VIEW_H } from './config.js';

const NAME_KEY = 'jumpHero.name';
const NAME_RE = /^[A-Za-z0-9 _-]{1,16}$/;
const $ = (sel) => document.querySelector(sel);

const ui = new UI();
const input = new Input(window);
let renderer = null;
let sounds = null;

function selectedIndex() { return app.levels.findIndex((l) => l.id === app.selectedId); }

const app = {
  levels: [],          // campaign list from /api/levels
  levelCache: new Map(), // id -> full level JSON
  unlocked: 1,
  selectedId: null,
  name: '',
  run: null,           // { index, session, start: {score, coins}, submitting }
  game: null,
  running: false,
  paused: false,
  busy: false,
  last: 0,
};

// ---------- boot ---------------------------------------------------------
async function boot() {
  const canvas = $('#game');
  canvas.width = VIEW_W; canvas.height = VIEW_H;
  const loader = $('#loader');
  try {
    const [images, levels] = await Promise.all([loadImages(), api.levels()]);
    renderer = new Renderer(canvas, images);
    app.levels = levels;
    sounds = new SoundBank(preloadSounds());
  } catch (err) {
    loader.querySelector('p').textContent = `Could not start: ${err.message}`;
    return;
  }
  loader.hidden = true;
  input.bindTouch($('#touch'));
  app.touch = Boolean(window.matchMedia?.('(pointer: coarse)').matches);

  const savedName = localStorage.getItem(NAME_KEY) || '';
  const nameInput = $('#player-name');
  nameInput.value = savedName;
  app.name = savedName;
  nameInput.addEventListener('focus', () => { input.enabled = false; input.down.clear(); });
  nameInput.addEventListener('blur', () => { input.enabled = true; });
  nameInput.addEventListener('change', () => refreshMenu());
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameInput.blur(); });
  $('#play-btn').addEventListener('click', onPlay);
  $('#resume-btn').addEventListener('click', () => setPaused(false));
  $('#pause-menu-btn').addEventListener('click', () => { setPaused(false); endRunToMenu(); });
  $('#next-btn').addEventListener('click', onNextLevel);
  $('#clear-menu-btn').addEventListener('click', () => { endRunToMenu(); });
  $('#retry-btn').addEventListener('click', () => startRun(selectedIndex()));
  $('#gameover-menu-btn').addEventListener('click', () => endRunToMenu());
  $('#mute-btn').addEventListener('click', toggleMute);
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
  window.addEventListener('blur', () => setPaused(true));

  ui.setMuted(sounds.muted);
  ui.showMenu();
  await refreshMenu();
  requestAnimationFrame(frame);
}


// ---------- menu ---------------------------------------------------------
function currentNameOrNull() {
  const raw = $('#player-name').value.trim();
  return NAME_RE.test(raw) ? raw : null;
}

async function refreshMenu() {
  const name = currentNameOrNull();
  app.name = name ?? '';
  if (name) localStorage.setItem(NAME_KEY, name);
  app.unlocked = 1;
  if (name) {
    try {
      const p = await api.player(name);
      app.unlocked = p.unlocked;
    } catch (err) {
      ui.toast(`Could not load progress: ${err.message}`);
    }
  }
  if (!app.selectedId || selectedIndex() + 1 > app.unlocked) {
    app.selectedId = app.levels[0].id;
  }
  ui.renderLevels(app.levels, app.unlocked, app.selectedId, (id) => { app.selectedId = id; refreshMenu(); });
  await refreshBoard();
  $('#play-btn').disabled = false;
}

async function refreshBoard() {
  const lvl = app.levels[selectedIndex()];
  try {
    const rows = await api.leaderboard(lvl.id);
    ui.renderLeaderboard(lvl.name, rows, app.name);
  } catch (err) {
    ui.toast(`Leaderboard unavailable: ${err.message}`);
  }
}

async function onPlay() {
  const name = currentNameOrNull();
  if (!name) { ui.toast('Enter a name: 1–16 letters, digits, spaces, _ or -'); $('#player-name').focus(); return; }
  if (app.busy) return;
  sounds.unlock();
  sounds.startMusic();
  startRun(selectedIndex());
}

// ---------- run / level lifecycle -----------------------------------------
async function loadLevel(index) {
  const id = app.levels[index].id;
  if (!app.levelCache.has(id)) app.levelCache.set(id, await api.level(id));
  return app.levelCache.get(id);
}

async function startRun(index) {
  app.run = { index, session: { lives: RULES.startLives, score: 0, coins: 0 }, start: { score: 0, coins: 0 } };
  await startLevel();
}

async function startLevel() {
  const { index, session } = app.run;
  app.busy = true;
  ui.setPlayBusy(true);
  let data;
  try {
    data = await loadLevel(index);
  } catch (err) {
    ui.toast(`Could not load level: ${err.message}`);
    app.busy = false; ui.setPlayBusy(false);
    return;
  }
  app.busy = false; ui.setPlayBusy(false);
  app.run.start = { score: session.score, coins: session.coins };
  app.game = new Game(data, session);
  app.levelName = data.name;
  renderer.resetCamera();
  $('#menu').hidden = true;
  ui.hideAll();
  ui.showHud(data.name, app.touch);
  app.paused = false;
  app.running = true;
  app.last = performance.now();
}

function endRunToMenu() {
  app.running = false;
  app.game = null;
  app.run = null;
  sounds.stopMusic();
  ui.showMenu();
  refreshMenu();
}

function onNextLevel() {
  ui.hideAll();
  const next = app.run.index + 1;
  if (next >= app.levels.length) { endRunToMenu(); return; }
  app.run.index = next;
  app.selectedId = app.levels[next].id;
  startLevel();
}

// ---------- pause / mute --------------------------------------------------
function setPaused(on) {
  if (on && !(app.running && app.game?.state === STATES.PLAYING)) return;
  if (!on && !app.paused) return;
  app.paused = on;
  ui.showPause(on);
  app.last = performance.now();
}

function toggleMute() {
  sounds.setMuted(!sounds.muted);
  ui.setMuted(sounds.muted);
}

// ---------- events -> sound & feedback ------------------------------------
function handleEvents(events) {
  for (const ev of events) {
    switch (ev.type) {
      case 'jump': sounds.play('jump', 0.4); break;
      case 'stomp': sounds.play('stomp', 0.5); renderer.addFloat(`+${ev.points}`, ev.x, ev.y); break;
      case 'coin': sounds.play('coin', 0.5); renderer.addFloat(`+${ev.points}`, ev.x, ev.y); break;
      case 'oneup': sounds.play('powerup', 0.6); renderer.addFloat('1UP', ev.x, ev.y); break;
      case 'powerup': sounds.play('powerup', 0.6); break;
      case 'reveal': sounds.play('powerup', 0.4); break;
      case 'bump': sounds.play('bump', 0.4); break;
      case 'break': sounds.play('break', 0.5); break;
      case 'hurt': sounds.play('hurt', 0.6); renderer.triggerShake(0.4); break;
      case 'death': sounds.play('hurt', 0.7); renderer.triggerShake(0.6); break;
      case 'flag': sounds.play('clear', 0.5); break;
      default: break;
    }
  }
}

// ---------- end-of-level handling -----------------------------------------
function onLevelCleared() {
  const game = app.game;
  const run = app.run;
  const session = run.session;
  const levelName = app.levels[run.index].name;
  const hasNext = run.index + 1 < app.levels.length;
  app.running = false;
  sounds.play('clear', 0.6);
  submit({ cleared: true, score: session.score, coins: session.coins, time: game.timeUsed })
    .then((res) => {
      if (res) app.unlocked = Math.max(app.unlocked, res.unlocked);
      ui.showClear({
        levelName,
        score: session.score,
        bonus: game.clearBonus,
        coins: session.coins,
        time: game.timeUsed,
        nextName: hasNext ? app.levels[run.index + 1].name : null,
      });
    });
}

function onLevelLost() {
  const run = app.run;
  const game = app.game;
  app.running = false;
  run.session.lives -= 1;
  if (run.session.lives <= 0) {
    const levelName = app.levels[run.index].name;
    const score = run.session.score;
    sounds.play('gameover', 0.6);
    submit({ cleared: false, score, coins: run.session.coins, time: game.timeUsed })
      .then((res) => ui.showGameOver({ levelName, score, rank: res?.rank }));
    return;
  }
  // lose this attempt's points and coins, keep the lives already spent
  run.session.score = run.start.score;
  run.session.coins = run.start.coins;
  ui.flashLifeLost(run.session.lives);
  setTimeout(() => {
    if (!app.run) return;
    ui.hideLifeLost();
    startLevel();
  }, 1800);
}

async function submit(result) {
  const run = app.run;
  const body = {
    name: app.name,
    level: app.levels[run.index].id,
    score: Math.min(999999, Math.max(0, result.score)),
    coins: Math.min(9999, Math.max(0, result.coins)),
    time: Math.min(app.levels[run.index].timeLimit, Math.max(0, result.time)),
    cleared: result.cleared,
  };
  try {
    return await api.submitScore(body);
  } catch (err) {
    ui.toast(`Score not saved: ${err.message}`, 4000);
    return null;
  }
}

// ---------- loop ----------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - app.last) / 1000);
  app.last = now;
  if (!app.game) return;

  const snap = input.snapshot();
  input.endFrame();
  if (snap.mutePressed) toggleMute();
  if (snap.pausePressed) setPaused(!app.paused);

  if (!app.paused && app.running) {
    app.game.update(dt, snap);
    handleEvents(app.game.drainEvents());
    ui.updateHud(app.run.session, app.game.timeLeft);
    const st = app.game.state;
    if (st === STATES.CLEARED) onLevelCleared();
    else if (st === STATES.LOST) onLevelLost();
  } else {
    app.game.drainEvents();
  }
  renderer.draw(app.game, app.paused ? 0 : dt);
}

boot();
