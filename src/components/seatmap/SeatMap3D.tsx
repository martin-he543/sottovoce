import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { eyeOf, layoutPlan, seatLabel, SEAT_PITCH, type PlanLayout, type SeatPlan, type WorldSeat } from '../../utils/seatPlan';

/** Seat colours by tier, stalls first; boxes get the gold. */
export const LEVEL_COLORS = ['#B3243C', '#C58A1E', '#2F8C84', '#5468B8', '#8E4FA8', '#B5653A'];
const BOX_COLOR = '#D9A93A';
const SELECTED = new THREE.Color('#FFF4D6');
const HOVER = new THREE.Color('#FFFFFF');
const RECOMMENDED = new THREE.Color('#39D98A');

export interface SeatMap3DHandle {
  /** Fly the overview camera to just behind and above a seat, close enough to read the seat numbers. */
  focusSeat: (seat: number) => void;
  overview: () => void;
}

interface SeatMap3DProps {
  plan: SeatPlan;
  /** Index into layoutPlan(plan).seats. */
  selected: number | null;
  onSelect: (seat: number | null) => void;
  /** Seats to pick out in green (e.g. the seat advisor's suggestions). */
  highlighted?: number[];
  /** Per-seat colour in place of the tier colours (e.g. by price band); null keeps the tiers. */
  tints?: string[] | null;
  /** Extra text after the seat name in the hover tooltip (e.g. its price). */
  hoverNote?: (seat: number) => string | null;
  /** Text drawn on each seat's cushion in place of its number (e.g. its price); '' leaves a seat's number; null shows the numbers. */
  seatLabels?: string[] | null;
  /** Highest level shown (tiers above it are hidden so the ones below can be seen); null shows every level. */
  levelLimit: number | null;
  /** 'seat' puts the camera in the selected seat, looking at the stage. */
  mode: 'overview' | 'seat';
  className?: string;
  style?: React.CSSProperties;
}

// ---------- Text atlas: every seat number and row name drawn once, then placed with instanced quads ----------

const CELL_W = 128;
const CELL_H = 64;
const COLS = 16;

function buildAtlas(strings: string[]) {
  const unique = [...new Set(strings)];
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * COLS;
  canvas.height = CELL_H * Math.max(1, Math.ceil(unique.length / COLS));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const cells = new Map<string, [number, number, number, number]>();
  unique.forEach((s, i) => {
    const cx = (i % COLS) * CELL_W;
    const cy = Math.floor(i / COLS) * CELL_H;
    let size = 46;
    ctx.font = `700 ${size}px "Fira Code", ui-monospace, monospace`;
    while (size > 14 && ctx.measureText(s).width > CELL_W - 8) ctx.font = `700 ${(size -= 2)}px "Fira Code", ui-monospace, monospace`;
    ctx.fillText(s, cx + CELL_W / 2, cy + CELL_H / 2 + 2);
    // UVs (v up): bottom-left and top-right of the cell.
    cells.set(s, [cx / canvas.width, 1 - (cy + CELL_H) / canvas.height, (cx + CELL_W) / canvas.width, 1 - cy / canvas.height]);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, cells };
}

const LABEL_VERT = /* glsl */ `
  attribute vec4 aUv;
  attribute vec3 aColor;
  attribute float aFade;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vUv = mix(aUv.xy, aUv.zw, uv);
    vColor = aColor;
    float d = distance(wp.xyz, cameraPosition);
    vAlpha = 1.0 - smoothstep(aFade * 0.6, aFade, d);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const LABEL_FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float a = texture2D(uAtlas, vUv).a * vAlpha;
    if (a < 0.03) discard;
    gl_FragColor = vec4(vColor, a);
  }`;

interface LabelSpec {
  text: string;
  x: number;
  y: number;
  z: number;
  /** Rotation about y; the text's top points along (sin, cos) of yaw + π. */
  yaw: number;
  w: number;
  color: THREE.Color;
  fade: number;
}

/** `upright`: labels stand on end facing away from the stage (the back of a chair) instead of lying flat. */
function labelMesh(specs: LabelSpec[], atlas: ReturnType<typeof buildAtlas>, upright = false) {
  const geo = new THREE.PlaneGeometry(1, 1);
  if (!upright) geo.rotateX(-Math.PI / 2);
  const uvs = new Float32Array(specs.length * 4);
  const colors = new Float32Array(specs.length * 3);
  const fades = new Float32Array(specs.length);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: atlas.texture } },
    vertexShader: LABEL_VERT,
    fragmentShader: LABEL_FRAG,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, specs.length));
  mesh.count = specs.length;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  specs.forEach((s, i) => {
    q.setFromAxisAngle(up, s.yaw + Math.PI);
    m.compose(new THREE.Vector3(s.x, s.y, s.z), q, upright ? new THREE.Vector3(s.w, s.w / 2, 1) : new THREE.Vector3(s.w, 1, s.w / 2));
    mesh.setMatrixAt(i, m);
    uvs.set(atlas.cells.get(s.text)!, i * 4);
    colors.set([s.color.r, s.color.g, s.color.b], i * 3);
    fades[i] = s.fade;
  });
  geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uvs, 4));
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
  geo.setAttribute('aFade', new THREE.InstancedBufferAttribute(fades, 1));
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

/** A floating caption (level names, STAGE) that always faces the camera. */
function textSprite(text: string, color: string, height: number) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = '600 64px "Fraunces", Georgia, serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 48;
  canvas.width = w;
  canvas.height = 96;
  ctx.font = font;
  ctx.fillStyle = 'rgba(12,9,8,0.62)';
  ctx.beginPath();
  ctx.roundRect(0, 4, w, 88, 44);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, 50);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set((height * w) / 96, height, 1);
  sprite.renderOrder = 5;
  return sprite;
}

// ---------- Geometry ----------

/** One chair, its front facing +z: cushion, back and two arms. */
function chairGeometry() {
  const parts = [
    new THREE.BoxGeometry(0.44, 0.09, 0.4).translate(0, 0.44, 0.02),
    new THREE.BoxGeometry(0.44, 0.52, 0.07).translate(0, 0.72, -0.19).rotateX(-0.12),
    new THREE.BoxGeometry(0.05, 0.22, 0.38).translate(-0.24, 0.5, 0),
    new THREE.BoxGeometry(0.05, 0.22, 0.38).translate(0.24, 0.5, 0),
  ];
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  parts.forEach((p) => p.dispose());
  return g;
}

/** Terraces under each run of seats: a tread with a fascia down to the tier's slab, and a parapet on balcony fronts. */
function terraceGeometry(layout: PlanLayout, level: number, base: number, upper: boolean) {
  const pos: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const parapet: number[] = [];
  const pquad = (a: number[], b: number[], c: number[], d: number[]) => parapet.push(...a, ...b, ...c, ...a, ...c, ...d);
  const slab = upper ? 0.9 : 0.02;
  for (const run of layout.runs) {
    if (run.level !== level) continue;
    const seats = run.seats.map((i) => layout.seats[i]);
    // Along-row direction at each seat, from its neighbours (or perpendicular to the facing for single seats).
    const pts = seats.map((s, k) => {
      const a = seats[Math.max(0, k - 1)], b = seats[Math.min(seats.length - 1, k + 1)];
      let dx = b.x - a.x, dz = b.z - a.z;
      if (Math.hypot(dx, dz) < 1e-6) [dx, dz] = [Math.cos(s.yaw), -Math.sin(s.yaw)];
      const l = Math.hypot(dx, dz);
      return { s, ax: dx / l, az: dz / l };
    });
    // Extend both ends by half a seat so the tread covers the end chairs.
    const ends = [
      { ...pts[0], ext: -1 },
      ...pts.map((p) => ({ ...p, ext: 0 })),
      { ...pts[pts.length - 1], ext: 1 },
    ];
    let prev: number[][] | null = null;
    for (const { s, ax, az, ext } of ends) {
      const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw); // towards the stage
      const cx = s.x + ax * ext * SEAT_PITCH * 0.6, cz = s.z + az * ext * SEAT_PITCH * 0.6;
      // Stalls are solid to the floor; upper tiers are a stepped slab, so you can see the stalls beneath them.
      const frontY = s.y + 0.02, bottom = upper ? frontY - slab : base - slab;
      const f = [cx + fx * 0.42, frontY, cz + fz * 0.42];
      const b = [cx - fx * 0.48, frontY, cz - fz * 0.48];
      const fb = [f[0], bottom, f[2]];
      const bb = [b[0], bottom, b[2]];
      const cur = [f, b, fb, bb];
      if (prev) {
        quad(prev[0], cur[0], cur[1], prev[1]); // tread
        quad(prev[2], cur[2], cur[0], prev[0]); // fascia
        quad(prev[1], cur[1], cur[3], prev[3]); // back
        if (run.front && upper) {
          const h = 0.85, o = 0.08;
          const p0 = [prev[0][0] + fx * o, frontY, prev[0][2] + fz * o], p1 = [f[0] + fx * o, frontY, f[2] + fz * o];
          pquad(p0, p1, [p1[0], frontY + h, p1[2]], [p0[0], frontY + h, p0[2]]);
        }
      }
      prev = cur;
    }
  }
  const make = (arr: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g.computeVertexNormals();
    return g;
  };
  return { terrace: make(pos), parapet: parapet.length ? make(parapet) : null };
}

function buildStage(plan: SeatPlan, layout: PlanLayout) {
  const g = new THREE.Group();
  const { width: w, depth: d, type, pit = 0, thrust = 0 } = plan.stage;
  const boards = new THREE.MeshStandardMaterial({ color: '#7a5238', roughness: 0.7 });
  const black = new THREE.MeshStandardMaterial({ color: '#141011', roughness: 0.9 });
  const gold = new THREE.MeshStandardMaterial({ color: '#b98a3a', roughness: 0.35, metalness: 0.6 });
  const deck = 1.1;
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    mesh.position.set(x, y, z);
    g.add(mesh);
    return mesh;
  };
  if (type === 'platform') {
    // Concert platform with risers stepping up towards the back.
    box(w, deck, d, 0, deck / 2 - 0.05, -d / 2, boards);
    for (let i = 1; i <= 3; i++) box(w * (1 - i * 0.12), 0.3, d * 0.22, 0, deck + i * 0.3 - 0.15, -d + d * 0.11 + (3 - i) * 0.02, boards);
  } else if (type === 'round') {
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, deck, 48), boards);
    disc.position.set(0, deck / 2, -d / 2);
    g.add(disc);
  } else {
    box(w + 4, deck, d, 0, deck / 2 - 0.05, -d / 2, boards);
    if (type === 'thrust' && thrust > 0) {
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2, 0);
      shape.lineTo(-w / 2 + 1, thrust * 0.7);
      shape.quadraticCurveTo(0, thrust * 1.25, w / 2 - 1, thrust * 0.7);
      shape.lineTo(w / 2, 0);
      const t = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: deck, bevelEnabled: false }), boards);
      t.rotation.x = Math.PI / 2;
      t.position.set(0, deck - 0.05, 0);
      g.add(t);
    }
    if (type === 'proscenium') {
      // Proscenium arch tall enough to frame the house, with a dark stagehouse behind.
      const archH = Math.max(9, Math.min(16, w * 0.75));
      const top = Math.max(archH + 2.5, layout.bounds.maxY + 4);
      box(1.2, top, 1.4, -w / 2 - 0.6, top / 2, -0.7, gold);
      box(1.2, top, 1.4, w / 2 + 0.6, top / 2, -0.7, gold);
      box(w + 2.4, top - archH, 1.4, 0, archH + (top - archH) / 2, -0.7, gold);
      box(w + 8, top, 0.4, 0, top / 2, -d, black);
      const curtain = new THREE.Mesh(new THREE.PlaneGeometry(w, archH - deck), new THREE.MeshStandardMaterial({ color: '#6d0f1f', roughness: 0.8, side: THREE.DoubleSide, transparent: true, opacity: 0.35 }));
      curtain.position.set(0, deck + (archH - deck) / 2, -1.6);
      g.add(curtain);
    }
  }
  if (pit > 0) {
    const pitMesh = box(w * 0.92, 0.1, pit, 0, -1.4, pit / 2 + 0.2, black);
    pitMesh.name = 'pit';
    box(w * 0.92, 0.9, 0.08, 0, 0.45, pit + 0.2, gold);
  }
  // Stage lighting, a lit backdrop and a few life-size figures, so the view from a seat shows what you'd actually see.
  const centreZ = type === 'thrust' ? thrust * 0.2 : -Math.min(d * 0.3, 4);
  const spot = new THREE.SpotLight('#ffe2b0', 60, 0, Math.PI / 5, 0.5, 1);
  spot.position.set(0, 14, centreZ + 10);
  spot.target.position.set(0, deck, centreZ);
  g.add(spot, spot.target);
  if (type !== 'round') {
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(w, Math.max(6, w * 0.55)),
      new THREE.MeshStandardMaterial({ color: '#1f3358', emissive: '#16264a', emissiveIntensity: 0.8, roughness: 1 })
    );
    backdrop.position.set(0, deck + Math.max(6, w * 0.55) / 2, -d + 0.6);
    g.add(backdrop);
  }
  const people = new THREE.MeshStandardMaterial({ color: '#e9dcc6', roughness: 0.6 });
  for (const [x, dz] of [[-2.2, 0.6], [0, -0.4], [1.8, 0.9], [3.6, -0.8]]) {
    const figure = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.3, 4, 12), people);
    figure.position.set(x, deck + 0.87, centreZ + dz);
    g.add(figure);
  }
  const label = textSprite(type === 'platform' ? 'PLATFORM' : 'STAGE', '#F3CA62', 1.3);
  label.position.set(0, deck + 3, type === 'thrust' ? thrust * 0.3 : -d / 3);
  g.add(label);
  return { group: g, label };
}

// ---------- Component ----------

export const SeatMap3D = React.forwardRef<SeatMap3DHandle, SeatMap3DProps>(function SeatMap3D(
  { plan, selected, onSelect, highlighted, tints, hoverNote, seatLabels, levelLimit, mode, className, style },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => layoutPlan(plan), [plan]);
  const [hover, setHover] = useState<{ seat: number; x: number; y: number } | null>(null);
  const [failed, setFailed] = useState(false);
  // Imperative scene state shared between the effects below.
  const sceneRef = useRef<{
    seatMeshes: { mesh: THREE.InstancedMesh; ids: number[]; level: number }[];
    levelGroups: THREE.Group[];
    seatColor: (i: number) => THREE.Color;
    instanceOf: Map<number, [THREE.InstancedMesh, number]>;
    flyTo: (pos: THREE.Vector3, target: THREE.Vector3, seatView?: boolean) => void;
    overview: () => void;
    marker: THREE.Mesh;
    captions: THREE.Sprite[];
    labelOf: Map<number, [THREE.InstancedMesh, number]>;
    /** Replaces the seat numbers with `texts` (per seat), or restores them with null. */
    setSeatLabels: (texts: string[] | null) => void;
    /** Where each seat's replacement label sits, while there is one. */
    textLabelOf: Map<number, [THREE.InstancedMesh, number]>;
    setFov: (fov: number) => void;
  } | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const host = hostRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.touchAction = 'none';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#120d0c');
    const { bounds } = layout;
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 20);
    scene.fog = new THREE.Fog('#120d0c', span * 1.6, span * 4);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, span * 10);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = 1.5;
    controls.maxDistance = span * 3;
    controls.screenSpacePanning = true;

    scene.add(new THREE.HemisphereLight('#ffe9cf', '#3a2219', 1.7));
    const key = new THREE.DirectionalLight('#fff1dd', 2.2);
    key.position.set(span * 0.3, span * 0.9, -span * 0.4);
    scene.add(key);
    const fill = new THREE.DirectionalLight('#b9c8ff', 0.45);
    fill.position.set(-span * 0.5, span * 0.4, span);
    scene.add(fill);

    // House floor (carpet), big enough for the whole plan.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(bounds.maxX - bounds.minX + 12, bounds.maxZ - bounds.minZ + 12),
      new THREE.MeshStandardMaterial({ color: '#2b1517', roughness: 1 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((bounds.minX + bounds.maxX) / 2, -0.02, (bounds.minZ + bounds.maxZ) / 2);
    scene.add(floor);
    const stage = buildStage(plan, layout);
    scene.add(stage.group);
    const captions: THREE.Sprite[] = [stage.label];

    // Labels share one atlas: seat numbers, row names.
    const atlas = buildAtlas([...layout.seats.map((s) => s.num), ...layout.runs.map((r) => r.row)]);
    const chair = chairGeometry();
    const levelGroups: THREE.Group[] = [];
    const seatMeshes: { mesh: THREE.InstancedMesh; ids: number[]; level: number }[] = [];
    const instanceOf = new Map<number, [THREE.InstancedMesh, number]>();
    const labelOf = new Map<number, [THREE.InstancedMesh, number]>();
    const numberMeshes: THREE.InstancedMesh[] = [];
    const levelColor = (li: number) => new THREE.Color(LEVEL_COLORS[li % LEVEL_COLORS.length]);
    const isBox = (s: WorldSeat) => plan.levels[s.level].sections[s.section].name === 'Boxes';
    const seatColor = (i: number) => {
      const s = layout.seats[i];
      if (isBox(s)) return new THREE.Color(BOX_COLOR);
      // Named blocks within a tier get a slightly different shade so the sections read.
      const c = levelColor(s.level);
      return s.section % 2 ? c.offsetHSL(0, -0.05, 0.06) : c;
    };
    const numberInk = new THREE.Color('#fff6e6');
    const rowInk = new THREE.Color('#F3CA62');

    plan.levels.forEach((level, li) => {
      const group = new THREE.Group();
      group.name = level.name;
      const ids = layout.seats.flatMap((s, i) => (s.level === li ? [i] : []));
      if (!ids.length) {
        levelGroups.push(group);
        scene.add(group);
        return;
      }
      const base = Math.min(...ids.map((i) => layout.seats[i].y));
      const { terrace, parapet } = terraceGeometry(layout, li, base, base > 0.5);
      const tint = levelColor(li).lerp(new THREE.Color('#6b4c3c'), 0.7);
      group.add(new THREE.Mesh(terrace, new THREE.MeshStandardMaterial({ color: tint, roughness: 0.85, side: THREE.DoubleSide })));
      if (parapet) group.add(new THREE.Mesh(parapet, new THREE.MeshStandardMaterial({ color: '#c79a48', roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide })));

      const mesh = new THREE.InstancedMesh(chair, new THREE.MeshStandardMaterial({ roughness: 0.6 }), ids.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const one = new THREE.Vector3(1, 1, 1);
      ids.forEach((id, k) => {
        const s = layout.seats[id];
        m.compose(new THREE.Vector3(s.x, s.y, s.z), q.setFromAxisAngle(up, s.yaw), one);
        mesh.setMatrixAt(k, m);
        mesh.setColorAt(k, seatColor(id));
        instanceOf.set(id, [mesh, k]);
      });
      mesh.computeBoundingSphere();
      group.add(mesh);
      seatMeshes.push({ mesh, ids, level: li });

      // Seat numbers lie on the cushions, reading upright when you face the stage; row names sit at both ends of a run.
      const labels: LabelSpec[] = ids.map((id) => {
        const s = layout.seats[id];
        return { text: s.num, x: s.x + Math.sin(s.yaw) * 0.03, y: s.y + 0.495, z: s.z + Math.cos(s.yaw) * 0.03, yaw: s.yaw, w: 0.4, color: numberInk, fade: 26 };
      });
      for (const run of layout.runs) {
        if (run.level !== li || isBox(layout.seats[run.seats[0]])) continue;
        for (const [end, other] of [
          [run.seats[0], run.seats[1]],
          [run.seats[run.seats.length - 1], run.seats[run.seats.length - 2]],
        ]) {
          const s = layout.seats[end];
          const o = other !== undefined ? layout.seats[other] : null;
          let ax = o ? s.x - o.x : Math.cos(s.yaw), az = o ? s.z - o.z : -Math.sin(s.yaw);
          const l = Math.hypot(ax, az) || 1;
          [ax, az] = [ax / l, az / l];
          labels.push({ text: run.row, x: s.x + ax * 0.62, y: s.y + 0.06, z: s.z + az * 0.62, yaw: s.yaw, w: 0.78, color: rowInk, fade: 90 });
          if (run.seats.length === 1) break;
        }
      }
      const numbers = labelMesh(labels, atlas);
      group.add(numbers);
      numberMeshes[li] = numbers;
      ids.forEach((id, k) => labelOf.set(id, [numbers, k]));

      // Tier caption behind the back row, and named blocks over their middle.
      const cap = layout.levelLabels.find((l) => l.level === li);
      if (cap) {
        const sprite = textSprite(level.name, LEVEL_COLORS[li % LEVEL_COLORS.length], 1.15);
        sprite.position.set(cap.x, cap.y, cap.z);
        group.add(sprite);
        captions.push(sprite);
      }
      const named = level.sections.filter((s) => s.name !== 'Boxes' && s.name !== level.name);
      if (named.length > 1)
        level.sections.forEach((sec, si) => {
          if (sec.name === 'Boxes' || sec.name === level.name) return;
          const ss = ids.filter((i) => layout.seats[i].section === si).map((i) => layout.seats[i]);
          if (!ss.length) return;
          const avg = (f: (s: WorldSeat) => number) => ss.reduce((n, s) => n + f(s), 0) / ss.length;
          const sprite = textSprite(sec.name, '#f7efe2', 0.7);
          sprite.position.set(avg((s) => s.x), Math.max(...ss.map((s) => s.y)) + 2.2, avg((s) => s.z));
          group.add(sprite);
          captions.push(sprite);
        });
      levelGroups.push(group);
      scene.add(group);
    });

    // Seat labels (prices) drawn over the cushions in place of the numbers.
    const textLabelOf = new Map<number, [THREE.InstancedMesh, number]>();
    let textMeshes: THREE.InstancedMesh[] = [];
    let textAtlas: ReturnType<typeof buildAtlas> | null = null;
    const setSeatLabels = (texts: string[] | null) => {
      for (const mesh of textMeshes) {
        mesh.parent?.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      textAtlas?.texture.dispose();
      textMeshes = [];
      textAtlas = null;
      textLabelOf.clear();
      numberMeshes.forEach((m) => m && (m.visible = !texts));
      if (!texts) return;
      textAtlas = buildAtlas(texts.filter(Boolean));
      seatMeshes.forEach(({ ids, level }) => {
        const own = ids.filter((id) => texts[id]);
        if (!own.length) return;
        const specs: LabelSpec[] = own.map((id) => {
          const s = layout.seats[id];
          // On the back of the chair (0.32 m behind the seat’s centre, clear of the tilted back), where the rows behind and the camera's usual view see it.
          return { text: texts[id], x: s.x - Math.sin(s.yaw) * 0.32, y: s.y + 0.72, z: s.z - Math.cos(s.yaw) * 0.32, yaw: s.yaw, w: 0.42, color: numberInk, fade: 46 };
        });
        const mesh = labelMesh(specs, textAtlas!, true);
        levelGroups[level].add(mesh);
        textMeshes.push(mesh);
        own.forEach((id, k) => textLabelOf.set(id, [mesh, k]));
      });
      // Seats the labels don't cover keep their numbers.
      numberMeshes.forEach((m) => m && (m.visible = !texts || texts.some((t) => !t)));
    };

    // Selection marker: a soft column of light over the chosen seat.
    const marker = new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 3, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: '#FFE7A8', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
    );
    marker.visible = false;
    scene.add(marker);

    // Camera moves: ease between views; in a seat the controls just look around from the eye point.
    let tween: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t0: number; seat: boolean } | null = null;
    const flyTo = (pos: THREE.Vector3, target: THREE.Vector3, seatView = false) => {
      tween = { from: camera.position.clone(), to: pos, tFrom: controls.target.clone(), tTo: target, t0: performance.now(), seat: seatView };
      controls.enabled = false;
    };
    const home = () => {
      const cz = (bounds.minZ + bounds.maxZ) / 2;
      return {
        pos: new THREE.Vector3(span * 0.38, bounds.maxY + span * 0.7, bounds.maxZ + span * 0.62),
        target: new THREE.Vector3(0, bounds.maxY * 0.2, cz),
      };
    };
    const overview = () => {
      const h = home();
      camera.fov = 42;
      camera.updateProjectionMatrix();
      controls.enableZoom = controls.enablePan = true;
      controls.rotateSpeed = 1;
      flyTo(h.pos, h.target);
    };
    const start = home();
    camera.position.copy(start.pos);
    controls.target.copy(start.target);

    sceneRef.current = { seatMeshes, levelGroups, seatColor, instanceOf, flyTo, overview, marker, captions, labelOf, setSeatLabels, textLabelOf, setFov: (fov: number) => {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    } };

    // Hover and click via raycasting the visible seats; a drag doesn't count as a click.
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const pick = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(seatMeshes.filter((s) => levelGroups[s.level].visible).map((s) => s.mesh), false);
      const hit = hits[0];
      if (!hit || hit.instanceId === undefined) return null;
      const entry = seatMeshes.find((s) => s.mesh === hit.object)!;
      return { seat: entry.ids[hit.instanceId], x: ev.clientX - r.left, y: ev.clientY - r.top };
    };
    let hovered: number | null = null;
    let raf = 0;
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerType !== 'mouse' || ev.buttons) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const h = pick(ev);
        if ((h?.seat ?? null) !== hovered) {
          if (hovered !== null) paint(hovered);
          hovered = h?.seat ?? null;
          if (hovered !== null) paint(hovered, HOVER);
        }
        renderer.domElement.style.cursor = h ? 'pointer' : '';
        setHover(h);
      });
    };
    const paint = (seat: number, color?: THREE.Color) => {
      const [mesh, k] = instanceOf.get(seat)!;
      mesh.setColorAt(k, color ?? currentColor(seat));
      mesh.instanceColor!.needsUpdate = true;
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (ev: PointerEvent) => (down = { x: ev.clientX, y: ev.clientY });
    const onUp = (ev: PointerEvent) => {
      if (!down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) return;
      down = null;
      const h = pick(ev);
      onSelectRef.current(h ? h.seat : null);
    };
    const onLeave = () => {
      if (hovered !== null) paint(hovered);
      hovered = null;
      setHover(null);
    };
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = `${w}px`;
      renderer.domElement.style.height = `${h}px`;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (tween) {
        const k = Math.min(1, (performance.now() - tween.t0) / 1100);
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        camera.position.lerpVectors(tween.from, tween.to, e);
        controls.target.lerpVectors(tween.tFrom, tween.tTo, e);
        if (k === 1) {
          if (tween.seat) {
            // Look around from the seat: orbit a point just ahead of the eye.
            const dir = tween.tTo.clone().sub(tween.to).normalize();
            controls.target.copy(tween.to).addScaledVector(dir, 0.05);
            controls.enableZoom = controls.enablePan = false;
            controls.rotateSpeed = -0.35;
          }
          tween = null;
          controls.enabled = true;
        }
      }
      if (marker.visible) (marker.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.12 * Math.sin(performance.now() / 300);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const mat of mats) {
          (mat as THREE.MeshBasicMaterial).map?.dispose();
          mat.dispose();
        }
      });
      atlas.texture.dispose();
      textAtlas?.texture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
      hiddenRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, layout]);

  // Colours: base by tier (or the tints), green for suggestions, cream for the selection.
  const highlightSet = useMemo(() => new Set(highlighted ?? []), [highlighted]);
  const tintColors = useMemo(() => {
    if (!tints) return null;
    const cache = new Map<string, THREE.Color>();
    return tints.map((t) => cache.get(t) ?? cache.set(t, new THREE.Color(t)).get(t)!);
  }, [tints]);
  const hiddenRef = useRef<{ mesh: THREE.InstancedMesh; k: number; matrix: THREE.Matrix4 }[]>([]);
  const currentColorRef = useRef<(i: number) => THREE.Color>(() => new THREE.Color());
  currentColorRef.current = (i: number) =>
    i === selected
      ? SELECTED
      : highlightSet.has(i)
        ? RECOMMENDED
        : tintColors?.[i] ?? (sceneRef.current ? sceneRef.current.seatColor(i) : new THREE.Color());
  const currentColor = (i: number) => currentColorRef.current(i);

  useEffect(() => {
    sceneRef.current?.setSeatLabels(seatLabels ?? null);
    // The hide-the-chair-you-sit-in effect below re-runs on seatLabels too, so it sees the new meshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatLabels, layout, plan]);

  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    for (const { mesh, ids } of st.seatMeshes) {
      ids.forEach((id, k) => mesh.setColorAt(k, currentColor(id)));
      mesh.instanceColor!.needsUpdate = true;
    }
    if (selected !== null && layout.seats[selected]) {
      const s = layout.seats[selected];
      st.marker.position.set(s.x, s.y + 2.1, s.z);
      st.marker.visible = mode !== 'seat';
    } else st.marker.visible = false;
    for (const c of st.captions) c.visible = mode !== 'seat';
    // Sitting in a seat: hide that chair so its cushion isn't in the foreground.
    for (const { mesh, k, matrix } of hiddenRef.current) {
      mesh.setMatrixAt(k, matrix);
      mesh.instanceMatrix.needsUpdate = true;
    }
    hiddenRef.current = [];
    if (mode === 'seat' && selected !== null && st.instanceOf.has(selected)) {
      for (const [mesh, k] of [st.instanceOf.get(selected)!, st.labelOf.get(selected)!, ...(st.textLabelOf.has(selected) ? [st.textLabelOf.get(selected)!] : [])]) {
        const matrix = new THREE.Matrix4();
        mesh.getMatrixAt(k, matrix);
        mesh.setMatrixAt(k, new THREE.Matrix4().makeScale(0, 0, 0));
        mesh.instanceMatrix.needsUpdate = true;
        hiddenRef.current.push({ mesh, k, matrix });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, highlightSet, tintColors, layout, mode, seatLabels]);

  useEffect(() => {
    const st = sceneRef.current;
    if (!st) return;
    st.levelGroups.forEach((g, li) => (g.visible = levelLimit === null || li <= levelLimit));
  }, [levelLimit, layout]);

  const viewFromSeat = (seat: number) => {
    const st = sceneRef.current;
    const s = layout.seats[seat];
    if (!st || !s) return;
    const eye = eyeOf(s);
    st.setFov(55);
    const { type, depth, thrust = 0 } = plan.stage;
    const look = type === 'thrust' ? new THREE.Vector3(0, 1.6, thrust * 0.3) : new THREE.Vector3(0, 2, -Math.min(depth * 0.35, 5));
    st.flyTo(new THREE.Vector3(eye.x, eye.y, eye.z), look, true);
  };

  const prevMode = useRef(mode);
  useEffect(() => {
    if (mode === 'seat' && selected !== null) viewFromSeat(selected);
    else if (prevMode.current === 'seat') sceneRef.current?.overview();
    prevMode.current = mode;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selected, layout]);

  const focusSeat = (seat: number) => {
    const st = sceneRef.current;
    const s = layout.seats[seat];
    if (!st || !s) return;
    // From behind the seat (away from the stage), up and to one side, looking down at it.
    const back = { x: -Math.sin(s.yaw), z: -Math.cos(s.yaw) };
    st.flyTo(new THREE.Vector3(s.x + back.x * 6 + back.z * 2, s.y + 5.5, s.z + back.z * 6 - back.x * 2), new THREE.Vector3(s.x, s.y + 0.4, s.z));
  };

  React.useImperativeHandle(ref, () => ({ focusSeat, overview: () => sceneRef.current?.overview() }));

  return (
    <div ref={hostRef} className={`relative overflow-hidden ${className ?? ''}`} style={style} role="img" aria-label={`3D seating plan of ${plan.name}, ${plan.hall}`}>
      {failed && (
        <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm" style={{ color: '#f7efe2' }}>
          3D needs WebGL, which this browser has turned off. The seat finder beside the map still works.
        </p>
      )}
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md px-2 py-1 font-mono text-[11px] shadow-lg"
          style={{ left: hover.x + 14, top: hover.y + 10, background: 'rgba(15,11,10,0.92)', color: '#fff4e0', border: '1px solid rgba(243,202,98,0.35)' }}
        >
          {seatLabel(plan, layout.seats[hover.seat])}
          {hoverNote?.(hover.seat) && <span style={{ color: '#F3CA62' }}> · {hoverNote(hover.seat)}</span>}
        </div>
      )}
    </div>
  );
});
