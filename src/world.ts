import * as T from "three";
import { Game, clamp, angle, type Kart } from "./game.ts";

const materials = new Map<string, T.MeshStandardMaterial>();
function material(color: number, roughness = 0.75) {
  const key = `${color}/${roughness}`;
  if (!materials.has(key))
    materials.set(key, new T.MeshStandardMaterial({ color, roughness }));
  return materials.get(key)!;
}
const box = new T.BoxGeometry(1, 1, 1),
  sphere = new T.SphereGeometry(1, 20, 12),
  cylinder = new T.CylinderGeometry(1, 1, 1, 12),
  roofGeometry = new T.ConeGeometry(1, 1, 4);
function mesh(
  parent: T.Object3D,
  geo: T.BufferGeometry,
  color: number,
  pos: number[],
  scale: number[],
  shadow = false,
) {
  const m = new T.Mesh(geo, material(color));
  m.position.set(...(pos as [number, number, number]));
  m.scale.set(...(scale as [number, number, number]));
  m.castShadow = shadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function label(
  text: string,
  bg: string,
  fg: string,
  width = 512,
  height = 128,
) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = fg;
  ctx.font = `900 ${height * 0.56}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height * 0.53, width * 0.93);
  const texture = new T.CanvasTexture(c);
  texture.colorSpace = T.SRGBColorSpace;
  return new T.MeshBasicMaterial({ map: texture, side: T.DoubleSide });
}

export class World {
  game: Game;
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(64, 1, 0.1, 1300);
  roots: T.Group[] = [];
  bodies: T.Group[] = [];
  wheels: T.Group[][] = [];
  tires: T.Group[][] = [];
  flames: T.Mesh[][] = [];
  steeringWheels: T.Mesh[] = [];
  startLights: T.Mesh[] = [];
  windmill = new T.Group();
  sun = new T.DirectionalLight(0xffdfb0, 3.1);
  target = new T.Vector3();
  camPos = new T.Vector3();
  desired = new T.Vector3();
  look = new T.Vector3();
  boostBlend = 0;
  clock = 0;
  quality = true;
  particleCount = 320;
  particleIndex = 0;
  positions = new Float32Array(320 * 3);
  colors = new Float32Array(320 * 3);
  life = new Float32Array(320);
  vel = new Float32Array(320 * 3);
  sizes = new Float32Array(320);
  opacity = new Float32Array(320);
  maxLife = new Float32Array(320);
  effectTimers = new Float32Array(6);
  lastHits = new Float32Array(6);
  celebrated = false;
  particles: T.Points;
  skids: T.InstancedMesh;
  skidIndex = 0;
  skidTimer = 0;
  dummy = new T.Object3D();
  constructor(game: Game, container: HTMLElement) {
    this.game = game;
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.scene.background = new T.Color(0xbadfe5);
    this.scene.fog = new T.Fog(0xbadfe5, 210, 850);
    this.scene.add(new T.HemisphereLight(0xc6e8ff, 0x708763, 1.65));
    const sky = new T.Mesh(new T.SphereGeometry(1100, 24, 16), new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false,
      uniforms: { horizon: { value: new T.Color(0xbadfe5) }, zenith: { value: new T.Color(0x69bcea) } },
      vertexShader: `varying float elevation; void main() { elevation = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform vec3 horizon;
        uniform vec3 zenith;
        varying float elevation;
        void main() {
          gl_FragColor = vec4(mix(horizon, zenith, smoothstep(0.0, 0.65, elevation)), 1.0);
          #include <colorspace_fragment>
        }`,
    }));
    this.scene.add(sky);
    this.sun.position.set(-65, 110, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -60;
    this.sun.shadow.camera.right = 60;
    this.sun.shadow.camera.top = 60;
    this.sun.shadow.camera.bottom = -60;
    this.sun.shadow.camera.far = 300;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.07;
    this.scene.add(this.sun, this.sun.target);
    this.buildTrack();
    this.scenery();
    this.landmarks();
    this.batchScenery();
    for (const k of game.karts) this.buildKart(k);
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(this.positions, 3));
    geo.setAttribute("color", new T.BufferAttribute(this.colors, 3));
    geo.setAttribute("size", new T.BufferAttribute(this.sizes, 1));
    geo.setAttribute("opacity", new T.BufferAttribute(this.opacity, 1));
    this.positions.fill(-1000);
    this.particles = new T.Points(
      geo,
      new T.ShaderMaterial({
        uniforms: { height: { value: innerHeight * this.renderer.getPixelRatio() } },
        vertexShader: `
          attribute vec3 color;
          attribute float size;
          attribute float opacity;
          uniform float height;
          varying vec3 tint;
          varying float fade;
          void main() {
            vec4 p = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * p;
            gl_PointSize = clamp(size * height / max(1.0, -p.z), 1.0, 96.0);
            tint = color; fade = opacity;
          }`,
        fragmentShader: `
          varying vec3 tint;
          varying float fade;
          void main() {
            float d = length(gl_PointCoord - 0.5) * 2.0;
            if (d > 1.0) discard;
            gl_FragColor = vec4(tint, (1.0 - smoothstep(0.05, 1.0, d)) * fade);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
    this.skids = new T.InstancedMesh(
      new T.PlaneGeometry(0.23, 0.95),
      new T.MeshBasicMaterial({
        color: 0x263541,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
      320,
    );
    this.skids.frustumCulled = false;
    this.dummy.scale.set(0, 0, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < 320; i++) this.skids.setMatrixAt(i, this.dummy.matrix);
    this.scene.add(this.skids);
    this.dummy.scale.set(1, 1, 1);
    this.resize();
    this.snapCamera();
  }
  surface(color: number, grass = false) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const ctx = c.getContext("2d")!, data = ctx.createImageData(128, 128);
    let seed = 19;
    for (let i = 0; i < data.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const shade = 210 + (seed % 42);
      data.data[i] = data.data[i + 1] = data.data[i + 2] = shade;
      data.data[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
    const texture = new T.CanvasTexture(c);
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    if (grass) texture.repeat.set(350, 350);
    return new T.MeshStandardMaterial({ color, map: texture, roughness: 0.95 });
  }
  strip(
    inner: number,
    outer: number,
    color: number,
    y: number,
    alternating = false,
  ) {
    const vertices: number[] = [],
      indices: number[] = [],
      colors: number[] = [];
    const n = this.game.track.count;
    const ca = new T.Color(color),
      cb = new T.Color(0xfff9e7);
    for (let i = 0; i < n; i++) {
      const a = this.game.track.samples[i],
        b = this.game.track.samples[(i + 1) % n],
        base = vertices.length / 3;
      for (const [p, w] of [
        [a, inner],
        [a, outer],
        [b, inner],
        [b, outer],
      ] as const) {
        vertices.push(p.x + p.nx * w, y, p.z + p.nz * w);
        const c = alternating && Math.floor(i / 3) % 2 ? cb : ca;
        colors.push(c.r, c.g, c.b);
      }
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
    g.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    if (color === 0x526c78) {
      const uv: number[] = [];
      for (let i = 0; i < vertices.length; i += 3) uv.push(vertices[i] / 9, vertices[i + 2] / 9);
      g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    }
    const m = new T.Mesh(
      g,
      color === 0x526c78 ? this.surface(0x465663) : new T.MeshStandardMaterial({
        vertexColors: true,
        roughness: 1,
        side: T.DoubleSide,
      }),
    );
    m.receiveShadow = true;
    this.scene.add(m);
  }
  buildTrack() {
    const ground = mesh(this.scene, box, 0x8abc72, [150, -0.55, 0], [2200, 1, 2200]);
    ground.material = this.surface(0x88b966, true);
    const w = this.game.track.width / 2;
    this.strip(-w - 1.3, w + 1.3, 0xd8c995, 0.002);
    this.strip(-w, w, 0x526c78, 0.025);
    for (const side of [-1, 1]) {
      this.strip(side * w, side * (w + 0.85), 0xff7580, 0.04, true);
      this.strip(side * (w - 0.35), side * (w - 0.19), 0xfff9e7, 0.046);
    }
    const n = Math.ceil(this.game.track.length / 5),
      walls = new T.InstancedMesh(box, material(0xeef4df), n * 2),
      posts = new T.InstancedMesh(box, material(0x388d96), n * 2);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < 2; j++) {
        const p = this.game.track.at((i / n) * this.game.track.length),
          side = j ? 1 : -1;
        this.dummy.position.set(
          p.x + p.nx * (w + 1.35) * side,
          0.87,
          p.z + p.nz * (w + 1.35) * side,
        );
        this.dummy.rotation.set(0, p.yaw, 0);
        this.dummy.scale.set(0.28, 0.45, this.game.track.length / n + 0.15);
        this.dummy.updateMatrix();
        walls.setMatrixAt(i * 2 + j, this.dummy.matrix);
        this.dummy.scale.set(0.5, 1.45, 0.5);
        this.dummy.position.y = 0.68;
        this.dummy.updateMatrix();
        posts.setMatrixAt(i * 2 + j, this.dummy.matrix);
      }
    walls.receiveShadow = true;
    this.scene.add(walls, posts);
    // Hand-painted style center dashes, kept sparse so corners remain readable.
    const dashes = new T.InstancedMesh(
      box,
      material(0xc6d5d3),
      Math.floor(this.game.track.length / 16),
    );
    for (let i = 0; i < dashes.count; i++) {
      const p = this.game.track.at(i * 16);
      this.dummy.position.set(p.x, 0.04, p.z);
      this.dummy.rotation.set(0, p.yaw, 0);
      this.dummy.scale.set(0.14, 0.01, 3.5);
      this.dummy.updateMatrix();
      dashes.setMatrixAt(i, this.dummy.matrix);
    }
    this.scene.add(dashes);
    const start = new T.Group(),
      p = this.game.track.at(0);
    start.position.set(p.x, 0, p.z);
    start.rotation.y = p.yaw;
    this.scene.add(start);
    for (let x = -8; x < 8; x++)
      for (let z = 0; z < 2; z++)
        mesh(
          start,
          box,
          (x + z) % 2 ? 0xfff9e7 : 0x293f49,
          [x + 0.5, 0.06, z - 0.5],
          [1, 0.035, 1],
        );
    for (const x of [-10, 10]) {
      mesh(start, box, 0xffc641, [x, 4, 0], [1.15, 8, 1.2], true);
      mesh(start, box, 0x267e8e, [x, 0.8, 0], [1.65, 1.6, 1.6]);
      mesh(start, sphere, 0xff7485, [x, 8.25, 0], [0.85, 0.85, 0.85]);
    }
    mesh(start, box, 0xffc641, [0, 7.5, 0], [21, 2, 1.05], true);
    const sign = new T.Mesh(
      new T.PlaneGeometry(16, 1.8),
      label("SUNNY KARTS", "#ffca55", "#1a4750"),
    );
    sign.position.set(0, 7.55, -0.54);
    sign.rotation.y = Math.PI;
    start.add(sign);
    const back = sign.clone();
    back.position.z = 0.54;
    back.rotation.y = 0;
    start.add(back);
    mesh(start, box, 0x244958, [0, 5.92, 0], [5.5, 0.85, 0.65]);
    for (let i = 0; i < 3; i++) {
      const light = new T.Mesh(sphere, new T.MeshBasicMaterial({ color: 0x546269 }));
      light.position.set((i - 1) * 1.5, 5.95, -0.4);
      light.scale.set(0.3, 0.3, 0.12);
      light.userData.animated = true;
      start.add(light);
      this.startLights.push(light);
    }
    for (let i = 0; i < 6; i++) {
      const q = this.game.track.at(
        this.game.track.length - 14 - Math.floor(i / 2) * 6,
      );
      const mark = mesh(
        this.scene,
        box,
        0xe7eee3,
        [
          q.x + q.nx * (i % 2 ? 2.8 : -2.8),
          0.055,
          q.z + q.nz * (i % 2 ? 2.8 : -2.8),
        ],
        [2.7, 0.015, 0.16],
      );
      mark.rotation.y = q.yaw;
    }
    for (let s = 70; s < this.game.track.length; s += 75) {
      const p = this.game.track.at(s),
        q = this.game.track.at(s + 22),
        curve = angle(q.yaw - p.yaw);
      if (Math.abs(curve) < 0.18) continue;
      const side = curve > 0 ? -1 : 1,
        g = new T.Group();
      g.position.set(p.x + p.nx * 11.8 * side, 0, p.z + p.nz * 11.8 * side);
      g.rotation.y = p.yaw + Math.PI;
      this.scene.add(g);
      mesh(g, box, 0x318890, [0, 1.9, 0], [0.22, 3.8, 0.22]);
      const arrow = new T.Mesh(
        new T.PlaneGeometry(4.4, 1.75),
        label(curve > 0 ? "› › ›" : "‹ ‹ ‹", "#ffcf64", "#244f5c"),
      );
      arrow.position.y = 3.1;
      g.add(arrow);
    }
  }
  scenery() {
    let seed = 5381;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const trunks: T.Matrix4[] = [],
      tops: T.Matrix4[] = [],
      colors: T.Color[] = [];
    for (let i = 0; i < 260; i++) {
      const s = rand() * this.game.track.length,
        p = this.game.track.at(s),
        side = rand() > 0.5 ? 1 : -1,
        d = 17 + rand() * 55;
      const x = p.x + p.nx * d * side,
        z = p.z + p.nz * d * side;
      if (Math.abs(this.game.track.nearest(x, z).lateral) < 13) continue;
      const h = 3.2 + rand() * 4;
      this.dummy.position.set(x, h * 0.28, z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.set(0.35, h * 0.6, 0.35);
      this.dummy.updateMatrix();
      trunks.push(this.dummy.matrix.clone());
      this.dummy.position.y = h * 0.85;
      this.dummy.scale.set(h * 0.48, h * 0.66, h * 0.48);
      this.dummy.updateMatrix();
      tops.push(this.dummy.matrix.clone());
      colors.push(
        new T.Color().setHSL(0.24 + rand() * 0.11, 0.42, 0.39 + rand() * 0.13),
      );
    }
    const ti = new T.InstancedMesh(cylinder, material(0xa78056), trunks.length),
      leaves = new T.InstancedMesh(
        new T.IcosahedronGeometry(1, 1),
        material(0xffffff),
        tops.length,
      );
    trunks.forEach((m, i) => ti.setMatrixAt(i, m));
    tops.forEach((m, i) => {
      leaves.setMatrixAt(i, m);
      leaves.setColorAt(i, colors[i]);
    });
    this.scene.add(ti, leaves);
    leaves.castShadow = true;
    for (let i = 0; i < 35; i++) {
      const p = this.game.track.at((i / 35) * this.game.track.length + 30),
        side = i % 2 ? 1 : -1,
        d = 25 + (i % 3) * 12;
      const x = p.x + p.nx * d * side,
        z = p.z + p.nz * d * side;
      if (Math.abs(this.game.track.nearest(x, z).lateral) < 17) continue;
      const g = new T.Group();
      g.position.set(x, 0, z);
      g.rotation.y = p.yaw + (side * Math.PI) / 2;
      this.scene.add(g);
      const h = 4 + (i % 3) * 1.1,
        w = 6 + (i % 3),
        palette = [0xffe8b5, 0xf7c3ac, 0xc0e6d5, 0xf3d2de, 0xbad8e7];
      mesh(g, box, palette[i % 5], [0, h / 2, 0], [w, h, 6], true);
      const roof = mesh(
        g,
        roofGeometry,
        [0xef8877, 0x508b9b, 0xeac17c][i % 3],
        [0, h + 1.5, 0],
        [w * 0.85, 3, 5.1],
      );
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      mesh(g, box, 0x5e8e9a, [0, 1.25, 3.02], [1.3, 2.5, 0.08]);
      for (const a of [-1, 1]) {
        mesh(g, box, 0xfff7df, [a * w * 0.3, h * 0.62, 3.04], [1.5, 1.65, 0.1]);
        mesh(g, box, 0x77adbd, [a * w * 0.3, h * 0.62, 3.1], [1.18, 1.3, 0.06]);
        mesh(
          g,
          box,
          0xfff7df,
          [a * w * 0.3, h * 0.62, 3.15],
          [0.09, 1.3, 0.05],
        );
      }
      mesh(g, box, 0xe8b18e, [w * 0.25, h + 1.5, -1], [0.7, 3, 0.8]);
    }
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2,
        r = 470 + rand() * 230;
      mesh(
        this.scene,
        new T.IcosahedronGeometry(1, 2),
        [0x95bd92, 0x93bb9a, 0xa3cbb2][i % 3],
        [160 + Math.cos(a) * r, 5, Math.sin(a) * r],
        [100 + rand() * 80, 35 + rand() * 65, 100 + rand() * 80],
      );
    }
    for (let i = 0; i < 24; i++) {
      const g = new T.Group();
      g.position.set(
        -400 + rand() * 1200,
        95 + rand() * 85,
        -400 + rand() * 1100,
      );
      this.scene.add(g);
      for (let j = 0; j < 3; j++)
        mesh(g, sphere, 0xfffcf3, [j * 12, Math.sin(j) * 3, 0], [15, 7 + j, 9]);
    }
    // Village bunting across the long straight.
    for (const s of [100, 750, 1210]) {
      const p = this.game.track.at(s),
        g = new T.Group();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = p.yaw;
      this.scene.add(g);
      for (const side of [-1, 1])
        mesh(g, cylinder, 0xebd7a4, [side * 10, 4.8, 0], [0.15, 9.6, 0.15]);
      mesh(g, box, 0x5d7e83, [0, 8.3, 0], [20, 0.055, 0.055]);
      for (let j = 0; j < 13; j++) {
        const geo = new T.BufferGeometry();
        geo.setAttribute(
          "position",
          new T.Float32BufferAttribute([-0.6, 0, 0, 0.6, 0, 0, 0, -1.15, 0], 3),
        );
        geo.computeVertexNormals();
        const flag = new T.Mesh(
          geo,
          new T.MeshStandardMaterial({
            color: [0xffce55, 0xff8793, 0x69c8c6][j % 3],
            side: T.DoubleSide,
          }),
        );
        flag.position.set(-9 + j * 1.5, 8.3, 0);
        g.add(flag);
      }
    }
  }
  landmarks() {
    const palette = [0xffc641, 0xf58392, 0x64c6c3, 0xa597e5];
    const place = (s: number, offset = 0) => {
      const p = this.game.track.at(s), g = new T.Group();
      g.position.set(p.x + p.nx * offset, 0, p.z + p.nz * offset);
      g.rotation.y = p.yaw;
      this.scene.add(g);
      return g;
    };
    // Trackside lamps and pennants give a regular, readable sense of speed.
    for (let s = 22; s < this.game.track.length; s += 45) {
      const g = place(s, (Math.floor(s / 45) % 2 ? 1 : -1) * 12);
      mesh(g, cylinder, 0x31566a, [0, 2.8, 0], [0.13, 5.6, 0.13]);
      mesh(g, box, 0xffe3a4, [0, 5.5, 0], [0.7, 0.3, 0.7]);
      mesh(g, box, palette[Math.floor(s / 45) % 4], [0.6, 4.1, 0], [1.1, 1.8, 0.08]);
      mesh(g, box, 0xfff6df, [0.6, 4.1, -0.05], [0.13, 1.1, 0.02]);
    }
    for (const side of [-1, 1]) {
      const stand = place(20, side * 21);
      stand.rotation.y += side * Math.PI / 2;
      for (let row = 0; row < 3; row++) {
        mesh(stand, box, 0x58959b, [0, 0.45 + row * 0.65, -row * 1.3], [15, 0.7, 1.5]);
        for (let i = 0; i < 12; i++) {
          const x = -6.6 + i * 1.2, y = 1.2 + row * 0.65;
          mesh(stand, sphere, palette[(i + row) % 4], [x, y, -row * 1.3], [0.35, 0.5, 0.3]);
          mesh(stand, sphere, 0xffedce, [x, y + 0.55, -row * 1.3], [0.28, 0.28, 0.28]);
        }
      }
      for (const x of [-8, 8]) mesh(stand, cylinder, 0xffda83, [x, 3.5, -1], [0.15, 7, 0.15]);
      mesh(stand, box, 0xf58392, [0, 6.5, -1], [17, 0.3, 5]);
    }
    const mill = place(375, -29);
    mesh(mill, cylinder, 0xffe6bd, [0, 6, 0], [3.4, 12, 3.4]);
    mesh(mill, roofGeometry, 0xed8678, [0, 14, 0], [5.1, 5, 5.1]);
    this.windmill.position.set(0, 11, -3.6);
    mill.add(this.windmill);
    for (let i = 0; i < 4; i++) {
      const blade = new T.Group();
      blade.rotation.z = i * Math.PI / 2 + 0.35;
      this.windmill.add(blade);
      const arm = mesh(blade, box, 0x476b76, [0, 4, 0], [0.25, 8, 0.25]);
      const sail = mesh(blade, box, 0xfff4d9, [0.6, 5.5, -0.12], [1.5, 4.5, 0.12]);
      arm.userData.animated = sail.userData.animated = true;
    }
    const hub = mesh(this.windmill, sphere, 0xffc641, [0, 0, -0.3], [0.65, 0.65, 0.5]);
    hub.userData.animated = true;
    // A market district on the fast section, kept outside both road edges.
    for (let i = 0; i < 7; i++) {
      const market = place(840 + i * 9, -16);
      market.rotation.y += Math.PI / 2;
      mesh(market, box, 0xffefcf, [0, 1.1, 0], [6, 2.2, 3]);
      mesh(market, box, palette[i % 4], [0, 3.7, 0], [6.8, 0.4, 4]);
      for (let j = 0; j < 7; j++) {
        mesh(market, box, j % 2 ? 0xfff5dd : palette[i % 4], [-3 + j, 3.2, 1.9], [0.95, 0.8, 0.12]);
        mesh(market, sphere, [0xffa54e, 0xff6f78, 0xa8cf62][j % 3], [-2.3 + j * 0.75, 2.3, 0.7], [0.35, 0.35, 0.35]);
      }
      for (const x of [-2.8, 2.8]) mesh(market, cylinder, 0x506b68, [x, 2.1, 1.4], [0.1, 4.2, 0.1]);
    }
    for (let i = 0; i < 5; i++) {
      const balloon = place(1290 + i * 29, (i % 2 ? 1 : -1) * (27 + i * 5));
      const h = 20 + i * 6;
      mesh(balloon, sphere, palette[i % 4], [0, h, 0], [5, 6.5, 5]);
      mesh(balloon, sphere, 0xfff2cb, [0, h, -0.5], [1.5, 6.55, 4.9]);
      mesh(balloon, box, 0xb78754, [0, h - 9, 0], [2.4, 1.6, 2.4]);
      for (const side of [-1, 1]) mesh(balloon, cylinder, 0x8b7664, [side, h - 7, 0], [0.055, 3, 0.055]);
    }
    for (const [s, title, color] of [
      [335, "SUNFLOWER BEND", "#ffd66b"],
      [815, "VILLAGE MARKET", "#ff9bad"],
      [1265, "SKY PARADE", "#94e4df"],
    ] as const) {
      const g = place(s, -13.5);
      mesh(g, cylinder, 0x446b77, [0, 2.8, 0], [0.15, 5.6, 0.15]);
      const board = new T.Mesh(new T.PlaneGeometry(7, 1.6), label(title, color, "#214c58"));
      board.position.y = 4.9;
      board.rotation.y = Math.PI;
      g.add(board);
    }
  }
  batchScenery() {
    // Batch only immutable props; 100m cells retain useful frustum culling.
    const groups = new Map<string, T.Mesh[]>();
    this.scene.updateMatrixWorld(true);
    this.scene.traverse((o) => {
      if (!(o instanceof T.Mesh) || o instanceof T.InstancedMesh || o.userData.animated || Array.isArray(o.material)) return;
      const p = this.desired.setFromMatrixPosition(o.matrixWorld);
      const key = `${o.geometry.uuid}/${o.material.uuid}/${o.castShadow}/${o.receiveShadow}/${Math.floor(p.x / 100)}/${Math.floor(p.z / 100)}`;
      const items = groups.get(key) ?? [];
      items.push(o); groups.set(key, items);
    });
    for (const items of groups.values()) {
      if (items.length < 3) continue;
      const first = items[0], batch = new T.InstancedMesh(first.geometry, first.material, items.length);
      batch.name = "static-prop-batch";
      batch.castShadow = first.castShadow;
      batch.receiveShadow = first.receiveShadow;
      items.forEach((o, i) => { batch.setMatrixAt(i, o.matrixWorld); o.removeFromParent(); });
      batch.computeBoundingSphere();
      this.scene.add(batch);
    }
  }
  buildKart(k: Kart) {
    const root = new T.Group(),
      body = new T.Group();
    root.add(body);
    this.scene.add(root);
    this.roots.push(root);
    this.bodies.push(body);
    const paint = new T.MeshPhysicalMaterial({ color: k.color, roughness: 0.28, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.2 });
    mesh(body, box, 0x263c49, [0, 0.5, 0], [1.65, 0.27, 2.4], true);
    mesh(body, sphere, k.color, [0, 0.82, 0.16], [0.99, 0.43, 1.36], true);
    mesh(body, sphere, k.color, [0, 0.95, 1.02], [0.87, 0.32, 0.63], true);
    mesh(body, box, 0xfff5d8, [0, 1.21, 0.99], [0.24, 0.06, 0.95]);
    mesh(body, box, 0x344d5a, [0, 0.55, 1.5], [1.95, 0.3, 0.32], true);
    mesh(body, box, 0x344d5a, [0, 0.55, -1.35], [1.9, 0.28, 0.3], true);
    for (const side of [-1, 1]) {
      mesh(body, sphere, k.color, [side * 0.78, 0.75, -0.2], [0.32, 0.3, 0.95], true);
      mesh(body, box, 0xfff4d5, [side * 0.91, 0.8, -0.15], [0.04, 0.13, 0.85]);
      mesh(body, cylinder, 0x3b5361, [side * 0.7, 1.1, -1.15], [0.08, 0.65, 0.08]);
      mesh(body, box, 0xff6272, [side * 0.67, 0.88, -1.48], [0.3, 0.14, 0.08]);
    }
    mesh(body, box, k.color, [0, 1.42, -1.14], [1.95, 0.12, 0.45], true);
    mesh(body, box, 0xfff4d5, [0, 1.49, -1.14], [0.25, 0.025, 0.44]);
    for (const side of [-1, 1])
      mesh(
        body,
        sphere,
        0xfff5bd,
        [side * 0.62, 0.95, 1.38],
        [0.19, 0.13, 0.1],
      );
    mesh(body, box, 0x374d5d, [0, 1.05, -0.56], [0.91, 1.05, 0.33], true);
    mesh(body, box, 0x445e6b, [0, 0.94, -0.12], [0.83, 0.21, 0.8]);
    const wheelGeo = new T.CylinderGeometry(0.43, 0.43, 0.36, 14),
      rimGeo = new T.CylinderGeometry(0.23, 0.23, 0.38, 12);
    const wheels: T.Group[] = [],
      tires: T.Group[] = [];
    for (const z of [-0.88, 0.89])
      for (const side of [-1, 1]) {
        const mount = new T.Group();
        mount.position.set(side * 1.02, 0.43, z);
        root.add(mount);
        wheels.push(mount);
        const roll = new T.Group();
        mount.add(roll);
        tires.push(roll);
        const tire = new T.Mesh(wheelGeo, material(0x172733, 0.92));
        tire.rotation.z = Math.PI / 2;
        tire.castShadow = true;
        roll.add(tire);
        const rimMaterial = material(0xcbd9df, 0.28);
        rimMaterial.metalness = 0.55;
        const rim = new T.Mesh(rimGeo, rimMaterial);
        rim.rotation.z = Math.PI / 2;
        roll.add(rim);
        mesh(roll, box, k.color, [side * 0.205, 0, 0], [0.02, 0.34, 0.08]);
      }
    this.wheels.push(wheels);
    this.tires.push(tires);
    const steering = mesh(
      body,
      new T.TorusGeometry(0.26, 0.045, 6, 14),
      0x304656,
      [0, 1.35, 0.43],
      [1, 1, 1],
    );
    steering.rotation.x = -0.5;
    this.steeringWheels.push(steering);
    // Original marshmallow pilot: round helmet, dark visor, tiny scarf.
    mesh(body, sphere, 0xf3f0df, [0, 1.5, -0.23], [0.43, 0.52, 0.33], true);
    for (const side of [-1, 1]) {
      const arm = mesh(
        body,
        sphere,
        k.color,
        [side * 0.4, 1.4, 0.15],
        [0.15, 0.18, 0.4],
        true,
      );
      arm.rotation.x = -0.3;
      mesh(
        body,
        sphere,
        0xfff4df,
        [side * 0.34, 1.43, 0.43],
        [0.16, 0.15, 0.16],
      );
    }
    mesh(body, sphere, 0xfff7e5, [0, 2.12, -0.17], [0.58, 0.59, 0.53], true);
    mesh(body, sphere, k.color, [0, 2.33, -0.22], [0.59, 0.42, 0.52], true);
    mesh(body, sphere, 0x285665, [0, 2.13, 0.24], [0.46, 0.2, 0.19]);
    mesh(body, sphere, 0xafdfdf, [-0.18, 2.2, 0.385], [0.13, 0.045, 0.026]);
    mesh(body, box, 0xff776a, [0, 1.7, -0.62], [0.65, 0.15, 0.3]);
    const flames: T.Mesh[] = [];
    for (const side of [-1, 1]) {
      const exhaust = mesh(
        body,
        cylinder,
        0x607b85,
        [side * 0.6, 0.66, -1.42],
        [0.17, 0.45, 0.17],
      );
      exhaust.rotation.x = Math.PI / 2;
      const flame = new T.Mesh(
        new T.ConeGeometry(0.24, 1, 10),
        new T.MeshBasicMaterial({ color: 0x73edff }),
      );
      flame.rotation.x = -Math.PI / 2;
      flame.position.set(side * 0.6, 0.66, -2);
      flame.visible = false;
      body.add(flame);
      flames.push(flame);
    }
    this.flames.push(flames);
    body.traverse((o) => {
      if (o instanceof T.Mesh && o.material instanceof T.MeshStandardMaterial && o.material.color.getHex() === k.color)
        o.material = paint;
    });
    if (k.id > 0) {
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 64;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#244854dd";
      ctx.beginPath();
      ctx.roundRect(0, 0, 256, 64, 24);
      ctx.fill();
      ctx.fillStyle = "#fff8e9";
      ctx.font = "bold 29px Arial";
      ctx.textAlign = "center";
      ctx.fillText(k.name, 128, 43);
      const tex = new T.CanvasTexture(c);
      tex.colorSpace = T.SRGBColorSpace;
      const sprite = new T.Sprite(
        new T.SpriteMaterial({ map: tex, depthTest: true, transparent: true }),
      );
      sprite.position.y = 3.7;
      sprite.scale.set(2.5, 0.625, 1);
      root.add(sprite);
    }
  }
  emit(x: number, y: number, z: number, kind: "smoke" | "boost" | "dust" | "spark" | "confetti") {
    const i = this.particleIndex++ % this.particleCount;
    const boost = kind === "boost", spark = kind === "spark", confetti = kind === "confetti";
    this.life[i] = this.maxLife[i] = boost ? 0.3 : spark ? 0.24 : confetti ? 2.2 : 0.85;
    this.sizes[i] = boost ? 0.22 : spark || confetti ? 0.075 : 0.38;
    this.opacity[i] = 0.7;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.vel[i * 3] = (Math.random() - 0.5) * (spark || confetti ? 12 : 2);
    this.vel[i * 3 + 1] = confetti ? 7 + Math.random() * 5 : spark ? 3 : boost ? 0.2 : 1.1;
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * (spark || confetti ? 12 : 2);
    const c = new T.Color(boost ? 0x66eaff : spark ? 0xffc85b : confetti ? [0xffc641, 0xff7793, 0x74eeed][i % 3] : kind === "dust" ? 0xd9bd8a : 0xf4f4f0);
    this.colors[i * 3] = c.r;
    this.colors[i * 3 + 1] = c.g;
    this.colors[i * 3 + 2] = c.b;
  }
  clearEffects() {
    this.life.fill(0);
    this.opacity.fill(0);
    this.positions.fill(-1000);
    this.particleIndex = 0;
    this.effectTimers.fill(0);
    this.lastHits.fill(0);
    this.celebrated = false;
    this.boostBlend = 0;
    this.skidIndex = 0;
    this.skidTimer = 0;
    this.dummy.scale.set(0, 0, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < 320; i++) this.skids.setMatrixAt(i, this.dummy.matrix);
    this.skids.instanceMatrix.needsUpdate = true;
    this.dummy.scale.set(1, 1, 1);
  }
  snapCamera() {
    const k = this.game.karts[0];
    this.camPos.set(k.x - Math.sin(k.yaw) * 8.5, 4.3, k.z - Math.cos(k.yaw) * 8.5);
    this.camera.position.copy(this.camPos);
    this.target.set(k.x + Math.sin(k.yaw) * 5, 1.2, k.z + Math.cos(k.yaw) * 5);
    this.boostBlend = 0;
  }
  update(dt: number, alpha: number) {
    this.clock += dt;
    this.skidTimer += dt;
    const active =
      this.game.state === "RACING" || this.game.state === "FINISHED";
    this.windmill.rotation.z += dt * 0.24;
    this.startLights.forEach((light, i) => {
      const on = this.game.state === "COUNTDOWN" && this.game.countdown <= 3 - i;
      (light.material as T.MeshBasicMaterial).color.setHex(active ? 0x89ffc2 : on ? 0xff7468 : 0x546269);
    });
    for (const k of this.game.karts) {
      const root = this.roots[k.id];
      root.position.set(
        k.prevX + (k.x - k.prevX) * alpha,
        0,
        k.prevZ + (k.z - k.prevZ) * alpha,
      );
      root.rotation.y = k.prevYaw + angle(k.yaw - k.prevYaw) * alpha;
      this.bodies[k.id].rotation.z +=
        (k.steer * (k.drift ? -0.12 : -0.06) - this.bodies[k.id].rotation.z) *
        Math.min(1, dt * 12);
      this.bodies[k.id].rotation.x +=
        (clamp(k.longitudinalAcceleration * 0.003, -0.065, 0.05) - this.bodies[k.id].rotation.x) * (1 - Math.exp(-dt * 10));
      this.steeringWheels[k.id].rotation.z = -k.steer * 0.5;
      this.bodies[k.id].position.y = active
        ? Math.sin(this.clock * 20 + k.id) * 0.014 * Math.min(1, k.speed / 10)
        : 0;
      this.wheels[k.id].forEach((w, i) => {
        if (i > 1) w.rotation.y = k.steer * 0.42;
        this.tires[k.id][i].rotation.x -= (k.speed * dt) / 0.43;
      });
      this.flames[k.id].forEach((f) => {
        f.visible = k.boostTime > 0 && active;
        f.scale.y = 1 + Math.sin(this.clock * 47) * 0.2;
      });
      const dust = Math.abs(k.lateral) > this.game.track.width / 2 - 1.4 && k.speed > 8;
      const emitting = active && (k.drift || k.boostTime > 0 || dust);
      if (emitting) this.effectTimers[k.id] += dt * (k.boostTime > 0 ? 70 : 16 + 42 * k.driftQuality);
      else this.effectTimers[k.id] = 0;
      const bursts = dt > 0 ? Math.floor(this.effectTimers[k.id] + 0.00001) : 0;
      this.effectTimers[k.id] -= bursts;
      if (emitting && dt > 0)
        for (const side of [-1, 1]) {
          const x = k.x - Math.sin(k.yaw) * 1.15 + Math.cos(k.yaw) * side * 0.8,
            z = k.z - Math.cos(k.yaw) * 1.15 - Math.sin(k.yaw) * side * 0.8;
          for (let n = 0; n < bursts; n++) this.emit(x, 0.45, z, k.boostTime > 0 ? "boost" : dust ? "dust" : "smoke");
          if (k.drift && this.skidTimer > 0.055) {
            this.dummy.position.set(x, 0.06, z);
            this.dummy.rotation.set(-Math.PI / 2, 0, -k.moveYaw);
            this.dummy.scale.set(1, 1, 1);
            this.dummy.updateMatrix();
            this.skids.setMatrixAt(this.skidIndex++ % 320, this.dummy.matrix);
            this.skids.instanceMatrix.needsUpdate = true;
          }
        }
      if (active && dt > 0 && k.hit > this.lastHits[k.id] + 0.1)
        for (let n = 0; n < 12; n++) this.emit(k.x + Math.sin(k.yaw), 0.5, k.z + Math.cos(k.yaw), "spark");
      this.lastHits[k.id] = k.hit;
    }
    if (this.game.state === "FINISHED" && !this.celebrated && dt > 0) {
      this.celebrated = true;
      const k = this.game.karts[0];
      for (let i = 0; i < 100; i++) this.emit(k.x + (i % 2 ? 4 : -4), 2, k.z, "confetti");
    }
    if (this.skidTimer > 0.055) this.skidTimer = 0;
    for (let i = 0; i < this.particleCount; i++) {
      if (this.life[i] > 0) {
        this.life[i] -= dt;
        this.opacity[i] = Math.max(0, this.life[i] / this.maxLife[i]) * 0.7;
        this.sizes[i] += dt * (this.maxLife[i] > 0.7 && this.maxLife[i] < 1 ? 0.6 : 0.08);
        if (this.maxLife[i] > 1 || this.maxLife[i] < 0.3) this.vel[i * 3 + 1] -= dt * 9;
        for (let j = 0; j < 3; j++)
          this.positions[i * 3 + j] += this.vel[i * 3 + j] * dt;
        if (this.life[i] <= 0) this.positions[i * 3 + 1] = -1000;
      }
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.color.needsUpdate = true;
    this.particles.geometry.attributes.size.needsUpdate = true;
    this.particles.geometry.attributes.opacity.needsUpdate = true;
    const k = this.game.karts[0],
      ready = this.game.state === "READY";
    this.boostBlend += ((k.boostTime > 0 ? 1 : 0) - this.boostBlend) * (1 - Math.exp(-dt * 5));
    const root = this.roots[0], x = root.position.x, z = root.position.z;
    const followYaw = root.rotation.y - angle(k.yaw - k.moveYaw) * 0.55;
    const back = ready ? 19 : 8.1 + clamp(k.speed / 40, 0, 1) * 0.8 + this.boostBlend * 1.25,
      height = ready ? 10.5 : 4.2;
    this.desired.set(
      x - Math.sin(followYaw) * back + (ready ? -11 : Math.cos(followYaw) * k.steer * 0.3),
      height,
      z - Math.cos(followYaw) * back,
    );
    this.camPos.lerp(this.desired, 1 - Math.exp(-dt * (ready ? 3 : 14)));
    this.camera.position.copy(this.camPos);
    this.look.set(
      x + Math.sin(root.rotation.y + k.steer * 0.09) * 5,
      1.25,
      z + Math.cos(root.rotation.y + k.steer * 0.09) * 5,
    );
    this.target.lerp(this.look, 1 - Math.exp(-dt * 18));
    this.camera.lookAt(this.target);
    if (k.hit > 0 && active)
      this.camera.position.x += Math.sin(this.clock * 65) * k.hit * 0.045;
    const fov = ready
      ? 56
      : 64 + clamp(k.speed / 32, 0, 1) * 7 + this.boostBlend * 8;
    this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 5));
    this.camera.updateProjectionMatrix();
    this.sun.position.set(k.x - 65, 110, k.z + 40);
    this.sun.target.position.set(k.x, 0, k.z);
    this.sun.target.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    (this.particles.material as T.ShaderMaterial).uniforms.height.value = innerHeight * this.renderer.getPixelRatio();
  }
  toggleQuality() {
    this.quality = !this.quality;
    this.renderer.shadowMap.enabled = this.quality;
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, this.quality ? 1.75 : 1),
    );
    this.resize();
  }
}
