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
  sphere = new T.SphereGeometry(1, 12, 8),
  cylinder = new T.CylinderGeometry(1, 1, 1, 12);
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
  sun = new T.DirectionalLight(0xfff4d9, 3.0);
  target = new T.Vector3();
  camPos = new T.Vector3();
  clock = 0;
  quality = true;
  particleCount = 320;
  particleIndex = 0;
  positions = new Float32Array(320 * 3);
  colors = new Float32Array(320 * 3);
  life = new Float32Array(320);
  vel = new Float32Array(320 * 3);
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
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.scene.background = new T.Color(0xb9e5f1);
    this.scene.fog = new T.Fog(0xb9e5f1, 160, 850);
    this.scene.add(new T.HemisphereLight(0xe1f6ff, 0x648d59, 2.2));
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
    for (const k of game.karts) this.buildKart(k);
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(this.positions, 3));
    geo.setAttribute("color", new T.BufferAttribute(this.colors, 3));
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const ctx = c.getContext("2d")!;
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255,255,255,.8)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    this.positions.fill(-1000);
    this.particles = new T.Points(
      geo,
      new T.PointsMaterial({
        size: 1.1,
        map: new T.CanvasTexture(c),
        vertexColors: true,
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
    const m = new T.Mesh(
      g,
      new T.MeshStandardMaterial({
        vertexColors: true,
        roughness: 1,
        side: T.DoubleSide,
      }),
    );
    m.receiveShadow = true;
    this.scene.add(m);
  }
  buildTrack() {
    mesh(this.scene, box, 0x8abc72, [150, -0.55, 0], [2200, 1, 2200]);
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
      mesh(g, box, palette[i % 5], [0, h / 2, 0], [w, h, 6]);
      const roof = mesh(
        g,
        new T.ConeGeometry(1, 1, 4),
        [0xef8877, 0x508b9b, 0xeac17c][i % 3],
        [0, h + 1.5, 0],
        [w * 0.85, 3, 5.1],
      );
      roof.rotation.y = Math.PI / 4;
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
        [80 + rand() * 80, 40 + rand() * 110, 85 + rand() * 80],
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
  buildKart(k: Kart) {
    const root = new T.Group(),
      body = new T.Group();
    root.add(body);
    this.scene.add(root);
    this.roots.push(root);
    this.bodies.push(body);
    mesh(body, box, 0x263c49, [0, 0.5, 0], [1.65, 0.27, 2.4], true);
    mesh(body, sphere, k.color, [0, 0.82, 0.16], [0.99, 0.43, 1.36], true);
    mesh(body, sphere, k.color, [0, 0.95, 1.02], [0.87, 0.32, 0.63], true);
    mesh(body, box, 0xfff5d8, [0, 1.21, 0.99], [0.24, 0.06, 0.95]);
    mesh(body, box, 0x344d5a, [0, 0.55, 1.5], [1.95, 0.3, 0.32], true);
    mesh(body, box, 0x344d5a, [0, 0.55, -1.35], [1.9, 0.28, 0.3], true);
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
        const tire = new T.Mesh(wheelGeo, material(0x293947));
        tire.rotation.z = Math.PI / 2;
        tire.castShadow = true;
        roll.add(tire);
        const rim = new T.Mesh(rimGeo, material(0xfff3dd, 0.4));
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
  emit(x: number, y: number, z: number, boost: boolean) {
    const i = this.particleIndex++ % this.particleCount;
    this.life[i] = boost ? 0.35 : 0.8;
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.vel[i * 3] = (Math.random() - 0.5) * 2;
    this.vel[i * 3 + 1] = boost ? 0.5 : 1.4;
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 2;
    const c = new T.Color(boost ? 0x64eaff : 0xe9e7d8);
    this.colors[i * 3] = c.r;
    this.colors[i * 3 + 1] = c.g;
    this.colors[i * 3 + 2] = c.b;
  }
  clearEffects() {
    this.life.fill(0);
    this.positions.fill(-1000);
    this.skidIndex = 0;
    this.dummy.scale.set(0, 0, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < 320; i++) this.skids.setMatrixAt(i, this.dummy.matrix);
    this.skids.instanceMatrix.needsUpdate = true;
    this.dummy.scale.set(1, 1, 1);
  }
  snapCamera() {
    const k = this.game.karts[0];
    this.camPos.set(k.x - Math.sin(k.yaw) * 9, 5.5, k.z - Math.cos(k.yaw) * 9);
    this.camera.position.copy(this.camPos);
    this.target.set(k.x, 1.2, k.z);
  }
  update(dt: number, alpha: number) {
    this.clock += dt;
    this.skidTimer += dt;
    const active =
      this.game.state === "RACING" || this.game.state === "FINISHED";
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
      if (active && (k.drift || k.boostTime > 0))
        for (const side of [-1, 1]) {
          const x = k.x - Math.sin(k.yaw) * 1.15 + Math.cos(k.yaw) * side * 0.8,
            z = k.z - Math.cos(k.yaw) * 1.15 - Math.sin(k.yaw) * side * 0.8;
          this.emit(x, 0.45, z, k.boostTime > 0);
          if (k.drift && this.skidTimer > 0.055) {
            this.dummy.position.set(x, 0.06, z);
            this.dummy.rotation.set(-Math.PI / 2, 0, -k.moveYaw);
            this.dummy.scale.set(1, 1, 1);
            this.dummy.updateMatrix();
            this.skids.setMatrixAt(this.skidIndex++ % 320, this.dummy.matrix);
            this.skids.instanceMatrix.needsUpdate = true;
          }
        }
    }
    if (this.skidTimer > 0.055) this.skidTimer = 0;
    for (let i = 0; i < this.particleCount; i++) {
      if (this.life[i] > 0) {
        this.life[i] -= dt;
        for (let j = 0; j < 3; j++)
          this.positions[i * 3 + j] += this.vel[i * 3 + j] * dt;
        if (this.life[i] <= 0) this.positions[i * 3 + 1] = -1000;
      }
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.color.needsUpdate = true;
    const k = this.game.karts[0],
      ready = this.game.state === "READY";
    const followYaw = k.moveYaw + angle(k.yaw - k.moveYaw) * 0.3;
    const back = ready ? 19 : 8.2 + clamp(k.speed / 40, 0, 1) * 1.2,
      height = ready ? 10.5 : 4.6;
    const desired = new T.Vector3(
      k.x - Math.sin(followYaw) * back + (ready ? -11 : 0),
      height,
      k.z - Math.cos(followYaw) * back,
    );
    this.camPos.lerp(desired, 1 - Math.exp(-dt * (ready ? 3 : 9)));
    this.camera.position.copy(this.camPos);
    const look = new T.Vector3(
      k.x + Math.sin(k.yaw) * 5,
      1.25,
      k.z + Math.cos(k.yaw) * 5,
    );
    this.target.lerp(look, 1 - Math.exp(-dt * 12));
    this.camera.lookAt(this.target);
    if (k.hit > 0 && active)
      this.camera.position.x += Math.sin(this.clock * 65) * k.hit * 0.045;
    const fov = ready
      ? 56
      : 64 + clamp(k.speed / 32, 0, 1) * 7 + (k.boostTime > 0 ? 8 : 0);
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
