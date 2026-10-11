# 🌴 Jungle Run

An endless **temple-runner** that plays in the browser — built from scratch in this
repo: original WebGL engine, generated art assets, and a fully synthesized
WebAudio soundtrack. No game engine, no pre-made asset pack, no external CDN.

> Run the ancient causeway. Vault the fire pits, slide under the vines, dodge the
> stone idols — and stay ahead of the **demon monkeys** that want the idol back.

---

## Play it

```bash
npm start                 # → http://localhost:4173
# or: npm run serve       (npx http-server)
# or: python3 -m http.server 4173
```

Then open the printed URL. A WebGL2/WebGL1-capable browser is all you need;
the game is designed for both desktop and mobile (touch, tilt, full-screen safe
areas).

### Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Change lane | `←` `→` / `A` `D` | swipe left / right (or tilt, in Settings) |
| Jump | `↑` / `W` / `Space` | swipe up, or tap |
| Slide | `↓` / `S` | swipe down |
| Pause | `P` / `Esc` | ❚❚ button |

---

## What's in the game

**Run & survive**
* 3 lanes, procedurally assembled track ("patterns") with a difficulty ramp
  measured in **reaction time**, never just distance.
* 12 obstacle types — fire pits, stone walls, spike traps, rolling logs, hanging
  vines, banner ledges, flame barriers, carved statues, tiki idols, fire gaps…
* Fairness rules baked into the director: a dodge pattern never blocks all three
  lanes, hard patterns are always followed by a breather, and jumps always have a
  reachable window.

**Threats**
* **Demon monkeys** fly in, lock a lane and hurl **fireballs** (slide under them,
  or switch lane). They also chase you during stumbles and pounce when you die.
* Clipping the very edge of an obstacle only makes you *stumble* — the beasts
  close in and the camera shakes. Turbo smashes straight through.

**Rewards**
* Coins with combo multiplier, **power-up orbs** (Turbo · Coin Magnet · Shield ·
  2× Coins), and the rare **golden idol** (500 pts + 25 coins).
* Near-miss bonuses for threading gaps at speed.

**Progression**
* Three zones — Deep Jungle → Ancient Ruins → Temple of the Idol — with their own
  fog, light, palette and obstacle pool, cross-faded live as you run.
* Persistent coins, high scores, best distance and 4 unlockable character skins.
* Coin revives (100 → 300), pause menu, settings (music, SFX, 4 quality levels,
  tilt steering, save reset).

---

## How it is built

```
index.html            markup + import map (three → vendor/)
css/style.css         HUD, screens, gold-on-jungle art direction
js/
  main.js             entry point
  app/
    game.js           renderer, post-processing, state machine, loop
    input.js          keyboard + swipe/tap + tilt
    hud.js            in-run HUD (score, combo, powers, banners, flashes)
    screens.js        menu, character shop, settings, pause, game-over UI
  core/
    config.js         every tuning constant in one place
    assets.js         loader (with procedural fallbacks) + skin recolouring
    audio.js          WebAudio SFX + generative temple soundtrack
    rng.js            seeded RNG + math helpers
    save.js/store.js  persistence + observable state
  game/
    run.js            THE simulation: physics, collisions, powers, zones, death
    player.js         run cycle, jump/slide, stumble, death, power visuals
    entities.js       pooled obstacles, coins, power-ups, idol, beasts, fireballs
    spawner.js        pattern director (fairness + difficulty ramp)
  render/
    environment.js    sky, lights, road, jungle/relic scenery, fireflies
    fx.js             pooled particles (dust, sparks, flames, debris, rings)
    camera.js         chase camera, speed FOV, shake, intro fly-in
    textures.js       procedural canvases (glows, strips, tints)
vendor/               three.js r186 + EffectComposer/RenderPass/Bloom/OutputPass
tools/                asset pipeline + test harnesses (see below)
assets/
  raw/                the AI-generated source art (kept as the source of truth)
  sprites|textures|ui the processed, game-ready output
```

Everything is loaded as native ES modules — **no build step**. `three` is
vendored into `vendor/` and wired up with an import map, so the game runs offline
and from any static host.

### The art pipeline

All art is generated for this project, then processed by `tools/process_assets.py`
(Pillow + NumPy):

1. **Chroma-keying** the magenta source art to real alpha, with de-spill and a
   1px alpha erosion to kill fringe pixels.
2. **Sprite extraction** — the 4-pose run cycle sheet is sliced into frames,
   auto-trimmed, uniformly rescaled and bottom-anchored so the feet never slide.
3. **Seamless textures** — the stone/ground/timber textures are wrap-blended
   across their borders so the 300-unit road tiles with no visible seam.
4. **Procedural assets** — the gold coin (with a carved jaguar mask), flame
   sheet, dust/spark/glow/shadow sprites, energy strips and wood grain are drawn
   from scratch with Pillow/NumPy; the sky panorama is a seamless equirect map.
5. **Derived art** — character skins are recoloured at runtime on canvas
   (hue/saturate/brightness + tint), so 4 characters need zero extra files.

The beasts, statues and the golden idol are **3D models built from primitives**
in `js/game/entities.js` — they read as clean silhouettes at speed and cost no
texture memory.

### The audio

`js/core/audio.js` synthesizes everything with WebAudio — there are no audio
files:

* **SFX**: jumping, landing, sliding, coin (pitch rises with your combo), gems,
  power-ups, shield break, growls, fireballs, the idol fanfare, zone stinger and
  the game-over cadence.
* **Music**: a generative *jungle temple* groove — kick/clap/shaker/tom kit,
  FM marimba melody, detuned pads and a delayed 16th-note sparkle line, playing
  an Am–F–C–G progression over a 2-bar pattern that gains layers as your speed
  rises (and drops an octave in the Temple zone).

### Performance notes

* Pooled everything: entities, particles, scenery props. Zero allocation in the
  hot loop; the track streams by wrapping props from the despawn line back to the
  horizon.
* The spawn line sits a constant **~4.3 s of track ahead of the player**, so new
  content never pops into view at any speed.
* Quality presets (`auto`/`high`/`medium`/`low`) control pixel ratio, bloom,
  shadows and particle counts; `auto` watches the frame rate and steps down once
  if needed.

---

## Tests

The simulation is deliberately renderer-free, so it can be exercised headlessly.

```bash
npm test              # all three suites
npm run test:wiring   # every DOM id, asset path and import resolves
npm run test:scene    # builds the full scene graph + plays 40 s (three.js in Node)
npm run test:play     # autopilot plays full runs and reports balance
```

`tools/headless_test.mjs` includes an **autopilot bot** that reads the track
ahead, plans lanes by danger/cost, and times jumps and slides using the real
jump physics. It is used for balance tuning:

```
settings             avg distance    notes
no input              ~150–1600 m     dies to the first obstacle
sloppy bot (0.15)     ~230–400 m      learns, still dies early
skilled bot (1.0)     ~2500–7000 m    dies at max speed to genuine mistakes
```

Other useful flags:

```bash
DEBUG_DEATH=1 node tools/headless_test.mjs   # dump the track at the moment of death
node tools/headless_test.mjs --seeds 20 --seconds 600
```

## Tuning

Almost every gameplay number lives in `js/core/config.js`: lanes, speeds,
jump/slide windows, spawn gaps, zone definitions, power-up durations and the
score table. Pattern design lives in `js/game/spawner.js`.

## Licence

MIT. The generated art in `assets/` may be reused freely.
