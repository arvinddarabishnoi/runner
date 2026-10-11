# Jump Hero

A 2D side-scrolling platformer with a full-stack setup: a canvas game client in
plain ES modules and a small Node.js JSON API that stores runs, a leaderboard
and campaign progress. Three levels, three lives per run, coins, stomps,
power-ups, spikes, pipes, a clock and a flag at the end of every level.

Art and sounds are [Kenney](https://kenney.nl) assets released under **CC0 1.0**
(public domain). See `assets/LICENSE-kenney-CC0.md`. The chiptune music is
synthesized in the browser with WebAudio, so no music file is shipped. The game
does not use any Nintendo artwork, sounds or names.

## Run it

Requires Node.js 18 or newer. There are no runtime dependencies.

```bash
cd mario
npm start            # http://localhost:4174  (binds 0.0.0.0)
npm test             # API, level-data and bot tests
```

Environment variables:

| Variable    | Default                | Purpose                                  |
|-------------|------------------------|------------------------------------------|
| `PORT`      | `4174`                 | HTTP port                                |
| `MARIO_DATA`| `server/data/db.json`  | Where runs and progress are stored (JSON)|

`server/data/` is git-ignored.

## Controls

| Action | Keyboard                        | Touch            |
|--------|---------------------------------|------------------|
| Move   | ← → or A / D                    | ◀ ▶ buttons      |
| Run    | Shift, X or J (hold)            | RUN button       |
| Jump   | Space, ↑, W or Z (hold to go higher) | JUMP button |
| Pause  | P or Esc                        | II button        |
| Mute   | M                               | speaker icon     |

Stomp enemies from above. Hit a `?` block from below for a coin. Three deaths
end the run; a cleared level unlocks the next one. Coins give an extra life
every 100.

## Architecture

```
mario/
├── index.html            single page: canvas + DOM overlays (menu, HUD, pause, clear, game over)
├── css/style.css
├── js/
│   ├── main.js           app shell: run/lives flow, game loop, sound + UI glue
│   ├── game.js           rules and state machine (pure JS, no DOM)
│   ├── entities.js       hero, enemies, coins, mushrooms, debris
│   ├── physics.js        tile collision + integration
│   ├── level.js          ASCII level -> playable grid
│   ├── render.js         canvas renderer (reads game state only)
│   ├── input.js          keyboard + touch -> one input snapshot per frame
│   ├── audio.js          sound effects + synthesized music
│   ├── assets.js         image and sound manifests
│   ├── config.js         every tuning number
│   ├── api.js            fetch wrapper for the server API
│   └── ui.js             DOM overlays and HUD
├── server/
│   ├── index.mjs         HTTP server, JSON API, static files, level + score validation
│   ├── store.mjs         JSON file store (atomic writes)
│   └── levels/*.json     the campaign: ASCII maps + metadata
├── tests/
│   ├── server.test.mjs   API contract tests
│   ├── levels.test.mjs   level validity and fairness rules
│   ├── bot.test.mjs      headless autopilot clears 1-1
│   └── bot.mjs           simulation-based autopilot (test oracle)
└── assets/               Kenney CC0 art and sound
```

The game client never talks to the server during play. It fetches the level
list and a level's map once, then posts one result when a run ends.

### Level format

```json
{ "id": "1-1", "name": "Meadow Dash", "theme": "grass", "timeLimit": 300,
  "rows": [ "....@....", "####F####" ] }
```

Tiles: `.` empty, `#` ground, `=` floating platform, `B` brick, `?` coin block,
`M` power-up block, `x` used block, `P` pipe (drawn procedurally), `w` spikes, `o` coin,
`e` slime, `n` snail, `f` fly, `@` spawn (exactly one), `F` flag pole.

## API

| Method | Path                       | Notes |
|--------|----------------------------|-------|
| GET    | `/api/health`              | `{ ok, levels }` |
| GET    | `/api/levels`              | campaign list, no map data |
| GET    | `/api/levels/:id`          | full level including `rows` |
| GET    | `/api/leaderboard?level=`  | top 10 for a level |
| POST   | `/api/scores`              | `{ name, level, score, coins, time, cleared }` → `201 { rank, best, unlocked }` |
| GET    | `/api/players/:name`       | `{ name, unlocked, best }` |

Validation: name is 1–16 characters of letters, digits, spaces, `_` or `-`;
score ≤ 999 999; coins ≤ 9 999; time within the level's time limit. Clearing a
level unlocks the next one. The server keeps the best 100 runs per level.

Scores are self-reported, as is normal for a casual game without accounts. The
server checks ranges and shapes but cannot verify that a run was real.

## Known gaps

- Level 1-1 is verified by the headless autopilot in `npm test`. Levels 1-2 and
  1-3 pass all static checks (valid structure, pits at most 3 tiles, no tall pipe
  right before a pit), but the autopilot does not yet clear them. They have not
  been playtested by a person.
- The client has been smoke-tested in jsdom (menu, name, play, pause, mute, life
  loss and restart, overlay content). It has not been checked visually in a
  real browser yet.
- No accounts or login. Names are not secured.
