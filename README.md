# 🏛️ TEMPLE RUSH: Curse of the Lost Kingdom

A complete, polished **3D endless runner in the spirit of Temple Run**, built for
the browser from scratch in this repo: an original three.js WebGL engine,
a generated art pipeline, and a fully synthesized WebAudio soundtrack.
No game engine, no pre-made asset pack, no external CDN — everything is bundled
locally and legally redistributable (see [CREDITS.md](CREDITS.md) and
[ASSET_LICENSES.md](ASSET_LICENSES.md)).

> The Lost Kingdom's idol is yours — and the temple wants it back. Sprint the
> ancient causeway through three cursed zones, vault the fire pits, slide under
> the vines, dodge the stone idols — and stay ahead of the **demon monkeys**
> that hunt you down.

---

## Play it

```bash
npm install         # once (dev tooling; the game itself has no runtime deps)

npm start           # zero-build dev server → http://localhost:4173
# or
npm run dev         # Vite dev server (same port, hot reload)
```

Any static server works too (`npx http-server`, `python3 -m http.server 4173`),
because the game ships as plain ES modules with a vendored three.js and an
import map — no build step required to play.

### Production build

```bash
npm run build       # vite build + copies the runtime asset tree → dist/
npm run preview     # serves dist/ at http://localhost:4173
```

`dist/` is fully self-contained (relative paths, `base: './'`) and can be
deployed to any static host or opened through any static file server.

### Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Change lane | `←` `→` / `A` `D` | swipe left / right (or tilt, in Settings) |
| Jump | `↑` / `W` / `Space` | swipe up, or tap |
| Slide | `↓` / `S` | swipe down |
| Pause | `P` / `Esc` | ❚❚ button |

Browser scrolling/zooming is suppressed during play (`touch-action: none`,
`overscroll-behavior: none`), and audio starts only after the first user
gesture, as required by autoplay policies.

---

## What's in the game

**Run & survive**
* Third-person chase camera with speed FOV, lean, shake, cinematic intro
  fly-in, death zoom and an orbiting menu showcase behind the main menu.
* 3 lanes, procedurally assembled track ("patterns") with a difficulty ramp
  measured in **reaction time**, never just distance.
* 11 obstacle archetypes across 12 spawn types — fire pits, stone walls,
  spike traps, fallen logs, rolling logs, hanging vines, banner ledges, flame
  barriers, carved statues, tiki idols, fire gaps.
* Fairness rules baked into the director: a dodge pattern never blocks all
  three lanes, hard patterns are always followed by a breather, coins only
  spawn in lanes the current pattern leaves open, and the spawn line sits a
  constant **~4.3 s of track ahead** so nothing ever pops into view.

**Threats**
* **Demon monkeys** chase you during the intro, after stumbles and on death;
  they lock lanes and hurl **fireballs** (slide under them, or switch lane).
* Clipping the very edge of a dodge-obstacle only makes you *stumble* — the
  beasts close in and the camera shakes. Turbo smashes straight through.

**Rewards**
* Coins with a combo multiplier, **power-up orbs**: Turbo · Coin Magnet ·
  Shield · **Score ×2** (doubles distance *and* coin scoring), plus the rare
  **golden idol** (500 pts + 25 coins) and near-miss bonuses.

**Progression**
* Three zones — Deep Jungle → Ancient Ruins → Temple of the Idol — each with
  its own fog, light, palette and obstacle pool, cross-faded live as you run.
* Persistent wallet, high score, best distance and 4 unlockable character
  skins (localStorage, with migration from earlier saves).
* Coin revives (100 → 300), pause/resume, settings (music, SFX, 4 quality
  presets with auto-downgrade, tilt steering, save reset), game-over summary
  and instant restart without reloading the page.

**Presentation**
* ACES tone mapping, optional bloom, soft shadows, layered scenery, animated
  torches/fire, dust, sparks, leaves and a full particle system.
* Procedural soundtrack: a generative *jungle-temple* groove (kick/clap/
  shaker/tom kit, FM marimba melody, detuned pads, sparkle arps) that gains
  layers as your speed rises and drops an octave in the Temple zone — plus a
  synthesized jungle ambience bed (wind + bird chirps) and a full SFX set
  (jump, land, slide, coins with combo pitch, power-ups, shield break,
  growls, fireballs, idol fanfare, zone stinger, game-over cadence).

---

## Project structure

```
index.html            markup + import map (three → vendor/)
vite.config.js        production build (aliases keep ONE vendored three.js)
css/style.css         HUD, screens, gold-on-jungle art direction
js/
  main.js             entry point
  app/
    game.js           renderer, post-processing, state machine, game loop
    input.js          keyboard + swipe/tap + tilt
    hud.js            in-run HUD (score, combo, powers, banners, flashes)
    screens.js        menu, character shop, settings, pause, game-over UI
  core/
    config.js         every tuning constant in one place
    assets.js         loader (with procedural fallbacks) + skin recolouring
    audio.js          WebAudio SFX + generative music + jungle ambience
    save.js           persistence + legacy save migration
    store.js, rng.js  tiny observable store / event bus, seeded RNG
  game/
    run.js            run state machine: physics, collisions, chase, revive
    player.js         runner controller + animation state machine
    spawner.js        track director (patterns, fairness rules, specials)
    entities.js       pooled obstacles/coins/orbs/enemies + hitboxes
  render/
    environment.js    streamed track + per-zone scenery, torches, fog
    camera.js         chase rig, shake, intro/menu cinematography
    fx.js             pooled particles, screen shake, bursts
    textures.js       canvas texture helpers + skin tinting
assets/
  sprites/ textures/ ui/   game-ready art (generated by tools/process_assets.py)
  raw/                     source plates the pipeline was generated from
vendor/               three.js + post-processing addons (MIT, vendored)
tools/                dev server, asset pipeline, headless test harness
```

## Architecture notes

* **Renderer:** three.js (r186, vendored) with EffectComposer bloom + output
  pass; ACES filmic tone mapping. Runs headlessly under Node for tests.
* **Models & animation:** the engine deliberately builds all geometry
  procedurally in three.js and animates the runner with a hand-keyed 4-frame
  billboard run cycle (the classic Temple Run presentation). No GLTF/GLB
  binaries are required, which keeps the whole game inspectable, tiny to
  download and free of external model licences. (Blender and third-party
  model CDNs were unavailable in the build environment; procedural geometry
  is the sanctioned replacement and is documented in CREDITS.md.)
* **Memory:** everything on screen comes from fixed-size pools (entities,
  particles, scenery props). Track content is recycled across the despawn
  line, so a 10-minute run allocates nothing and leaks nothing.

## Tests

The simulation is renderer-free, so it is exercised headlessly in CI style:

```bash
npm test              # all three suites
npm run test:wiring   # every DOM id, asset path and import resolves
npm run test:scene    # builds the full scene graph + plays runs in Node
npm run test:play     # autopilot plays full runs and reports balance
```

`tools/headless_test.mjs` includes an **autopilot bot** that reads the track
ahead, plans lanes by danger/cost and times jumps/slides with the real jump
physics. Typical balance numbers:

```
settings             avg distance    notes
no input              ~150 m          dies at the first obstacle
sloppy bot (0.15)     ~230 m          learns, still dies early
skilled bot (1.0)     ~2500–7000 m    dies at max speed to genuine mistakes
```

Useful flags:

```bash
DEBUG_DEATH=1 node tools/headless_test.mjs   # dump the track at death
node tools/headless_test.mjs --seeds 20 --seconds 600
```

**Testing disclosure:** the suites above run the real game code (scene graph,
physics, spawning, collisions, UI wiring) in Node. Pixel-level rendering,
audio output and touch handling additionally require a real browser; see the
QA section of CREDITS.md for exactly what was and wasn't verifiable in the
build environment.

## Tuning

Almost every gameplay number lives in `js/core/config.js`: lanes, speeds,
jump/slide physics, spawn gaps, zone definitions, power-up durations and the
score table. Pattern design lives in `js/game/spawner.js`.

## Licence

Code: MIT (see [LICENSE note in ASSET_LICENSES.md](ASSET_LICENSES.md)).
All art and audio in `assets/` is original to this repo (generated or
synthesized) and may be reused freely — full provenance in
[CREDITS.md](CREDITS.md).
