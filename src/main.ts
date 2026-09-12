import "./style.css";
import { Game, DT, idle, clamp, type Input } from "./game.ts";
import { World } from "./world.ts";
import { AudioEngine } from "./audio.ts";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div id="viewport" aria-label="3D kart racing circuit"></div>
  <div class="vignette"></div><div id="speed-lines"></div>
  <header><a class="wordmark" href="#" aria-label="Sunny Karts home"><span class="sun">✳</span> SUNNY<span class="thin">KARTS</span><span class="edition">01</span></a><div class="location"><span class="live-dot"></span> SUNBEAM VILLAGE <span class="divider">/</span> SUNNY, 24°</div><button id="pause" class="icon-button" aria-label="Pause race" title="Pause · Esc">Ⅱ</button></header>
  <section id="hud" class="hidden" aria-label="Race information">
    <div class="position-card"><span class="eyebrow">POSITION</span><div><strong id="position">6</strong><span class="of">/ 6</span></div><span id="place-label">LET’S GO!</span></div>
    <div class="timing"><div class="lap-box"><span class="eyebrow">LAP</span><strong id="lap">1 <small>/ 3</small></strong></div><div class="time-box"><div><span>RACE</span><b id="time">00:00.000</b></div><div><span>LAP</span><b id="lap-time">00:00.000</b></div><div><span>BEST</span><b id="best">—</b></div></div></div>
    <div class="map-card"><div class="eyebrow">SUNBEAM CIRCUIT <span>↗</span></div><canvas id="map" width="260" height="180" aria-label="Circuit minimap"></canvas><div class="map-caption"><span class="player-dot"></span> YOU <span>3 LAPS · <span id="track-length"></span> KM</span></div></div>
    <div class="driving-help"><kbd>WASD</kbd> DRIVE <span>·</span> <kbd>SHIFT</kbd> DRIFT <span>·</span> <kbd>R</kbd> RECOVER</div>
    <div class="boost-card"><div class="boost-heading"><span id="boost-label">DRIFT TO CHARGE</span><span id="drift-status">BUILD YOUR BURST</span></div><div class="boost-track"><div id="boost-fill"></div><i></i><i></i><i></i></div><div class="nitro-row"><div id="nitro-slots"><span class="nitro-slot">ϟ</span><span class="nitro-slot">ϟ</span></div><div><kbd>CTRL</kbd> <span id="nitro-hint">NITRO BOOST</span></div></div></div>
    <div class="speed-card"><span id="speed">0</span><span class="speed-unit">KM/H</span><div class="speed-ticks">▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰ ▰</div></div>
  </section>
  <div id="countdown" role="status" aria-live="assertive"></div><div id="toast" role="status"></div>
  <section id="ready" class="screen ready-screen">
    <div class="hero-copy"><div class="pill"><span>✦</span> A LITTLE SUNSHINE. A LOT OF SPEED.</div><h1>SUNNY<br><span>KARTS<span class="title-dot">.</span></span></h1><p class="tagline">Good vibes. Tight corners.<br>Leave a little smoke behind.</p><div class="race-spec"><span><b>06</b> RACERS</span><span><b>03</b> LAPS</span><span><b>01</b> SUNNY CIRCUIT</span></div></div>
    <div class="start-panel"><div class="track-stamp"><span class="stamp-icon">☀</span><div><span class="eyebrow">TODAY’S DESTINATION</span><h2>Sunbeam Village</h2><p>Hillside bends. Pastel rooftops. Full send.</p></div></div><button id="start" class="primary">LET’S RACE <span>↗</span></button><div class="start-note">PRESS ENTER TO START <span>•</span> SOUND ON FOR THE GOOD STUFF</div></div>
    <div class="controls-strip"><div><kbd>↑</kbd><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd><span>DRIVE <small>or WASD</small></span></div><div><kbd>SHIFT</kbd><span>HOLD TO DRIFT</span></div><div><kbd>CTRL</kbd><span>USE NITRO</span></div><div><kbd>R</kbd><span>RECOVER</span></div></div>
  </section>
  <section id="paused" class="screen modal-screen hidden" aria-label="Pause menu"><div class="modal"><div class="pill">TAKE A BREATHER</div><h2>PIT STOP<span>.</span></h2><p>Your sunshine isn’t going anywhere.</p><button id="resume" class="primary">BACK TO THE RACE <span>↗</span></button><button id="pause-restart" class="secondary">RESTART RACE</button></div></section>
  <section id="finished" class="screen modal-screen hidden" aria-label="Race results"><div class="modal finish-modal"><div class="pill">THREE LAPS. ALL SMILES.</div><h2>FINISH<span>!</span></h2><div class="result-place"><strong id="finish-place">1st</strong><span>OUT OF 6 RACERS</span></div><div class="result-stats"><div><span>TOTAL TIME</span><b id="finish-time"></b></div><div><span>BEST LAP</span><b id="finish-best"></b></div></div><div id="lap-results"></div><button id="restart" class="primary">ONE MORE RACE <span>↗</span></button><p class="result-tip">A clean drift is just the beginning.</p></div></section>
  <footer><span>ORIGINAL ARCADE RACING <span class="footer-star">✳</span> PHASE 01</span><div><button id="music" aria-pressed="true">♫ MUSIC ON</button><button id="sound" aria-pressed="true">◖ SOUND ON</button><button id="quality" aria-pressed="true">HIGH QUALITY</button></div></footer>
`;
const el = (id: string) => document.getElementById(id)!;
export const game = new Game();
export const audio = new AudioEngine();
game.state = "LOADING";
let world: World;
try {
  world = new World(game, el("viewport"));
} catch (error) {
  el("ready").innerHTML =
    '<div class="modal"><h2>WEBGL NEEDED</h2><p>Open this game in desktop Chrome with hardware acceleration enabled.</p></div>';
  throw error;
}
game.state = "READY";
const keys = new Set<string>();
let starting = false,
  lastState = "",
  toastTime = 0,
  goTime = 0,
  accumulator = 0,
  last = performance.now(),
  uiTimer = 0;
const time = (seconds: number) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}.${Math.floor((seconds % 1) * 1000)
    .toString()
    .padStart(3, "0")}`;
const ordinal = (n: number) => `${n}${["", "st", "nd", "rd"][n] || "th"}`;
function toast(text: string) {
  el("toast").textContent = text;
  toastTime = 2.2;
  el("toast").classList.add("show");
}
async function start() {
  if (starting) return;
  starting = true;
  try {
    await audio.start();
  } catch {
    toast("Audio unavailable — the race is still ready.");
  }
  keys.clear();
  game.start();
  world.clearEffects();
  world.snapCamera();
  accumulator = 0;
  goTime = 0;
  toastTime = 0;
  lastState = "";
  starting = false;
  (document.activeElement as HTMLElement)?.blur();
}
function pause() {
  game.pause();
  keys.clear();
  audio.setPaused(game.state === "PAUSED");
  accumulator = 0;
}
el("start").addEventListener("click", start);
el("restart").addEventListener("click", start);
el("pause-restart").addEventListener("click", start);
el("resume").addEventListener("click", pause);
el("pause").addEventListener("click", pause);
el("sound").addEventListener("click", () => {
  audio.toggleMute();
  el("sound").textContent = audio.muted ? "◖ SOUND OFF" : "◖ SOUND ON";
  el("sound").setAttribute("aria-pressed", String(!audio.muted));
});
el("music").addEventListener("click", () => {
  audio.toggleMusic();
  el("music").textContent = audio.musicEnabled ? "♫ MUSIC ON" : "♫ MUSIC OFF";
  el("music").setAttribute("aria-pressed", String(audio.musicEnabled));
});
el("quality").addEventListener("click", () => {
  world.toggleQuality();
  el("quality").textContent = world.quality ? "HIGH QUALITY" : "LITE QUALITY";
  el("quality").setAttribute("aria-pressed", String(world.quality));
});
el("track-length").textContent = (game.track.length / 1000).toFixed(2);
const controlCodes = [
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ShiftLeft",
  "ShiftRight",
  "ControlLeft",
  "ControlRight",
  "KeyR",
  "Escape",
  "Enter",
];
window.addEventListener("keydown", (e) => {
  if (controlCodes.includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (
    e.code === "Enter" &&
    (game.state === "READY" || game.state === "FINISHED")
  )
    void start();
  if (e.code === "Escape") pause();
  if (e.code === "KeyR" && game.state === "RACING") {
    game.respawn(game.karts[0]);
    world.snapCamera();
    toast("BACK ON TRACK");
  }
});
window.addEventListener("keyup", (e) => {
  if (controlCodes.includes(e.code)) e.preventDefault();
  keys.delete(e.code);
});
window.addEventListener("blur", () => {
  keys.clear();
  if (game.state === "RACING" || game.state === "COUNTDOWN") pause();
});
document.addEventListener("visibilitychange", () => {
  if (
    document.hidden &&
    (game.state === "RACING" || game.state === "COUNTDOWN")
  )
    pause();
});
window.addEventListener("resize", () => world.resize());
function input(): Input {
  return {
    throttle: keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0,
    brake: keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0,
    steer:
      (keys.has("KeyD") || keys.has("ArrowRight") ? 1 : 0) -
      (keys.has("KeyA") || keys.has("ArrowLeft") ? 1 : 0),
    drift: keys.has("ShiftLeft") || keys.has("ShiftRight"),
    boost: keys.has("ControlLeft") || keys.has("ControlRight"),
  };
}
const canvas = el("map") as HTMLCanvasElement,
  ctx = canvas.getContext("2d")!;
const xs = game.track.samples.map((p) => p.x),
  zs = game.track.samples.map((p) => p.z),
  minX = Math.min(...xs),
  minZ = Math.min(...zs),
  maxX = Math.max(...xs),
  maxZ = Math.max(...zs);
const mapScale = Math.min(224 / (maxX - minX), 144 / (maxZ - minZ));
const mapPoint = (x: number, z: number) => [
  130 + (x - (minX + maxX) / 2) * mapScale,
  90 + (z - (minZ + maxZ) / 2) * mapScale,
];
function minimap() {
  ctx.clearRect(0, 0, 260, 180);
  ctx.beginPath();
  game.track.samples.forEach((p, i) => {
    const [x, y] = mapPoint(p.x, p.z);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.strokeStyle = "#ffffff25";
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.strokeStyle = "#b4d9d4";
  ctx.lineWidth = 3;
  ctx.stroke();
  const next = game.track.at(
      (game.karts[0].nextCheckpoint * game.track.length) / 24,
    ),
    [cx, cy] = mapPoint(next.x, next.z);
  ctx.fillStyle = "#ffce55";
  ctx.fillRect(cx - 3, cy - 3, 6, 6);
  for (const k of [...game.karts].reverse()) {
    const [x, y] = mapPoint(k.x, k.z);
    ctx.beginPath();
    ctx.arc(x, y, k.id === 0 ? 5 : 3.1, 0, Math.PI * 2);
    ctx.fillStyle = `#${k.color.toString(16).padStart(6, "0")}`;
    ctx.fill();
    if (k.id === 0) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}
function updateUI() {
  const state = game.state,
    k = game.karts[0],
    position = game.ranking().findIndex((a) => a.id === 0) + 1;
  if (lastState !== state) {
    el("ready").classList.toggle("hidden", state !== "READY");
    el("paused").classList.toggle("hidden", state !== "PAUSED");
    el("finished").classList.toggle("hidden", state !== "FINISHED");
    el("hud").classList.toggle("hidden", state === "READY");
    el("pause").classList.toggle(
      "hidden",
      state === "READY" || state === "FINISHED",
    );
    if (state === "FINISHED") {
      el("finish-place").textContent = ordinal(k.finishPlace);
      el("finish-time").textContent = time(k.finishTime);
      el("finish-best").textContent = time(Math.min(...k.lapTimes));
      el("lap-results").innerHTML = k.lapTimes
        .map(
          (t, i) =>
            `<div><span>LAP ${i + 1}</span><b>${time(t)}</b>${t === Math.min(...k.lapTimes) ? "<em>BEST</em>" : ""}</div>`,
        )
        .join("");
      el("restart").focus();
    }
    if (state === "PAUSED") el("resume").focus();
    lastState = state;
  }
  el("position").textContent = String(k.finished ? k.finishPlace : position);
  el("place-label").textContent =
    position === 1
      ? "SUNSHINE LEADER"
      : position <= 3
        ? "ON THE PODIUM"
        : "CHASE THE SUN";
  el("lap").innerHTML = `${Math.min(3, k.laps + 1)} <small>/ 3</small>`;
  el("time").textContent = time(k.finished ? k.finishTime : game.time);
  el("lap-time").textContent = time(
    k.finished ? k.lapTimes[2] : game.time - k.lapStart,
  );
  el("best").textContent = k.lapTimes.length
    ? time(Math.min(...k.lapTimes))
    : "—";
  el("speed").textContent = String(Math.round(Math.abs(k.speed) * 3.6));
  el("boost-fill").style.width = `${clamp(k.charge, 0, 1) * 100}%`;
  el("boost-label").textContent =
    k.boostTime > 0
      ? "NITRO!"
      : k.drift
        ? "DRIFT CHARGING"
        : k.nitro === 2
          ? "NITRO STORAGE FULL"
          : "DRIFT TO CHARGE";
  el("drift-status").textContent = k.drift
    ? `${Math.round((k.driftAngle * 180) / Math.PI)}° SLIP · ${k.driftDuration.toFixed(1)}s`
    : k.boostTime > 0
      ? `${k.boostTime.toFixed(1)}s BURST`
      : "BUILD YOUR BURST";
  el("nitro-hint").textContent =
    k.nitro > 0 ? `${k.nitro} READY — SEND IT!` : "NITRO BOOST";
  document.querySelector(".boost-card")!.classList.toggle("drifting", k.drift);
  document
    .querySelectorAll(".nitro-slot")
    .forEach((s, i) => s.classList.toggle("charged", i < k.nitro));
  document.body.classList.toggle(
    "boosting",
    k.boostTime > 0 && state === "RACING",
  );
  el("countdown").textContent =
    state === "COUNTDOWN"
      ? String(Math.ceil(game.countdown))
      : state === "RACING" && goTime > 0 && game.time < 1.1
        ? "GO!"
        : "";
  el("countdown").classList.toggle("go", goTime > 0);
  if (k.wrongWay > 1.5 && state === "RACING") {
    el("toast").textContent = "WRONG WAY · R TO RECOVER";
    el("toast").classList.add("show");
  }
  minimap();
}
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (game.state !== "PAUSED" && game.state !== "READY") {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= DT && steps < 6) {
      game.step(input());
      accumulator -= DT;
      steps++;
    }
  } else accumulator = 0;
  for (const event of game.events.splice(0)) {
    audio.cue(event);
    if (event === "go") goTime = 1.05;
    if (event === "charged") toast("ϟ NITRO READY · PRESS CTRL");
    if (event === "boost") toast("ϟ NITRO — FULL SUNSHINE!");
    if (event === "lap" && !game.karts[0].finished)
      toast(
        game.karts[0].laps === 2
          ? "FINAL LAP — MAKE IT SUNNY!"
          : "LAP 2 — KEEP IT ROLLING!",
      );
  }
  if (game.state !== "PAUSED") {
    goTime = Math.max(0, goTime - dt);
    toastTime -= dt;
  }
  if (toastTime <= 0 && game.karts[0].wrongWay < 1.5)
    el("toast").classList.remove("show");
  audio.update(game.karts[0], game.state === "RACING");
  world.update(
    game.state === "PAUSED" ? 0 : dt,
    game.state === "RACING" || game.state === "FINISHED" ? accumulator / DT : 1,
  );
  uiTimer += dt;
  if (uiTimer >= 0.05) {
    updateUI();
    uiTimer = 0;
  }
  requestAnimationFrame(frame);
}
updateUI();
requestAnimationFrame(frame);
// Development inspection surface; absent from the production bundle.
if (import.meta.env.DEV)
  Object.assign(window, { __sunny: { game, world, audio, idle } });
