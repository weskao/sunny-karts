# Sunny Karts

A complete, original 3D browser kart race around **Sunbeam Village**. Six colorful racers, a 1.72 km circuit, three laps, controlled drifting, and earned nitro. Built with Vite, TypeScript, Three.js, and the Web Audio API. No engine installation, backend, account, or remote assets.

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

## Build and verify

```sh
npm test
npm run build
npm run preview
```

`dist/` is a self-contained static site. The only runtime dependency is Three.js.

For the Chrome integration test, keep the development server running:

```sh
npm run dev -- --port 5174
# In a second terminal:
npm run test:browser
```

The browser test uses local Chrome on macOS. Set `CHROME_PATH` for other installations and `GAME_URL` for another server port. It exercises real keyboard controls, checks Web Audio signal levels, then drives all six racers through a complete accelerated race using the normal steering controller and fixed timestep. It does not teleport racers or override lap counts. Screenshots and a JSON report are written to `artifacts/`.

## Phase 1 implementation

- `src/game.ts`: 60 Hz planar arcade handling, explicit drift/slip control, finite boost storage, forgiving contacts, predictive AI, 24 ordered checkpoints per lap, timing, placement, recovery, and race states.
- `src/world.ts`: original multi-mesh karts and pilots, road and scenery, shadows, chase camera, animated wheels, smoke, skids, and nitro flames.
- `src/audio.ts`: synthesized engines, skids, impacts, countdown, nitro and finish cues; original 148 BPM eight-bar track **Sunbeam Sprint**.
- `src/main.ts` and `src/style.css`: keyboard controls, HUD, minimap, start/pause/results screens, restart and audio/quality settings.

All geometry, signs, textures, music, and sounds are generated locally. No KartRider/Nexon assets, characters, logos, melodies, or recordings are included.

The road is planar with hills as scenery; rollover and suspension simulation are intentionally absent. Desktop keyboard is the supported input. Phase 1 includes one speed-racing circuit, with no items, multiplayer, progression, shops, or additional tracks.
