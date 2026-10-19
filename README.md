# Sunny Karts

A complete, original 3D browser kart race around **Sunbeam Village**. Six colorful racers, a 1.72 km circuit, three laps, controlled drifting, and earned nitro. Built with Vite, TypeScript, Three.js, and the Web Audio API. No engine installation, backend, account, or remote assets.

**Play online:** https://weskao.github.io/sunny-karts/ (redeployed by GitHub Actions on every push to `main` once build, unit and browser tests pass).

## Play locally

Node.js 22.18+ and modern desktop Chrome with hardware acceleration:

```sh
npm install
npm run dev
```

Open the localhost address printed by Vite. Click **LET’S RACE** to unlock audio and begin the countdown. Keep the browser tab focused.

| Control          | Action                                            |
| ---------------- | ------------------------------------------------- |
| W / ↑            | Accelerate                                        |
| S / ↓            | Brake, then reverse                               |
| A / ←, D / →     | Steer                                             |
| Shift + steering | Hold a drift; counter-steer to adjust the slide   |
| Ctrl             | Spend one stored nitro charge                     |
| R                | Recover at your last validated safe road position |
| Esc              | Pause / resume                                    |
| Enter            | Start / restart                                   |

Hold a controlled slide at speed to fill the yellow meter. One full meter awards one nitro; store up to two. Nitro lasts 2.15 seconds. Release a sustained drift for a small exit kick. Brake before the tight village bends; use nitro on the straights. The minimap’s yellow square marks your next checkpoint. Music, sound, and graphics quality have separate controls.

## Race UI

- **Top left:** current position out of six racers.
- **Top right:** lap number, total race time, current lap, and best lap.
- **Bottom left:** circuit minimap and next checkpoint marker.
- **Bottom center:** drift charge and stored nitro.
- **Bottom right:** live speed in km/h.

Keyboard input stays responsive after starting or resuming a race, including when an arrow or WASD key remains held through the transition.

## Build and verify

```sh
npm test
npm run build
npm run preview
```

Run this focused browser check with the development server on port 5174 to verify the arrow keys, braking, and pause/resume input behavior:

```sh
node tests/keyboard.mjs
```

To verify the same controls against the built bundle, serve `dist/` and drive it using only what a player can see (HUD speed and the minimap dot), because the development inspection hook is stripped from production builds:

```sh
npm run build
npm run preview -- --port 5180 --strictPort
# In a second terminal:
node tests/prod-keyboard.mjs
BLOCK_AUDIO=1 node tests/prod-keyboard.mjs
```

`BLOCK_AUDIO=1` simulates a browser whose autoplay policy leaves `AudioContext.resume()` pending forever. Starting the race must never wait on audio, so the countdown and the keyboard controls have to work regardless.

### Serving a stale build

If a change does not appear in the browser, you are almost certainly looking at another server rather than a caching bug in the game: leftover `vite` processes keep serving the module graph they started with. `npm run dev` and `npm run preview` both pass `--strictPort`, so a second instance fails loudly instead of quietly binding a different port. To get back to a known-good state:

```sh
pkill -f "sunny-karts/node_modules/.bin/vite"   # stop every server for THIS project
rm -rf node_modules/.vite dist                  # drop the dependency cache and old bundle
npm run build
```

Built asset filenames contain a content hash (`index-<hash>.js`), so confirm the page requests the same hash the build just printed. Only `index.html` needs a no-cache header when deploying; the hashed assets are safe to cache forever.

`dist/` is a self-contained static site. The only runtime dependency is Three.js.

For the Chrome integration test, keep the development server running:

```sh
npm run dev -- --port 5174
# In a second terminal:
npm run test:browser
```

The browser test uses local Chrome on macOS. Set `CHROME_PATH` for other installations and `GAME_URL` for another server port. It exercises real keyboard controls, checks Web Audio signal levels, then drives all six racers through a complete accelerated race using the normal steering controller and fixed timestep. It does not teleport racers or override lap counts. Screenshots and a JSON report are written to `artifacts/`.

## Phase 2 polish

The original circuit and race rules remain intact. Phase 2 adds more responsive keyboard steering, explicit drift entry/sustain/exit, a bounded slip angle, effective counter-steering, and charge based on speed, angle, duration, and distance. A clean release gives a short exit kick; earned nitro retains its 2.15-second duration and two-charge limit.

The chase camera now follows interpolated kart motion with faster response, turn look-ahead, and a smooth nitro pullback/FOV change. Karts have glossy paint, side pods, rear wings, metallic rims, steering-wheel motion, and visual acceleration/braking pitch.

Sunbeam Village now includes a festival grandstand, working windmill, market stalls, hot-air balloons, roadside pennants, textured asphalt/grass, a gradient sky, and warmer lighting. Repeated static scenery is instanced in spatial groups. Smoke emission is time-based and responds to drift quality; dust, sparks, exhaust trails, and finish confetti share a capped 320-particle pool.

The HUD adds animated countdown/position/charge feedback, a nitro duration bar, clearer drift-quality feedback, and a speed-responsive gauge. Music briefly ducks for countdown, nitro, and finish cues; a compressor controls peaks, the engine responds to acceleration, and nitro has a sustained rush. All music and sounds remain original local synthesis.

With the dev server on port 5174:

```sh
node tests/phase2.mjs
# Also drive a complete race through DOM arrow-key events in real time:
REALTIME=1 node tests/phase2.mjs
```

The polish test checks emission consistency at 30/120 FPS, zero-time particle freezing, camera boost recovery, audio ducking/output peaks, and scenery batching. It captures four circuit landmarks and records frame timings in `artifacts/phase2-report.json`. The optional real-time run takes approximately four minutes. Unit tests also complete a three-lap drift-and-nitro race without moving the kart directly or changing checkpoints.

## Implementation

- `src/game.ts`: 60 Hz planar arcade handling, explicit drift/slip control, finite boost storage, forgiving contacts, predictive AI, 24 ordered checkpoints per lap, timing, placement, recovery, and race states.
- `src/world.ts`: original multi-mesh karts and pilots, road and scenery, shadows, chase camera, animated wheels, smoke, skids, and nitro flames.
- `src/audio.ts`: synthesized engines, skids, impacts, countdown, nitro and finish cues; original 148 BPM eight-bar track **Sunbeam Sprint**.
- `src/main.ts` and `src/style.css`: keyboard controls, HUD, minimap, start/pause/results screens, restart and audio/quality settings.

All geometry, signs, textures, music, and sounds are generated locally. No KartRider/Nexon assets, characters, logos, melodies, or recordings are included.

The road is planar with hills as scenery; rollover and suspension simulation are intentionally absent. Desktop keyboard is the supported input. This version includes one speed-racing circuit, with no items, multiplayer, progression, shops, slipstream, or starting-timing bonus. Graphics quality can be reduced with the existing **HIGH QUALITY / LITE QUALITY** control.
