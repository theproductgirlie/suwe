# SUWE

The Nigerian hopping game, for [start.ng](https://start.ng) (live at https://suwe.start.ng).
Frontend only: the playable game is the static site in `docs/`.

## How it is organised

- `docs/js/engine/` the rules engine: pure and deterministic (no screen code, no clock, no
  `Math.random`). `applyMove(state, move)` returns the new state and events. State is plain JSON, so
  matches save, resume and replay exactly. Includes the computer players (`ai.js`).
- `docs/js/render/` drawing. `scene.js` renders with three.js (vendored in `docs/js/vendor/`); `scene-2d.js` is the original Canvas 2D
  renderer, kept as the fallback when WebGL is missing and for comparison (`?renderer=2d`). `character.js` draws the characters from start.ng style fields.
- `docs/js/director.js` turns engine events into animation and sound.
- `docs/js/audio.js` music and effects, synthesised with Web Audio (no audio files).
- `docs/js/tutorial.js`, `setup.js`, `main.js` the How to Play slides, the "Who's playing?" screen, and the app.
- `docs/js/startng.js` talks to start.ng (who is playing, leaderboard, scores).
- `docs/startng.json` the leaderboard columns.
- `tests/` engine, computer-player, lives and `startng.json` tests (`npm test`).
- `tools/` local server and headless-browser checks (not served):
  - `npm run serve`, then open http://localhost:5173 (add `?debug` for the test hook,
    `?signedin` to pretend to be a signed-in start.ng player)
  - `node tools/flow.mjs` screens and flows, `node tools/play.mjs` a full touch playthrough,
    `node tools/audio-check.mjs` renders every sound offline and checks it, `node tools/cover.mjs` redraws the cover.

## Rules in short

Throw the stone into the target square, hop through the other squares in order, turn, hop back, pick
up the stone, hop home, then aim at the next square. A mistake ends your turn and costs a heart.
After all 12 squares you throw backwards over your shoulder (Ra Ile) to buy a house. Most houses when
every square is claimed wins; ties go to a closest-stone throw.

Players must be signed in to start.ng. Computers only play in 2-player matches.
