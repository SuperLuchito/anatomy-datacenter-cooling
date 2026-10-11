// Сборка сцены «Как ЦОД отдаёт тепло» на ките Anatomy.
// node build.mjs            — пишет ../outputs/data-center-cooling.html
// node build.mjs --audit    — то же и полный аудит геометрии Anatomy
// node build.mjs --dark     — внутренний тёмный вариант для проверки (shots/dark.html)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "./vendor/anatomy/kit/iso-kit.mjs";
import * as G from "./vendor/anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "./vendor/anatomy/kit/tube.mjs";
import * as A from "./vendor/anatomy/kit/audit.mjs";
import { kitScript, glScript } from "./vendor/anatomy/scripts/inline-kit.mjs";
import { glCamera } from "./vendor/anatomy/kit/gl.mjs";
import { export3d } from "./export3d.mjs";
import { COEF } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DARK = process.argv.includes("--dark");
const DEG = Math.PI / 180;

// ── Мир ─────────────────────────────────────────────────────────────
// 1 единица ≈ 2 см. x — вдоль макета (зал → улица), y — к зрителю, z — вверх.
const W = 900;
const H = 560;
const AZIMUTH = 58;
const ELEVATION = 30;

const BASE = { x: -284, y: -112, w: 590, d: 206, r: 10 };
const BASE_H = 12;
const FOOT_H = 6;
const F = 24; // верх настила фальшпола
const DECK_T = 2;
const STR_T = 3; // высота стрингера
const PED_TOP = F - DECK_T - STR_T; // 19, верх оголовка пьедестала
const FLOOR = { x0: -270, x1: 30, y0: -100, y1: 80, strip: 50 };
const GRID = 30;

const RACKS = [-250, -220, -190].map((x, index) => ({ index, x0: x, x1: x + 30, y0: -70, y1: -10, z0: F, z1: F + 100 }));

const CRAC = { x0: -100, x1: 0, y0: 32, y1: 80, z0: F, z1: F + 98 };
const PANEL = 1.5;
const POST = 3;
const PART_X = -44; // перегородка между воздушной секцией и машинным отсеком

const DRY = { x0: 152, x1: 280, y0: 10, y1: 78, legTop: 40, coil0: 42, coil1: 58, deck0: 64, deck1: 70 };
const FANS = [184, 248].map((x) => ({ x, y: 44 }));
const FAN = { rIn: 22, rOut: 23.8, top: 78, rotor: 73 };

const LANE = { S: 58, R: 70, z: 11, r: 3.5 }; // подача (холодная, с насосом) и возврат (тёплый) снаружи
const GR = 2.2; // радиус гликолевых труб внутри шкафа
const RR = 0.9; // радиус фреоновых трубок

const P = k.fitProjection(
  [
    ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
    [RACKS[0].x0, RACKS[0].y0, F + 128],
    [RACKS[2].x1, RACKS[2].y1, F + 128],
    [CRAC.x0, CRAC.y0, F + 128],
    [CRAC.x1, CRAC.y1, CRAC.z1],
    [DRY.x1, DRY.y1, 92],
    [DRY.x1, DRY.y0, 120],
  ],
  W,
  H,
  { pad: 28, azimuth: AZIMUTH, elevation: ELEVATION },
);
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const Faded = (list, style) => k.fadedSvg(list, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);
const f2 = (v) => Math.round(v * 100) / 100;
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

// ── Запись деталей для аудита ───────────────────────────────────────
const R = A.recorder(P);
const record = R.solid;
const GROUP = {}; // имя элемента → группа выделения

function put(piece, name, ref, svg, shapes, { bias = 0, group, ...rest } = {}) {
  const id = R.nameFor(name);
  R.put({ name: id, piece, at: ref, bias, svg, shapes, ...rest });
  if (group) GROUP[id] = group;
  return id;
}

function box(piece, name, [x0, y0, z0], [x1, y1, z1], style = {}, { r = 0.4, steps = 2, bevel = 0, extra = "", inner = "", bias = 0, owner, group, ground } = {}) {
  const plan = { x: x0, y: y0, w: x1 - x0, d: y1 - y0, r };
  const meta = { name, owner, ...(ground ? { ground: true } : {}) };
  const shape = record(A.slab(plan, z0, z1 - z0, meta, steps));
  return put(piece, name, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], S(k.slabOf(plan, z0, z1 - z0, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias, group });
}

function cyl(piece, name, cx, cy, r, z, h, style = {}, { steps = 28, bevel = 0, extra = "", bias = 0, owner, group } = {}) {
  const shape = record(A.cylinder(cx, cy, r, z, h, { name, owner }));
  return put(piece, name, [cx, cy, z + h / 2], S(k.cylinder(cx, cy, r, z, h, P, steps, bevel), { tone: "mid", ...style }) + extra, [shape], { bias, group });
}

function turned(piece, name, F3, profile, style = {}, { extra = "", inner = "", bias = 0, smooth, steps, rims, bevel = 0, owner, group, seated, cut } = {}) {
  const options = { bevel, ...(smooth !== undefined ? { smooth } : {}), ...(steps ? { steps } : {}), ...(rims ? { rims } : {}) };
  const paths = G.solidOf(profile, F3, P, options);
  const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2;
  const meta = { name, owner, radius: smooth && smooth.radius ? smooth.radius : null, curve: smooth === true ? profile : undefined, ...(seated ? { seated, cut } : {}) };
  const shape = record(A.solid(F3, profile, meta));
  shape.item = put(piece, name, G.add3(F3.o, G.mul3(F3.a, mid)), S(paths, { tone: "mid", ...style, inner }) + extra, [shape], { bias, group });
  return shape;
}

const disc = (piece, name, F3, s0, s1, r, style = {}, options = {}) => turned(piece, name, F3, [[s0, r], [s1, r]], style, options);

function prism(piece, name, F3, poly, s0, s1, style = {}, { extra = "", inner = "", bias = 0, owner, group, ref } = {}) {
  const shape = record(A.prism(F3, poly, s0, s1, { name, owner }));
  const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
  const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const centre = G.add3(G.add3(G.add3(F3.o, G.mul3(F3.a, (s0 + s1) / 2)), G.mul3(F3.u, cx)), G.mul3(F3.v, cy));
  return put(piece, name, ref ?? centre, S(G.prismOf(F3, poly, s0, s1, P), { tone: "mid", ...style, inner }) + extra, [shape], { bias, group });
}

function ball(piece, name, c, r, style = {}, { bias = 0, owner, group } = {}) {
  const shape = record(A.ball(c, r, { name, owner }));
  return put(piece, name, c, S(G.sphereOf(c, r, P, { steps: 32 }), { tone: "mid", ...style }), [shape], { bias, group });
}

// Седловая площадка на кривом корпусе (как padOn в примере Raptor).
function padOn(piece, name, host, point, outward, a, h, style = {}, { owner, group, bias = 0.1 } = {}) {
  const hosts = [host].flat();
  const inside = (p) => hosts.some((shape) => A.sdf(shape, p) < 0);
  const axis = G.unit3(outward);
  const F3 = G.frameAlong(point, axis);
  const start = (angle) => {
    let lo = -2.5 * a;
    let hi = h;
    if (!inside(G.pointOf(F3, lo, a, angle))) return 0;
    for (let step = 0; step < 40; step++) {
      const mid = (lo + hi) / 2;
      if (inside(G.pointOf(F3, mid, a, angle))) lo = mid;
      else hi = mid;
    }
    return hi;
  };
  const low = Math.min(...Array.from({ length: 48 }, (_, index) => start((index / 48) * Math.PI * 2)));
  const shape = record(A.disc(F3, low - 0.05, h, a, { name, owner, seated: true, cut: hosts }));
  put(piece, name, G.add3(point, G.mul3(axis, h / 2)), S(G.saddleOf(F3, a, start, h, P), { tone: "mid", ...style }), [shape], { bias, group });
  return G.add3(point, G.mul3(axis, h));
}

function flangeAt(piece, name, centre, axis, r, thick, { bolts = 6, tone = "mid", bias = 0, owner, group } = {}) {
  const F3 = G.frameAlong(centre, axis);
  const towards = G.dot3(F3.a, V) > 0 ? thick / 2 : -thick / 2;
  const face = Math.abs(G.dot3(F3.a, V)) > 0.12 && bolts ? Dots(G.dotsOf(F3, towards, r * 0.74, bolts, P, { all: true }), { size: 0.4, tone: "mid" }) : "";
  const shape = record(A.disc(F3, -thick / 2, thick / 2, r, { name, owner }));
  return put(piece, name, centre, S(G.disc(-thick / 2, thick / 2, r, F3, P), { tone }) + face, [shape], { bias, group });
}

const ROUTES = {}; // маршруты труб для маркеров потока
const FAN_WHEEL = {};
const BLADES3D = [];
function pipe(piece, name, control, r, { bend = 2.6, tone = "hi", flanges = [true, true], flangeR = 1.55, bands = [], bandPoints = [], bandR = 1.16, bandT = null, valve = null, valveR = null, gaps: extra = [], maxLength = 22, group, limp = false, caps = true } = {}) {
  const line = G.fillet(control, Math.max(r * bend, 3), r > 3 ? 18 : 12, { P, tube: r });
  const total = G.pathLength(line);
  const collars = [];
  [[0, -1], [total, 1]].forEach(([along, sign], index) => {
    if (!flanges[index]) return;
    const thick = Math.max(0.9, r * 0.5);
    const tangent = G.tangentAlong(line, along);
    collars.push({ kind: "flange", centre: G.add3(G.pointAlong(line, along), G.mul3(tangent, (-sign * thick) / 2)), tangent, radius: r * [flangeR].flat()[Math.min(index, [flangeR].flat().length - 1)], thick, gap: sign < 0 ? [0, thick] : [total - thick, total] });
  });
  const nearestAlong = (point) => {
    let best = 0;
    let bestD = Infinity;
    for (let a = 0; a <= total; a += 0.1) {
      const d = G.len3(G.sub3(G.pointAlong(line, a), point));
      if (d < bestD) [best, bestD] = [a, d];
    }
    return best;
  };
  for (const along of [...bands.map((share) => total * share), ...bandPoints.map(nearestAlong)]) {
    const thick = bandT ?? Math.max(0.8, r * 0.6);
    collars.push({ kind: "band", centre: G.pointAlong(line, along), tangent: G.tangentAlong(line, along), radius: r * bandR, thick, gap: [along - thick / 2, along + thick / 2] });
  }
  const gaps = [...collars.map(({ gap }) => gap), ...extra];
  if (valve) {
    const along = valve > 1 ? valve : total * valve;
    gaps.push([along - (valveR ?? r) * 2.4, along + (valveR ?? r) * 2.4]);
  }
  const id = R.nameFor(name);
  R.route(id, line, r, { owner: id, gaps, limp, rims: flanges.map((on, index) => (on ? r * [flangeR].flat()[Math.min(index, [flangeR].flat().length - 1)] : r)), piece });
  tubePieces(line, r, P, { maxLength, spacing: Math.max(0.8, Math.min(2.4, r * 0.3)), gaps, caps }).forEach((part, index) =>
    put(piece, `${id}:${index}`, part.mid, tubeSvg(part, { tone }), [A.tube(part.points, part.radii)], { group, route: id, chunk: index, attrs: ` data-route="${id}"` }),
  );
  for (const { kind, centre, tangent, radius, thick } of collars) flangeAt(piece, `${id}.${kind}`, centre, tangent, radius, thick, { bolts: kind === "flange" && r > 2 ? 6 : 0, tone: "mid", owner: id, group });
  ROUTES[id] = line;
  line.owner = id;
  line.total = total;
  return line;
}

// Клапан на прямом участке трубы (по рецепту valveOn из примера Raptor).
function valveOn(piece, name, line, along, r, { side = [0, 0, 1], group, tone = "hi", kind = "valve" } = {}) {
  const centre = G.pointAlong(line, along);
  const tangent = G.tangentAlong(line, along);
  const F3 = G.frameAlong(centre, tangent);
  const crown = r * 1.85 * 1.08;
  const bulge = (x) => r * 1.45 + (crown - r * 1.45) * Math.sqrt(Math.max(0, 1 - (x / (r * 1.6)) ** 2));
  const bulgeSlope = (x) => {
    if (Math.abs(x) >= r * 1.6 - 1e-9) return 0;
    const t = Math.max(-0.995, Math.min(0.995, x / (r * 1.6)));
    return (-(crown - r * 1.45) * t) / (r * 1.6 * Math.sqrt(1 - t * t));
  };
  const meridian = [
    [-r * 2.4, 0],
    [-r * 2.4, r * 1.45],
    ...Array.from({ length: 17 }, (_, index) => {
      const x = r * 1.6 * Math.sin(((index - 8) / 8) * (Math.PI / 2));
      return [x, bulge(x), index && index < 16 ? 1 : 0];
    }),
    [r * 2.4, r * 1.45],
    [r * 2.4, 0],
  ];
  const owner = line.owner;
  const id = put(piece, name, centre, S(G.lathe(meridian, F3, P, { steps: 36, smooth: { slope: bulgeSlope, rows: 3 } }), { tone }) + Dots([...G.dotsOf(F3, -r * 2.4, r * 1.2, 6, P, { all: true }), ...G.dotsOf(F3, r * 2.4, r * 1.2, 6, P, { all: true })], { size: 0.35, tone: "mid" }), [record(A.body(F3, meridian, { name, owner }))], { group });
  const up = G.unit3(side);
  const NF = G.frameAlong(centre, up);
  const s0 = crown - 0.25;
  const s1 = crown + r * 0.9;
  disc(piece, `${name}.neck`, NF, s0, s1, r * 0.5, { tone }, { owner, group });
  if (up[2] > 0.99) {
    const top = G.add3(centre, [0, 0, s1]);
    const plan = { x: top[0] - r * 1.6, y: top[1] - r * 1.4, w: r * 3.2, d: r * 2.8, r: 0.6 };
    const lid = top[2] + r * 2.4;
    const extra = Ln(k.planOutline(k.insetPlan(plan, 0.7), lid, P, 2), { tone: "faint" }) + Dots([at([plan.x + 1, plan.y + 1, lid]), at([plan.x + plan.w - 1, plan.y + plan.d - 1, lid])], { size: 0.38 });
    const shape = record(A.slab(plan, top[2], r * 2.4, { name: `${name}.head`, owner }, 2));
    put(piece, `${name}.head`, [top[0], top[1], top[2] + r * 1.2], S(k.slabOf(plan, top[2], r * 2.4, P, 2, 0.3), { tone }) + extra, [shape], { group, bias: 0.2 });
    return id;
  }
  const can = [[s1, 0], [s1, r * 1.6], [s1 + r * 2.4, r * 1.6], [s1 + r * 2.4, 0]];
  const end = s1 + r * 2.4;
  put(piece, `${name}.head`, G.add3(centre, G.mul3(up, (s1 + end) / 2)), S(G.lathe(can, NF, P, { steps: 32, bevel: 0.4 }), { tone }) + Ln(G.circleOf(NF, end, r * 1.1, P, 24), { tone: "faint" }), [record(A.body(NF, can, { name: `${name}.head`, owner }))], { group, bias: 0.2 });
  return id;
}

// Закрытая прорезь на вертикальной грани y = const.
const slotY = (cx, cz, w, h, y, r = Math.min(w, h) / 2) => path3(k.roundedPlan({ x: cx - w / 2, y: cz - h / 2, w, d: h, r }, 3).map(([x, z]) => [x, y, z]), true);
// То же на грани x = const.
const slotX = (cy, cz, w, h, x, r = Math.min(w, h) / 2) => path3(k.roundedPlan({ x: cy - w / 2, y: cz - h / 2, w, d: h, r }, 3).map(([y, z]) => [x, y, z]), true);

// ── Основание ───────────────────────────────────────────────────────
const back = [];
back.push(`<path class="iso-halo" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`);
const BASE_FEET = byDepth([...k.corners(BASE, 24), [BASE.x + BASE.w / 2, BASE.y + 24], [BASE.x + BASE.w / 2, BASE.y + BASE.d - 24], [BASE.x + BASE.w * 0.25, BASE.y + BASE.d - 24], [BASE.x + BASE.w * 0.75, BASE.y + BASE.d - 24]]);
for (const [x, y] of BASE_FEET) {
  back.push(S(k.cylinder(x, y, 8, -BASE_H - FOOT_H, 1.8, P, 28), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 6, -BASE_H - FOOT_H + 1.8, FOOT_H - 1.8, P, 28), { tone: "mid" }));
  record(A.cylinder(x, y, 8, -BASE_H - FOOT_H, 1.8, { name: "stand.foot", ground: true }));
  record(A.cylinder(x, y, 6, -BASE_H - FOOT_H + 1.8, FOOT_H - 1.8, { name: "stand.foot", ground: true }));
}
back.push(S(k.slabOf(BASE, -BASE_H, BASE_H, P, 8, 1.6), { tone: "mid", inner: Ln(k.sideSeam(BASE, -5, P, 8), { tone: "faint" }) }));
record(A.slab(BASE, -BASE_H, BASE_H, { name: "stand.base", ground: true }, 8));
back.push(Ln(k.planOutline(k.insetPlan(BASE, 5), 0, P), { tone: "lo" }));
const BASE_SCREWS = k.corners(BASE, 11);
back.push(Ln(BASE_SCREWS.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }));
back.push(Dots(BASE_SCREWS.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
// Линейка вдоль фасада основания
const STRIP = { x: BASE.x + 20, y: BASE.y + BASE.d - 12, w: 250, d: 6, r: 1 };
back.push(S(k.slabOf(STRIP, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
const TICKS = k.topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 5, 5, STRIP.y, 0.6, [1.8, 3.4], P);
back.push(Ln(TICKS.minor, { tone: "lo" }), Ln(TICKS.major, { tone: "mid" }));
back.push(Dots([at([STRIP.x + 2, STRIP.y + 3, 0.6]), at([STRIP.x + STRIP.w - 2, STRIP.y + 3, 0.6])], { size: 0.45 }));
// Гравированная табличка (единственная надпись в рисунке)
const LABEL = { x: 150, y: BASE.y + BASE.d - 18, w: 66, d: 12, r: 1.2 };
back.push(S(k.slabOf(LABEL, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
back.push(Ln(k.planOutline(k.insetPlan(LABEL, 1.4), 0.8, P, 3), { tone: "faint" }));
back.push(k.faceTextSvg(k.topMatrix([LABEL.x + LABEL.w / 2, LABEL.y + 7.6], 0.8, P, "x"), "УЧЕБНЫЙ МАКЕТ", { size: 4.2, tone: "lo", anchor: "middle" }));
back.push(Dots([at([LABEL.x + 2.6, LABEL.y + LABEL.d / 2, 0.8]), at([LABEL.x + LABEL.w - 2.6, LABEL.y + LABEL.d / 2, 0.8])], { size: 0.45 }));

// Бетонная площадка улицы со швами
const PAD = { x: 40, y: -40, w: 252, d: 124, r: 3 };
const PAD_H = 1.2;
box("stand", "stand.pad", [PAD.x, PAD.y, 0], [PAD.x + PAD.w, PAD.y + PAD.d, PAD_H], { tone: "lo", crease: "faint" }, {
  r: 3,
  steps: 4,
  ground: true,
  extra: Ln([100, 160, 220].map((x) => k.lineOnTop([x, PAD.y], [x, PAD.y + PAD.d], PAD_H, P)).join("") + k.lineOnTop([PAD.x, 22], [PAD.x + PAD.w, 22], PAD_H, P), { tone: "faint" }),
});

// ── Фальшпол ─────────────────────────────────────────────────────────
// Пьедесталы: пята, стержень, оголовок — одна токарная деталь.
const PED_PROFILE = [[0, 3.6], [0.8, 3.6], [1.2, 1.3], [PED_TOP - 1.4, 1.3], [PED_TOP - 1.4, 3.2], [PED_TOP, 3.2]];
const pedestalNodes = [];
for (let x = FLOOR.x0; x <= FLOOR.x1; x += GRID) {
  for (const y of [20, 50, 80]) {
    if (x > CRAC.x0 - 4 && x < CRAC.x1 + 4 && y > CRAC.y0 - 4) continue; // под кондиционером своя рама
    pedestalNodes.push([x, y]);
  }
}
for (let y = FLOOR.y0; y < 20; y += GRID) pedestalNodes.push([FLOOR.x1, y]);
for (const [x, y] of pedestalNodes) {
  const F3 = G.frameOf([x, y, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  turned("floor", "floor.pedestal", F3, PED_PROFILE, { tone: "lo" }, { steps: 24 });
}
// Стрингеры
const STR_W = 2;
const stringerX = (y, x0, x1) => box("floor", "floor.stringer", [x0, y - STR_W / 2, PED_TOP], [x1, y + STR_W / 2, PED_TOP + STR_T], { tone: "lo" }, { r: 0.3 });
const stringerY = (x, y0, y1) => box("floor", "floor.stringer", [x - STR_W / 2, y0, PED_TOP], [x + STR_W / 2, y1, PED_TOP + STR_T], { tone: "lo" }, { r: 0.3 });
for (const y of [20, 50, 80]) {
  stringerX(y, FLOOR.x0, CRAC.x0 - 4);
  stringerX(y, CRAC.x1 + 4, FLOOR.x1);
}
for (let x = FLOOR.x0; x <= FLOOR.x1; x += GRID) {
  if (x > CRAC.x0 - 4 && x < CRAC.x1 + 4) continue;
  stringerY(x, 20 + STR_W / 2, 50 - STR_W / 2);
  stringerY(x, 50 + STR_W / 2, 80 - STR_W / 2);
}
stringerY(FLOOR.x1, FLOOR.y0, 20 - STR_W / 2);

// Настил: одна плита с вырезом под кондиционером; швы плит и три перфорированные плиты.
const DECK_RING = [
  [FLOOR.x0, FLOOR.y0],
  [FLOOR.x1, FLOOR.y0],
  [FLOOR.x1, CRAC.y0 - 2],
  [CRAC.x0 - 2, CRAC.y0 - 2],
  [CRAC.x0 - 2, FLOOR.strip],
  [FLOOR.x0, FLOOR.strip],
];
const DECK_EAR = { x: CRAC.x1 + 2, y: CRAC.y0 - 2, w: FLOOR.x1 - CRAC.x1 - 2, d: FLOOR.strip - CRAC.y0 + 2, r: 0 };
const PERF = RACKS.map((rack) => ({ x: rack.x0, y: -10, w: 30, d: 30 }));
{
  const joints = [];
  for (let x = FLOOR.x0 + GRID; x < FLOOR.x1; x += GRID) {
    joints.push(k.lineOnTop([x, FLOOR.y0], [x, x > CRAC.x0 - 2 ? CRAC.y0 - 2 : FLOOR.strip], F, P));
  }
  for (let y = FLOOR.y0 + GRID; y < FLOOR.strip; y += GRID) {
    if (y > CRAC.y0 - 2) joints.push(k.lineOnTop([FLOOR.x0, y], [CRAC.x0 - 2, y], F, P));
    else joints.push(k.lineOnTop([FLOOR.x0, y], [FLOOR.x1, y], F, P));
  }
  const perf = PERF.map((t) => {
    const holes = [];
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) holes.push(k.planOutline({ x: t.x + 3.4 + i * 3.6, y: t.y + 3.4 + j * 3.6, w: 2, d: 2, r: 0.9 }, F, P, 2));
    return { outline: k.planOutline(k.insetPlan({ ...t, r: 0.8 }, 1.4), F, P, 2), holes: holes.join("") };
  });
  const shape = record(A.extruded(DECK_RING, F - DECK_T, DECK_T, { name: "floor.deck" }));
  put(
    "floor",
    "floor.deck",
    [-120, -25, F - 1],
    S(k.extrude(DECK_RING, F - DECK_T, DECK_T, P, { convex: false, bevel: 0.5 }), { tone: "mid", crease: "faint" }) +
      Ln(joints.join(""), { tone: "faint" }) +
      `<g data-perf>${Ln(perf.map((t) => t.outline).join(""), { tone: "lo" })}${Ln(perf.map((t) => t.holes).join(""), { tone: "lo" })}</g>`,
    [shape],
    { bias: -0.5, group: "floor" },
  );
  box("floor", "floor.deck.ear", [DECK_EAR.x, DECK_EAR.y, F - DECK_T], [DECK_EAR.x + DECK_EAR.w, DECK_EAR.y + DECK_EAR.d, F], { tone: "mid", crease: "faint" }, { r: 0, bevel: 0.5, group: "floor", extra: Ln(k.lineOnTop([DECK_EAR.x, 20], [DECK_EAR.x + DECK_EAR.w, 20], F, P), { tone: "faint" }) });
}

// ── Стойки с серверами ───────────────────────────────────────────────
const SERVER_Z = Array.from({ length: 8 }, (_, i) => F + 10 + i * 10.6);
const SERVER_H = 8;
for (const rack of RACKS) {
  const { x0, x1, y0, y1, z0, z1, index } = rack;
  const g = `racks`;
  const own = `rack${index + 1}`;
  for (const [x, y] of byDepth([[x0 + 3, y0 + 3], [x1 - 3, y0 + 3], [x0 + 3, y1 - 3], [x1 - 3, y1 - 3]])) cyl("racks", `${own}.foot`, x, y, 1.6, z0, 2, { tone: "lo" }, { steps: 16, owner: own, group: g });
  box("racks", `${own}.plinth`, [x0, y0, z0 + 2], [x1, y1, z0 + 6], { tone: "lo" }, { owner: own, group: g, extra: Dots([at([x0 + 6, y1, z0 + 4]), at([x1 - 6, y1, z0 + 4])], { size: 0.4 }) });
  // каркас: стойки рамы и крыша
  for (const [x, y] of [[x0, y0], [x1 - 2.4, y0], [x0, y1 - 2.4], [x1 - 2.4, y1 - 2.4]]) box("racks", `${own}.post`, [x, y, z0 + 6], [x + 2.4, y + 2.4, z1 - 3], { tone: "mid" }, { r: 0.3, owner: own, group: g });
  // задняя стенка и боковины
  box("racks", `${own}.back`, [x0 + 2.4, y0, z0 + 6], [x1 - 2.4, y0 + 1, z1 - 3], { tone: "lo" }, { r: 0.2, owner: own, group: g });
  for (const x of [x0, x1 - 1]) {
    const seam = [z0 + 36, z0 + 66].map((z) => path3([[x + (x === x0 ? 0 : 1), y0 + 2.4, z], [x + (x === x0 ? 0 : 1), y1 - 2.4, z]])).join("");
    const louvres = x === x1 - 1 ? [0, 1, 2, 3, 4, 5].map((i) => slotX((y0 + y1) / 2, z0 + 76 + i * 2.6, 26, 1.1, x + 1)).join("") : "";
    box("racks", `${own}.side`, [x, y0 + 2.4, z0 + 6], [x + 1, y1 - 2.4, z1 - 3], { tone: "mid" }, { r: 0.2, owner: own, group: g, extra: Ln(seam, { tone: "faint" }) + Ln(louvres, { tone: "lo" }) + Dots([z0 + 12, z1 - 9].flatMap((z) => [at([x + 1, y0 + 6, z]), at([x + 1, y1 - 6, z])]), { size: 0.4 }) });
  }
  box("racks", `${own}.roof`, [x0, y0, z1 - 3], [x1, y1, z1], { tone: "mid" }, {
    r: 0.6,
    steps: 3,
    bevel: 0.4,
    owner: own,
    group: g,
    extra: Ln([0, 1, 2].map((i) => k.planOutline({ x: x0 + 6, y: y0 + 10 + i * 14, w: 18, d: 6, r: 2.4 }, z1, P, 3)).join(""), { tone: "faint" }) + Dots(k.corners({ x: x0, y: y0, w: 30, d: 60 }, 3).map(([x, y]) => at([x, y, z1])), { size: 0.45 }),
  });
  // монтажные профили (19") с отверстиями
  for (const x of [x0 + 2.4, x1 - 4.4]) {
    const holes = [];
    for (let z = z0 + 9; z < z1 - 5; z += 3.5) holes.push(at([x + 1, y1 - 3.4, z]));
    box("racks", `${own}.rail`, [x, y1 - 4.4, z0 + 6], [x + 2, y1 - 3.4, z1 - 3], { tone: "mid" }, { r: 0.15, steps: 1, owner: own, group: g, extra: Dots(holes, { size: 0.3, tone: "lo" }) });
  }
  // серверы
  SERVER_Z.forEach((z, s) => {
    const sv = `${own}.srv${s + 1}`;
    const cx0 = x0 + 4.4;
    const cx1 = x1 - 4.4;
    const front = y1 - 2.2;
    const plan = { x: cx0, y: y0 + 4, w: cx1 - cx0, d: front - (y0 + 4), r: 0.3 };
    const slots = [];
    for (let i = 0; i < 6; i++) slots.push(slotY(cx0 + 4 + i * 2.2, z + 4, 1, 5.2, front));
    const leds = [at([cx1 - 3.6, front, z + 5.6]), at([cx1 - 2.2, front, z + 5.6])];
    const extra = Ln(slots.join(""), { tone: "lo" }) + Ln(slotY(cx1 - 5.2, z + 2.4, 5.6, 1.6, front, 0.6), { tone: "faint" }) + `<g class="led">${Dots(leds, { size: 0.5, tone: "hi" })}</g>`;
    const shapes = [record(A.slab(plan, z, SERVER_H, { name: sv, owner: sv }, 2))];
    const svg = S(k.slabOf(plan, z, SERVER_H, P, 2, 0.3), { tone: "hi", crease: "lo" }) + extra;
    put("racks", sv, [(cx0 + cx1) / 2, front - 4, z + 4], svg, shapes, { group: g, attrs: ` data-server="${index}-${s}"` });
    // ушки с винтами на профилях
    for (const [ex0, ex1] of [[x0 + 2.4, cx0], [cx1, x1 - 2.4]]) {
      const ex = (ex0 + ex1) / 2;
      box("racks", `${sv}.ear`, [ex0, y1 - 3.4, z + 0.6], [ex1, y1 - 2.2, z + SERVER_H - 0.6], { tone: "mid", crease: "none" }, { r: 0.1, steps: 1, owner: sv, group: g, extra: Dots([at([ex, y1 - 2.2, z + 2.2]), at([ex, y1 - 2.2, z + 5.8])], { size: 0.42, tone: "mid" }) });
    }
  });
}

// ── Кондиционер: опорная рама в подполье ────────────────────────────
{
  const g = "crac";
  const own = "crac.stand";
  const legs = [[CRAC.x0 + 3, CRAC.y0 + 3], [CRAC.x1 - 3, CRAC.y0 + 3], [CRAC.x0 + 3, CRAC.y1 - 3], [CRAC.x1 - 3, CRAC.y1 - 3]];
  for (const [x, y] of byDepth(legs)) {
    const F3 = G.frameOf([x, y, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
    turned("crac", "crac.stand.leg", F3, [[0, 3.4], [0.9, 3.4], [0.9, 1], [4, 1], [4, 2.2], [6, 2.2], [6, 1.4], [F - 4, 1.4]], { tone: "lo" }, { owner: own, group: g, steps: 20 });
  }
  box("crac", "crac.stand.rail", [CRAC.x0, CRAC.y0, F - 4], [CRAC.x1, CRAC.y0 + 4, F], { tone: "lo" }, { owner: own, group: g });
  box("crac", "crac.stand.rail", [CRAC.x0, CRAC.y1 - 4, F - 4], [CRAC.x1, CRAC.y1, F], { tone: "lo" }, { owner: own, group: g, extra: Dots([CRAC.x0 + 10, CRAC.x1 - 10].map((x) => at([x, CRAC.y1, F - 2])), { size: 0.4 }) });
  box("crac", "crac.stand.rail", [CRAC.x0, CRAC.y0 + 4, F - 4], [CRAC.x0 + 4, CRAC.y1 - 4, F], { tone: "lo" }, { owner: own, group: g });
  box("crac", "crac.stand.rail", [CRAC.x1 - 4, CRAC.y0 + 4, F - 4], [CRAC.x1, CRAC.y1 - 4, F], { tone: "lo" }, { owner: own, group: g });
}

// ── Кондиционер: корпус (передняя панель снята, разрез открыт) ──────
const CR = { ...CRAC };
{
  const g = "crac";
  const own = "crac.case";
  const { x0, x1, y0, y1, z0, z1 } = CR;
  // нижняя рама шкафа
  box("crac", "crac.base", [x0, y0, z0], [x1, y0 + 3, z0 + 4], { tone: "mid" }, { owner: own, group: g });
  box("crac", "crac.base", [x0, y1 - 3, z0], [x1, y1, z0 + 4], { tone: "mid" }, { owner: own, group: g, extra: Dots([x0 + 8, (x0 + x1) / 2, x1 - 8].map((x) => at([x, y1, z0 + 2])), { size: 0.4 }) });
  box("crac", "crac.base", [x0, y0 + 3, z0], [x0 + 3, y1 - 3, z0 + 4], { tone: "mid" }, { owner: own, group: g });
  box("crac", "crac.base", [x1 - 3, y0 + 3, z0], [x1, y1 - 3, z0 + 4], { tone: "mid" }, { owner: own, group: g });
  // стойки каркаса
  for (const [x, y] of [[x0, y0], [x1 - POST, y0], [x0, y1 - POST], [x1 - POST, y1 - POST]]) box("crac", "crac.post", [x, y, z0 + 4], [x + POST, y + POST, z1 - PANEL], { tone: "mid" }, { r: 0.3, owner: own, group: g });
  // задняя панель и левая боковина
  box("crac", "crac.back", [x0 + POST, y0, z0 + 4], [x1 - POST, y0 + PANEL, z1 - PANEL], { tone: "lo" }, { r: 0.2, owner: own, group: g, bias: -1 });
  box("crac", "crac.side.left", [x0, y0 + POST, z0 + 4], [x0 + PANEL, y1 - POST, z1 - PANEL], { tone: "lo" }, { r: 0.2, owner: own, group: g, bias: -1 });
  // правая боковина с жалюзи
  {
    const x = x1 - PANEL;
    const louvres = [];
    for (let i = 0; i < 9; i++) louvres.push(slotX((y0 + y1) / 2, z0 + 14 + i * 3, 30, 1.2, x1));
    const seams = [z0 + 48].map((z) => path3([[x1, y0 + POST, z], [x1, y1 - POST, z]])).join("");
    box("crac", "crac.side.right", [x, y0 + POST, z0 + 4], [x1, y1 - POST, z1 - PANEL], { tone: "mid" }, {
      r: 0.2,
      owner: own,
      group: g,
      extra: Ln(louvres.join(""), { tone: "lo" }) + Ln(seams, { tone: "faint" }) + Dots([z0 + 8, z0 + 44, z0 + 52, z1 - 6].flatMap((z) => [at([x1, y0 + 6, z]), at([x1, y1 - 6, z])]), { size: 0.42 }),
    });
  }
  // крыша: решётка возврата над воздушной секцией
  {
    const top = z1;
    const grille = [];
    for (let i = 0; i < 9; i++) grille.push(k.planOutline({ x: x0 + 8 + i * 5.6, y: y0 + 8, w: 2.6, d: y1 - y0 - 16, r: 1.2 }, top, P, 3));
    box("crac", "crac.roof", [x0, y0, z1 - PANEL], [x1, y1, z1], { tone: "mid" }, {
      r: 0.5,
      steps: 3,
      bevel: 0.4,
      owner: own,
      group: g,
      extra:
        Ln(k.planOutline({ x: x0 + 5, y: y0 + 5, w: PART_X - x0 - 6, d: y1 - y0 - 10, r: 1.6 }, top, P, 3), { tone: "lo" }) +
        `<g data-grille>${Ln(grille.join(""), { tone: "lo" })}</g>` +
        Dots(k.corners({ x: x0, y: y0, w: x1 - x0, d: y1 - y0 }, 2.6).map(([x, y]) => at([x, y, top])), { size: 0.45 }) +
        Dots([at([PART_X + 6, y0 + 6, top]), at([PART_X + 6, y1 - 6, top])], { size: 0.4 }),
    });
  }
}

// ── Кондиционер: начинка ─────────────────────────────────────────────
// Воздушная секция слева от перегородки, машинный отсек справа.
const AIR = { x0: CRAC.x0 + POST, x1: PART_X, y0: CRAC.y0 + PANEL, y1: CRAC.y1 - POST };
const COIL = { x0: AIR.x0, x1: -56, plate: 2, boss: 2 }; // теплообменники до трубной доски
const FC = { z0: 86, z1: 106, inY: 58, inZ: 102, outY: 70, outZ: 96 };
const DX = { z0: 60, z1: 80, liqY: 46, liqZ: 70, sucY: 64, sucZ: 64 };
const FILTER = { z0: 110, z1: 116 };
const FANC = { x: -77, y: 56, deck: 56, r: 13.5 };
const S_RISER = { x: -32, y: LANE.S };
const R_RISER = { x: -36, y: LANE.R };
const JOINT = CRAC.z0 + 8; // фланцевый стык наружной и внутренней трубы
const BPHE = { x0: -7.5, x1: -3, y0: 40, y1: 74, z0: 66, z1: 100, boss: 1.5, refIn: [64, 90], refOut: [46, 70], glyIn: [LANE.S, 74], glyOut: [LANE.R, 96] };
const COMP = { x: -16, y: 64, r: 7.5, z0: CRAC.z0 + 4 };
const BALL = 3.6;
const PORT_X = COIL.x1 + COIL.plate + COIL.boss; // торец патрубков теплообменников
const MODE_PARTS = new Set();
{
  const g = "crac";
  // фильтр на направляющих
  for (const [ya, yb] of [[AIR.y0, AIR.y0 + 2], [AIR.y1 - 2, AIR.y1]]) box("crac", "crac.filter.rail", [AIR.x0, ya, FILTER.z0 - 2], [AIR.x1, yb, FILTER.z0], { tone: "lo" }, { owner: "crac.case", group: g });
  {
    const pleats = [];
    const n = 22;
    for (let i = 0; i <= n; i++) pleats.push([AIR.x0 + ((AIR.x1 - AIR.x0) * i) / n, AIR.y1, i % 2 ? FILTER.z1 - 0.6 : FILTER.z0 + 0.6]);
    const zig = path3([[AIR.x0, AIR.y1, FILTER.z0 + 0.6], ...pleats.slice(1, -1), [AIR.x1, AIR.y1, pleats[n][2]]]);
    box("crac", "crac.filter", [AIR.x0, AIR.y0, FILTER.z0], [AIR.x1, AIR.y1, FILTER.z1], { tone: "hi", crease: "lo" }, { r: 0.3, owner: "crac.filter", group: g, extra: Ln(path3([[AIR.x0, AIR.y1, FILTER.z0 + 0.6], [AIR.x1, AIR.y1, FILTER.z0 + 0.6]]) + path3([[AIR.x0, AIR.y1, FILTER.z1 - 0.6], [AIR.x1, AIR.y1, FILTER.z1 - 0.6]]), { tone: "faint" }) + Ln(zig, { tone: "lo" }) });
  }
  // два теплообменника: ряды фрикулинга сверху, испаритель снизу
  const coil = (name, z0, z1, ports, tone) => {
    const fins = [];
    for (let x = COIL.x0 + 1.4; x < COIL.x1 - 0.5; x += 1.4) fins.push(path3([[x, AIR.y1, z0], [x, AIR.y1, z1]]));
    const id = box("crac", name, [COIL.x0, AIR.y0, z0], [COIL.x1, AIR.y1, z1], { tone, crease: "lo" }, { r: 0.2, owner: name, group: g, extra: Ln(fins.join(""), { tone: "lo" }) });
    MODE_PARTS.add(id);
    const bends = [];
    for (let row = 0; row < 3; row++) for (let i = 0; i < 7; i++) bends.push(at([COIL.x1 + COIL.plate, AIR.y0 + 4 + i * 6.2, z0 + 4 + row * ((z1 - z0 - 8) / 2)]));
    const plate = box("crac", `${name}.plate`, [COIL.x1, AIR.y0, z0], [COIL.x1 + COIL.plate, AIR.y1, z1], { tone: "mid" }, { r: 0.2, owner: name, group: g, extra: Dots(bends, { size: 0.38, tone: "mid" }) });
    MODE_PARTS.add(plate);
    for (const [y, z, r] of ports) disc("crac", `${name}.port`, G.frameAlong([COIL.x1 + COIL.plate, y, z], [1, 0, 0]), 0, COIL.boss, r, { tone: "hi" }, { owner: name, group: g });
  };
  coil("crac.coil.fc", FC.z0, FC.z1, [[FC.inY, FC.inZ, 3.6], [FC.outY, FC.outZ, 3.6]], "hi");
  coil("crac.coil.dx", DX.z0, DX.z1, [[DX.liqY, DX.liqZ, 1.6], [DX.sucY, DX.sucZ, 1.6]], "hi");
  // палуба вентилятора и радиальный вентилятор
  box("crac", "crac.fan.deck", [AIR.x0, AIR.y0, FANC.deck], [-50, AIR.y1, FANC.deck + 2], { tone: "mid" }, { owner: "crac.fan", group: g, extra: Dots([AIR.x0 + 4, -54].flatMap((x) => [at([x, AIR.y0 + 4, FANC.deck + 2]), at([x, AIR.y1 - 3, FANC.deck + 2])]), { size: 0.4 }) });
  const FF = G.frameOf([FANC.x, FANC.y, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  turned("crac", "crac.fan.inlet", FF, [[FANC.deck + 2, 15.6], [FANC.deck + 2.8, 15.6], [FANC.deck + 2.8, 13.2]], { tone: "mid" }, { owner: "crac.fan", group: g });
  // рабочее колесо: покрывной диск, лопатки (перестраиваются при вращении), основной диск
  const shroud = G.ringBand(FANC.deck - 4, FANC.deck, 12, 15, FF, P);
  const back = G.disc(40, 41.2, 15, FF, P);
  const bladeD = (phase) => k.fadedSvg(G.ribsOf(FF, 41.2, FANC.deck - 4, 15, 22, P, { phase, twist: 0.35, fade: [0.05, 0.5] }), { tone: "mid" });
  put("crac", "crac.fan.wheel", [FANC.x, FANC.y, 47], S(back, { tone: "mid" }) + `<path class="iso-shade" data-shade="0" d="${G.disc(41.2, FANC.deck - 4, 14.6, FF, P).fill}"/>` + `<g data-wheel>${bladeD(0)}</g>` + S(shroud, { tone: "hi" }), [record(A.disc(FF, 40, FANC.deck, 15, { name: "crac.fan.wheel", owner: "crac.fan" }))], { group: g });
  turned("crac", "crac.fan.motor", FF, [[31.2, 7], [40, 7]], { tone: "mid" }, { owner: "crac.fan", group: g, extra: "" });
  box("crac", "crac.fan.beam", [FANC.x - 3, CRAC.y0 + PANEL, CRAC.z0 + 4], [FANC.x + 3, CRAC.y1 - POST, CRAC.z0 + 7.2], { tone: "lo" }, { owner: "crac.fan", group: g, extra: Dots([at([FANC.x - 1.6, CRAC.y1 - POST, CRAC.z0 + 5.6]), at([FANC.x + 1.6, CRAC.y1 - POST, CRAC.z0 + 5.6])], { size: 0.4 }) });
  FAN_WHEEL.d = bladeD;
  FAN_WHEEL.frame = FF;

  // ── машинный отсек ──
  box("crac", "crac.comp.plate", [-22.5, 52, CRAC.z0], [CRAC.x1 - POST, CRAC.y1 - POST, CRAC.z0 + 2], { tone: "lo" }, { owner: "crac.case", group: g, extra: Dots([at([-20, 75, CRAC.z0 + 2]), at([CRAC.x1 - 6, 75, CRAC.z0 + 2])], { size: 0.4 }) });
  for (const [dx, dy] of [[-4.5, -4.5], [4.5, -4.5], [-4.5, 4.5], [4.5, 4.5]].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P))) cyl("crac", "crac.comp.mount", COMP.x + dx, COMP.y + dy, 1.6, CRAC.z0 + 2, 2, { tone: "lo" }, { steps: 16, owner: "crac.comp", group: g });
  const CF = G.frameOf([COMP.x, COMP.y, COMP.z0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const dome = (s) => (s <= 24 ? COMP.r : COMP.r * Math.sqrt(Math.max(0, 1 - ((s - 24) / 6.4) ** 2)));
  const domeSlope = (s) => (s <= 24 ? 0 : Math.max(-30, (-COMP.r * (s - 24)) / (6.4 ** 2 * Math.sqrt(Math.max(1e-3, 1 - ((s - 24) / 6.4) ** 2)))));
  const shell = turned("crac", "crac.comp", CF, [[0, COMP.r + 0.8], [1.2, COMP.r + 0.8]], { tone: "mid" }, { owner: "crac.comp", group: g });
  const bodyProfile = [[1.2, COMP.r], ...Array.from({ length: 22 }, (_, i) => { const s = 24 + (6.4 * (i + 1)) / 22; return [s, Math.max(0.2, dome(s)), 1]; })];
  const body = turned("crac", "crac.comp.shell", CF, [[1.2, COMP.r], [24, COMP.r, 1], ...bodyProfile.slice(1)], { tone: "hi" }, { owner: "crac.comp", group: g, smooth: { slope: domeSlope, radius: (s) => Math.max(0.2, dome(s)) }, inner: Ln(k.sideArc(COMP.x, COMP.y, COMP.r, COMP.z0 + 12, P, 40), { tone: "faint" }) });
  MODE_PARTS.add(body.item);
  MODE_PARTS.add(shell.item);
  // клеммная крышка, нагнетательный и всасывающий патрубки на седловых площадках
  const termFace = padOn("crac", "crac.comp.term", body, [COMP.x, COMP.y + COMP.r - 0.3, COMP.z0 + 16], [0, 1, 0], 3, 1.2, { tone: "mid" }, { owner: "crac.comp", group: g });
  disc("crac", "crac.comp.cover", G.frameAlong(termFace, [0, 1, 0]), 0, 1.6, 3.6, { tone: "mid" }, { owner: "crac.comp", group: g });
  COMP.discharge = padOn("crac", "crac.comp.dis", body, [COMP.x, COMP.y, COMP.z0 + 30.4 - 0.4], [0, 0, 1], 1.5, 1.6, { tone: "hi" }, { owner: "crac.comp", group: g });
  COMP.suction = padOn("crac", "crac.comp.suc", body, [COMP.x - COMP.r + 0.3, COMP.y, COMP.z0 + 24.6], [-1, 0, 0], 1.5, 1.4, { tone: "hi" }, { owner: "crac.comp", group: g });

  // пластинчатый конденсатор на кронштейнах к правой боковине
  {
    const { x0, x1, y0, y1, z0, z1 } = BPHE;
    const plates = [];
    for (let x = x0 + 0.8; x < x1 - 0.4; x += 0.8) plates.push(path3([[x, y1, z0 + 1.6], [x, y1, z1 - 1.6]]));
    const id = box("crac", "crac.bphe", [x0, y0, z0], [x1, y1, z1], { tone: "hi", crease: "lo" }, { r: 0.4, owner: "crac.bphe", group: g, extra: Ln(plates.join(""), { tone: "faint" }) });
    MODE_PARTS.add(id);
    for (const z of [z0 - 1.2, z1]) box("crac", "crac.bphe.cover", [x0 - 0.6, y0 - 0.6, z], [x1 + 0.6, y1 + 0.6, z + 1.2], { tone: "mid" }, { r: 0.4, owner: "crac.bphe", group: g, extra: Dots([at([x0, y1 + 0.6, z + 0.6]), at([x1, y1 + 0.6, z + 0.6])], { size: 0.36 }) });
    for (const z of [z0 + 4, z1 - 4]) box("crac", "crac.bphe.bracket", [x1, y0 + 4, z - 1], [CRAC.x1 - PANEL, y1 - 4, z + 1], { tone: "lo" }, { owner: "crac.bphe", group: g });
    for (const [y, z, r] of [[...BPHE.glyIn, 3.6], [...BPHE.glyOut, 3.6], [...BPHE.refIn, 1.6], [...BPHE.refOut, 1.6]]) disc("crac", "crac.bphe.port", G.frameAlong([x0, y, z], [-1, 0, 0]), 0, BPHE.boss, r, { tone: "hi" }, { owner: "crac.bphe", group: g });
  }
  // контроллер с дисплеем
  {
    const C = { x0: -24, x1: CRAC.x1 - POST, y0: 70, y1: CRAC.y1 - 1, z0: 104, z1: 118 };
    const front = C.y1;
    const extra =
      `<path class="dc-screen" d="${slotY(C.x0 + 7, C.z0 + 9.4, 9, 5.4, front, 0.6)}"/>` +
      Ln(slotY(C.x0 + 7, C.z0 + 9.4, 9, 5.4, front, 0.6), { tone: "lo" }) +
      Dots([C.x0 + 14.4, C.x0 + 17, C.x0 + 19.6].map((x) => at([x, front, C.z0 + 9.4])), { size: 0.55, tone: "mid" }) +
      `<g class="led" data-led="ctrl">${Dots([at([C.x0 + 3, front, C.z0 + 3])], { size: 0.55, tone: "hi" })}</g>` +
      Ln(slotY((C.x0 + C.x1) / 2, C.z0 + 3, 9, 1.2, front, 0.5), { tone: "faint" });
    box("crac", "crac.ctrl", [C.x0, C.y0, C.z0], [C.x1, C.y1, C.z1], { tone: "hi", crease: "lo" }, { r: 0.6, steps: 2, bevel: 0.3, owner: "crac.ctrl", group: g, extra });
  }
}

// ── Внутренние жидкостные соединения ─────────────────────────────────
const RIM = (r) => Math.sqrt(BALL ** 2 - r ** 2);
const SB = [S_RISER.x, S_RISER.y, 74]; // тройник подачи: ветка к конденсатору
const RB = [R_RISER.x, R_RISER.y, FC.outZ]; // тройник возврата
ball("glycol", "glycol.tee.supply", SB, BALL, { tone: "hi" }, { group: "glycol" });
ball("glycol", "glycol.tee.return", RB, BALL, { tone: "hi" }, { group: "glycol" });
const INNER = {};
INNER.sUp = pipe("glycol", "glycol.crac.supply", [[S_RISER.x, S_RISER.y, JOINT], [S_RISER.x, S_RISER.y, SB[2] - RIM(GR)]], GR, { group: "glycol", flanges: [true, false], flangeR: 2.45 });
INNER.sFC = pipe("glycol", "glycol.crac.fc.in", [[S_RISER.x, S_RISER.y, SB[2] + RIM(GR)], [S_RISER.x, S_RISER.y, FC.inZ], [PORT_X, FC.inY, FC.inZ]], GR, { group: "glycol", flanges: [false, true], valve: 13, valveR: GR });
valveOn("glycol", "crac.valve12", INNER.sFC, 13, GR, { side: [1, 0, 0], group: "glycol" });
INNER.sCond = pipe("glycol", "glycol.crac.cond.in", [[SB[0] + RIM(GR), SB[1], SB[2]], [BPHE.x0 - BPHE.boss, ...BPHE.glyIn]], GR, { group: "glycol", flanges: [false, true], valve: 6, valveR: GR });
valveOn("glycol", "crac.valve13", INNER.sCond, 6, GR, { side: [0, 0, 1], group: "glycol" });
INNER.rFC = pipe("glycol", "glycol.crac.fc.out", [[PORT_X, FC.outY, FC.outZ], [RB[0] - RIM(GR), RB[1], RB[2]]], GR, { group: "glycol", flanges: [true, false] });
INNER.rCond = pipe("glycol", "glycol.crac.cond.out", [[BPHE.x0 - BPHE.boss, ...BPHE.glyOut], [RB[0] + RIM(GR), RB[1], RB[2]]], GR, { group: "glycol", flanges: [true, false] });
INNER.rDown = pipe("glycol", "glycol.crac.return", [[RB[0], RB[1], RB[2] - RIM(GR)], [R_RISER.x, R_RISER.y, JOINT]], GR, { group: "glycol", flanges: [false, true], flangeR: 2.45 });

// ── Холодильный контур ───────────────────────────────────────────────
const REF = {};
REF.discharge = pipe("crac", "ref.discharge", [COMP.discharge, [COMP.x, COMP.y, BPHE.refIn[1]], [BPHE.x0 - BPHE.boss, ...BPHE.refIn]], RR, { group: "crac", flanges: [false, false], tone: "mid", bend: 4 });
REF.liquid = pipe("crac", "ref.liquid", [[BPHE.x0 - BPHE.boss, ...BPHE.refOut], [PORT_X, DX.liqY, DX.liqZ]], RR, { group: "crac", flanges: [false, false], tone: "mid", valve: 24, valveR: 1.3 });
valveOn("crac", "crac.txv", REF.liquid, 24, 1.3, { side: [0, 0, 1], group: "crac" });
REF.suction = pipe("crac", "ref.suction", [[PORT_X, DX.sucY, DX.sucZ], [-46.5, DX.sucY, DX.sucZ], [-46.5, DX.sucY, COMP.suction[2]], COMP.suction], RR, { group: "crac", flanges: [false, false], tone: "mid", bend: 4 });
for (const name of ["crac.valve12", "crac.valve13", "crac.txv"]) MODE_PARTS.add(name);

// ── Драйкулер ────────────────────────────────────────────────────────
const FAN_ITEMS = [];
{
  const g = "dry";
  const own = "dry.frame";
  const { x0, x1, y0, y1, legTop, coil1, deck0, deck1 } = DRY;
  const coil0 = legTop;
  for (const [lx, ly] of byDepth([[x0 + 18, y0], [x1 - 21, y0], [x0 + 18, y1 - 3], [x1 - 21, y1 - 3]])) {
    box("dry", "dry.foot", [lx - 2.5, ly - 2.5, PAD_H], [lx + 5.5, ly + 5.5, PAD_H + 1.2], { tone: "lo" }, { owner: own, group: g, extra: Dots([at([lx - 1.3, ly - 1.3, PAD_H + 1.2]), at([lx + 4.3, ly + 4.3, PAD_H + 1.2])], { size: 0.45, tone: "hi" }) });
    box("dry", "dry.leg", [lx, ly, PAD_H + 1.2], [lx + 3, ly + 3, legTop - 2], { tone: "mid" }, { r: 0.3, owner: own, group: g });
  }
  // нижняя рама
  box("dry", "dry.rail", [x0 + 3, y1 - 3, legTop - 2], [x1 - 3, y1, legTop], { tone: "mid" }, { owner: own, group: g, extra: Dots([x0 + 8, x1 - 8].map((x) => at([x, y1, legTop - 1])), { size: 0.4 }) });
  box("dry", "dry.rail", [x0 + 3, y0, legTop - 2], [x1 - 3, y0 + 3, legTop], { tone: "mid" }, { owner: own, group: g });
  // теплообменник: оребрение видно с фасада, трубные доски по торцам
  const fins = [];
  for (let x = x0 + 6.2; x < x1 - 5.5; x += 1.5) fins.push(path3([[x, y1 - 1, coil0], [x, y1 - 1, coil1]]));
  box("dry", "dry.coil", [x0 + 5, y0 + 1, coil0], [x1 - 5, y1 - 1, coil1], { tone: "mid", crease: "faint" }, { r: 0.2, owner: "dry.coil", group: g, extra: Ln(fins.join(""), { tone: "lo" }) });
  const bends = [];
  for (let row = 0; row < 3; row++) for (let i = 0; i < 10; i++) bends.push(at([x1 - 3, y0 + 6 + i * 6.2, coil0 + 3.5 + row * 5.5]));
  box("dry", "dry.tubesheet", [x1 - 5, y0 + 1, coil0], [x1 - 3, y1 - 1, coil1], { tone: "mid" }, { owner: "dry.coil", group: g, extra: Dots(bends, { size: 0.42, tone: "mid" }) });
  box("dry", "dry.tubesheet", [x0 + 3, y0 + 1, coil0], [x0 + 5, y1 - 1, coil1], { tone: "mid" }, { owner: "dry.coil", group: g });
  // боковые панели над теплообменником
  box("dry", "dry.panel", [x0 + 3, y0 + 1, coil1], [x1 - 3, y1 - 1, deck0], { tone: "mid" }, {
    owner: own,
    group: g,
    extra: Dots([x0 + 12, (x0 + x1) / 2, x1 - 12].flatMap((x) => [at([x, y1 - 1, coil1 + 1.4]), at([x, y1 - 1, deck0 - 1.4])]), { size: 0.4 }),
  });
  // палуба вентиляторов
  box("dry", "dry.deck", [x0, y0, deck0], [x1, y1, deck1], { tone: "mid" }, {
    r: 0.6,
    steps: 3,
    bevel: 0.4,
    owner: own,
    group: g,
    extra: Dots(k.corners({ x: x0, y: y0, w: x1 - x0, d: y1 - y0 }, 2.4).map(([x, y]) => at([x, y, deck1])), { size: 0.45 }) + Ln(k.lineOnTop([(x0 + x1) / 2, y0], [(x0 + x1) / 2, y1], deck1, P), { tone: "faint" }),
  });
  // электрический короб на торце
  box("dry", "dry.ebox", [x1 - 3, 30, coil0 + 3], [x1 + 1.6, 52, coil1 + 1], { tone: "hi" }, {
    r: 0.6,
    steps: 2,
    bevel: 0.3,
    owner: "dry.ebox",
    group: g,
    extra: Ln(slotX(41, (coil0 + coil1) / 2 + 2, 19, 13.4, x1 + 1.6, 0.8), { tone: "faint" }) + Dots([at([x1 + 1.6, 32, coil0 + 5]), at([x1 + 1.6, 50, coil1 - 1])], { size: 0.42 }),
  });
  disc("dry", "dry.ebox.gland", G.frameAlong([x1 - 0.7, 46, coil0 + 3], [0, 0, -1]), 0, 1.6, 1.2, { tone: "mid" }, { owner: "dry.ebox", group: g });
  // вентиляторы: кожух-диффузор, лопасти в плоскости ротора, двигатель, решётка
  FANS.forEach((fan, index) => {
    const FF = G.frameOf([fan.x, fan.y, deck1], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
    const name = `dry.fan${index + 1}`;
    const h = FAN.top - deck1;
    const shroud = S(G.ringBand(0, h, FAN.rIn, FAN.rOut, FF, P), { tone: "mid" });
    const cavity = `<path class="iso-shade" data-shade="0" d="${k.ring(fan.x, fan.y, FAN.rIn, FAN.top, P, 96)}"/>`;
    const o = [fan.x, fan.y, FAN.rotor];
    const p0 = at(o);
    const px = at(G.add3(o, [1, 0, 0]));
    const py = at(G.add3(o, [0, 1, 0]));
    const v4 = (x) => x.toFixed(4);
    const matrix = `matrix(${v4(px[0] - p0[0])} ${v4(px[1] - p0[1])} ${v4(py[0] - p0[0])} ${v4(py[1] - p0[1])} ${p0[0].toFixed(2)} ${p0[1].toFixed(2)})`;
    const lift = FAN.top - FAN.rotor;
    const clip = [-lift * V[0] / V[2], -lift * V[1] / V[2]];
    const blades = Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * Math.PI * 2;
      const pt = (r, da) => `${f2(r * Math.cos(a + da))} ${f2(r * Math.sin(a + da))}`;
      return `M${pt(6.2, -0.34)}Q${pt(13.5, -0.12)} ${pt(20.6, 0.02)}Q${pt(21.2, 0.2)} ${pt(20.6, 0.42)}Q${pt(13.5, 0.46)} ${pt(6.2, 0.36)}Z`;
    }).join("");
    // те же лопасти для 3D: квадратичные дуги в плоскости ротора, точки в мировых единицах от оси
    BLADES3D.push({ item: name, c: [fan.x, fan.y], z: FAN.rotor, deck: deck1, rIn: FAN.rIn, blades: Array.from({ length: 5 }, (_, i) => {
      const a = (i / 5) * Math.PI * 2;
      const pt = (r, da) => [r * Math.cos(a + da), r * Math.sin(a + da)];
      const q = (p0, p1, p2) => Array.from({ length: 8 }, (_, j) => { const t = (j + 1) / 8; return [0, 1].map((k2) => (1 - t) * (1 - t) * p0[k2] + 2 * (1 - t) * t * p1[k2] + t * t * p2[k2]); });
      const s = pt(6.2, -0.34);
      return [s, ...q(s, pt(13.5, -0.12), pt(20.6, 0.02)), ...q(pt(20.6, 0.02), pt(21.2, 0.2), pt(20.6, 0.42)), ...q(pt(20.6, 0.42), pt(13.5, 0.46), pt(6.2, 0.36))].map((p) => p.map(f2));
    }) });
    const rotor = `<g transform="${matrix}"><clipPath id="dc-fan${index}"><circle cx="${f2(clip[0])}" cy="${f2(clip[1])}" r="${FAN.rIn - 0.3}"/></clipPath><g clip-path="url(#dc-fan${index})"><g data-fan="${index}"><path class="dc-blade" d="${blades}"/></g></g></g>`;
    const motorTop = FAN.top - 0.1;
    const motor = S(k.cylinder(fan.x, fan.y, 6, FAN.rotor - 1.4, motorTop - FAN.rotor + 1.4, P, 40, 0.3), { tone: "mid" }) + Ln(k.ring(fan.x, fan.y, 3.4, motorTop, P, 32), { tone: "lo" }) + Dots([0, 1, 2, 3].map((i) => at([fan.x + 4.6 * Math.cos(i * Math.PI / 2 + 0.4), fan.y + 4.6 * Math.sin(i * Math.PI / 2 + 0.4), motorTop])), { size: 0.4 });
    const gz = FAN.top + 0.25;
    const WIRE = 0.25;
    const ringPts = (r) => Array.from({ length: 97 }, (_, i) => [fan.x + r * Math.cos((i / 96) * Math.PI * 2), fan.y + r * Math.sin((i / 96) * Math.PI * 2), gz]);
    const spokeAngles = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2 + 0.2);
    const guardShapes = [...[9.5, 15, 20.2, FAN.rIn + 0.9].map((r) => record(A.tube(ringPts(r), WIRE, { name: `${name}.guard`, owner: name }))), ...spokeAngles.map((a) => record(A.tube([[fan.x + 6 * Math.cos(a), fan.y + 6 * Math.sin(a), gz], [fan.x + (FAN.rIn + 0.9) * Math.cos(a), fan.y + (FAN.rIn + 0.9) * Math.sin(a), gz]], WIRE, { name: `${name}.guard`, owner: name })))];
    const guard = [9.5, 15, 20.2].map((r) => k.ring(fan.x, fan.y, r, gz, P, 96)).join("") + k.ring(fan.x, fan.y, FAN.rIn + 0.9, gz, P, 96) + spokeAngles.map((a) => {
      return k.lineOnTop([fan.x + 6 * Math.cos(a), fan.y + 6 * Math.sin(a)], [fan.x + (FAN.rIn + 0.9) * Math.cos(a), fan.y + (FAN.rIn + 0.9) * Math.sin(a)], gz, P);
    }).join("");
    const shapes = [
      record(A.ring(FF, 0, h, FAN.rIn, FAN.rOut, { name, owner: name })),
      record(A.cylinder(fan.x, fan.y, 6, FAN.rotor - 1.4, motorTop - FAN.rotor + 1.4, { name: `${name}.motor`, owner: name })),
      ...guardShapes,
      record(A.disc(G.frameOf(o, [0, 0, 1], [1, 0, 0], [0, 1, 0]), -0.4, 0.4, 20.6, { name: `${name}.rotor`, owner: name })),
    ];
    FAN_ITEMS.push(put("dry", name, [fan.x, fan.y, FAN.top], shroud + cavity + rotor + motor + Ln(guard, { tone: "mid" }), shapes, { group: g }));
  });
}

// ── Насос и наружные трубы ──────────────────────────────────────────
// Подача (холодная) по y = LANE.S, возврат (тёплый) по y = LANE.R.
const PUMP = { x: 62, y: LANE.S, z: LANE.z, inX: 76, outX: 48 };
{
  const g = "glycol";
  const own = "pump";
  box("glycol", "pump.plinth", [PUMP.x - 9, PUMP.y - 7, PAD_H], [PUMP.x + 9, PUMP.y + 7, PAD_H + 1.6], { tone: "lo" }, { owner: own, group: g });
  box("glycol", "pump.foot", [PUMP.x - 6, PUMP.y - 5, PAD_H + 1.6], [PUMP.x + 6, PUMP.y + 5, PUMP.z - 7], { tone: "mid" }, { owner: own, group: g, extra: Dots([at([PUMP.x - 4.6, PUMP.y + 5, PAD_H + 3]), at([PUMP.x + 4.6, PUMP.y + 5, PAD_H + 3])], { size: 0.42, tone: "hi" }) });
  const CF = G.frameOf([PUMP.x, PUMP.y, PUMP.z - 7], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  const bowl = (s) => 5.8 + 2.6 * Math.sin((Math.PI * s) / 16);
  const bowlSlope = (s) => ((2.6 * Math.PI) / 16) * Math.cos((Math.PI * s) / 16);
  const casingProfile = Array.from({ length: 25 }, (_, i) => [(16 * i) / 24, bowl((16 * i) / 24)]);
  const casing = turned("glycol", "pump.casing", CF, casingProfile, { tone: "hi" }, { owner: own, group: g, smooth: { slope: bowlSlope, radius: bowl } });
  const MF = G.frameOf([PUMP.x, PUMP.y, PUMP.z + 9], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
  turned("glycol", "pump.lantern", MF, [[0, 4.6], [6, 4.6]], { tone: "mid" }, { owner: own, group: g });
  turned("glycol", "pump.motor", MF, [[6, 6.6], [24, 6.6]], { tone: "mid" }, { owner: own, group: g, extra: Faded(G.ribsOf(MF, 7.5, 22.5, 6.6, 28, P, { fade: [0.1, 0.55], seams: true }), { tone: "lo" }) });
  turned("glycol", "pump.cover", MF, [[24, 6.2], [27, 6.2]], { tone: "mid" }, { owner: own, group: g, bevel: 0.6, extra: Ln(k.ring(PUMP.x, PUMP.y, 3.6, PUMP.z + 36, P, 32), { tone: "lo" }) });
  box("glycol", "pump.terminal", [PUMP.x - 3, PUMP.y + 6.4, PUMP.z + 19], [PUMP.x + 3, PUMP.y + 10, PUMP.z + 26], { tone: "mid" }, { owner: own, group: g, extra: Ln(slotY(PUMP.x, PUMP.z + 22.5, 4.4, 5.2, PUMP.y + 10, 0.6), { tone: "faint" }) + Dots([at([PUMP.x - 2, PUMP.y + 10, PUMP.z + 20]), at([PUMP.x + 2, PUMP.y + 10, PUMP.z + 25])], { size: 0.4 }) });
  for (const [toward, end] of [[1, PUMP.inX], [-1, PUMP.outX]]) {
    const start = [PUMP.x + toward * (bowl(7) - 0.6), PUMP.y, PUMP.z];
    const face = padOn("glycol", "pump.pad", casing, start, [toward, 0, 0], 4.6, 1.6, { tone: "hi" }, { owner: own, group: g });
    const NF = G.frameAlong(face, [toward, 0, 0]);
    const len = Math.abs(end - face[0]) - 1.4;
    disc("glycol", "pump.nozzle", NF, 0, len, 4, { tone: "hi" }, { owner: own, group: g });
    flangeAt("glycol", "pump.flange", G.add3(face, [toward * (len + 0.7), 0, 0]), [toward, 0, 0], 6, 1.4, { owner: own, group: g, tone: "hi" });
  }
}

const HEADER = { r: 4, z0: DRY.legTop, z1: DRY.deck0, out: { x: 150, y: LANE.S }, in: { x: 143, y: LANE.R, z: 59.5, stub: 133 }, flangeZ: DRY.legTop - 3.4 };
{
  const g = "dry";
  const L = HEADER.z1 - HEADER.z0;
  const tapR = 1.4;
  const tapAt = (h) => h.x + Math.sqrt(HEADER.r ** 2 - tapR ** 2) - 0.05;
  const header = (name, h) => {
    const HF = G.frameOf([h.x, h.y, HEADER.z0], [0, 0, 1], [1, 0, 0], [0, 1, 0]);
    const host = turned("dry", name, HF, [[0, 0], [0, HEADER.r - 0.8], [0.8, HEADER.r], [L - 0.8, HEADER.r], [L, HEADER.r - 0.8], [L, 0]], { tone: "hi" }, { owner: name, group: g });
    for (const zz of [HEADER.z0 + 5, HEADER.z1 - 5]) disc("dry", `${name}.tap`, G.frameAlong([tapAt(h), h.y, zz], [1, 0, 0]), 0, DRY.x0 + 3 - tapAt(h), tapR, { tone: "mid" }, { owner: name, group: g });
    return host;
  };
  // выход: снизу коллектора, вниз к насосу
  header("dry.header.out", HEADER.out);
  disc("dry", "dry.header.out.nozzle", G.frameAlong([HEADER.out.x, HEADER.out.y, HEADER.z0], [0, 0, -1]), 0, HEADER.z0 - HEADER.flangeZ - 1.4, 2.6, { tone: "hi" }, { owner: "dry.header.out", group: g });
  flangeAt("dry", "dry.header.out.flange", [HEADER.out.x, HEADER.out.y, HEADER.flangeZ + 0.7], [0, 0, -1], 5.6, 1.4, { owner: "dry.header.out", group: g, tone: "hi" });
  // вход: сбоку, на седловой площадке
  const host = header("dry.header.in", HEADER.in);
  const face = padOn("dry", "dry.header.in.pad", host, [HEADER.in.x - HEADER.r + 0.2, HEADER.in.y, HEADER.in.z], [-1, 0, 0], 3.2, 1.2, { tone: "hi" }, { owner: "dry.header.in", group: g });
  disc("dry", "dry.header.in.nozzle", G.frameAlong(face, [-1, 0, 0]), 0, face[0] - (HEADER.in.stub + 1.4), 2.6, { tone: "hi" }, { owner: "dry.header.in", group: g });
  flangeAt("dry", "dry.header.in.flange", [HEADER.in.stub + 0.7, HEADER.in.y, HEADER.in.z], [-1, 0, 0], 5.6, 1.4, { owner: "dry.header.in", group: g, tone: "hi" });
}

// Опора трубы: пята, стойка, ложемент под хомутом трубы.
function support(name, x, y, collarBottom, { group = "glycol" } = {}) {
  const top = collarBottom;
  const half = CLAMP.t / 2;
  box("glycol", `${name}.plate`, [x - 4, y - 4, 0], [x + 4, y + 4, 1], { tone: "lo" }, { owner: name, group, extra: Dots([at([x - 2.6, y + 2.6, 1]), at([x + 2.6, y + 2.6, 1])], { size: 0.42, tone: "hi" }) });
  cyl("glycol", `${name}.post`, x, y, 1.3, 1, top - 3.2, { tone: "mid" }, { steps: 20, owner: name, group });
  box("glycol", `${name}.saddle`, [x - half, y - 3.2, top - 2.2], [x + half, y + 3.2, top], { tone: "mid" }, { r: 0.3, owner: name, group });
}

const CLAMP = { r: LANE.r * 1.62, t: 2.4 };
const COLLAR = CLAMP.r;
const OUT = {};
OUT.supplyDry = pipe("glycol", "glycol.supply.dry", [[HEADER.out.x, LANE.S, HEADER.flangeZ], [HEADER.out.x, LANE.S, LANE.z], [PUMP.inX, LANE.S, LANE.z]], LANE.r, { group: "glycol" });
OUT.supplyRoom = pipe("glycol", "glycol.supply.room", [[PUMP.outX, LANE.S, LANE.z], [S_RISER.x, LANE.S, LANE.z], [S_RISER.x, LANE.S, JOINT]], LANE.r, { group: "glycol", bandPoints: [[14, LANE.S, LANE.z]], bandR: 1.62, bandT: CLAMP.t });
OUT.returnRoom = pipe("glycol", "glycol.return.room", [[R_RISER.x, LANE.R, JOINT], [R_RISER.x, LANE.R, LANE.z], [38, LANE.R, LANE.z], [38, LANE.R, HEADER.in.z], [HEADER.in.stub, LANE.R, HEADER.in.z]], LANE.r, { group: "glycol", bandPoints: [[14, LANE.R, LANE.z], [100, LANE.R, HEADER.in.z]], bandR: 1.62, bandT: CLAMP.t });
support("glycol.support.s", 14, LANE.S, LANE.z - COLLAR);
support("glycol.support.r", 14, LANE.R, LANE.z - COLLAR);
support("glycol.support.high", 100, LANE.R, HEADER.in.z - COLLAR);


// ── Сборка порядка и страницы ───────────────────────────────────────
A.settle(R, P);
if (process.argv.includes("--why")) {
  const { items, solved, overlaps } = R.settled;
  for (const rule of solved.dropped) console.log("dropped", items[rule.front].name, ">", items[rule.back].name, "w", rule.weight.toFixed(2), "cycles", solved.cycles?.length);
  // путь в графе «перед» от back к front отброшенного правила
  const V3 = G.viewOf(P);
  const edges = new Map();
  for (const pair of overlaps.pairs) {
    const aFront = pair.front[0].area >= overlaps.least;
    const bFront = pair.front[1].area >= overlaps.least;
    if (aFront === bFront) continue;
    const [f, b] = aFront ? [pair.a, pair.b] : [pair.b, pair.a];
    if (!edges.has(b)) edges.set(b, []);
    edges.get(b).push(f);
  }
  for (const rule of solved.dropped) {
    const start = rule.front, goal = rule.back;
    const prev = new Map([[start, -1]]);
    const queue = [start];
    while (queue.length) {
      const n = queue.shift();
      if (n === goal) break;
      for (const m of edges.get(n) ?? []) if (!prev.has(m)) { prev.set(m, n); queue.push(m); }
    }
    if (!prev.has(goal)) { console.log("no path"); continue; }
    const chain = [];
    for (let n = goal; n !== -1; n = prev.get(n)) chain.push(items[n].name);
    console.log("chain (each behind the next):", chain.reverse().join(" < "));
  }
}
R.items.sort((a, b) => a.key - b.key);


// ── Маркеры потоков ──────────────────────────────────────────────────
// Каждая точка маршрута проверяется лучами к зрителю и от зрителя по записанным формам:
// маркер встаёт в порядок отрисовки сразу после деталей за ним и до деталей перед ним.
const CAM = A.cameraBasis(P);
const VIEW = CAM.V;
const ITEM_BOX = R.items.map((item) => {
  let sx0 = Infinity;
  let sy0 = Infinity;
  let sx1 = -Infinity;
  let sy1 = -Infinity;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const shape of item.shapes ?? []) {
    const b = A.boundsOf(shape);
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], b.min[i]);
      max[i] = Math.max(max[i], b.max[i]);
    }
  }
  for (const cx of [min[0], max[0]]) for (const cy of [min[1], max[1]]) for (const cz of [min[2], max[2]]) {
    const [x, y] = at([cx, cy, cz]);
    sx0 = Math.min(sx0, x);
    sy0 = Math.min(sy0, y);
    sx1 = Math.max(sx1, x);
    sy1 = Math.max(sy1, y);
  }
  return { sx0, sy0, sx1, sy1, min, max };
});
const sdfOf = (item, p) => item.shapes.reduce((best, shape) => Math.min(best, A.sdf(shape, p)), Infinity);
function rayHits(index, p, dir) {
  const item = R.items[index];
  const { min, max } = ITEM_BOX[index];
  let t0 = 0;
  let t1 = 900;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-9) {
      if (p[i] < min[i] - 0.01 || p[i] > max[i] + 0.01) return false;
      continue;
    }
    let a = (min[i] - 0.01 - p[i]) / dir[i];
    let b = (max[i] + 0.01 - p[i]) / dir[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  let t = t0;
  for (let n = 0; n < 400 && t <= t1; n++) {
    const d = sdfOf(item, G.add3(p, G.mul3(dir, t)));
    if (d < 0) return true;
    t += Math.max(d * 0.9, 0.03);
  }
  return false;
}
function slotOf(p, onPipe = false) {
  let lo = 0;
  let hi = R.items.length;
  const probes = onPipe ? [p] : [p, ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => G.add3(p, G.add3(G.mul3(CAM.R, a * 0.8), G.mul3(CAM.D, b * 0.8))))];
  for (const q of probes) {
    const [sx, sy] = at(q);
    for (let index = 0; index < R.items.length; index++) {
      const box = ITEM_BOX[index];
      if (sx < box.sx0 - 1 || sx > box.sx1 + 1 || sy < box.sy0 - 1 || sy > box.sy1 + 1 || !R.items[index].shapes?.length) continue;
      if (index < hi && rayHits(index, q, VIEW)) hi = index;
      else if (index >= lo && rayHits(index, q, G.mul3(VIEW, -1))) lo = index + 1;
    }
  }
  return [lo, hi];
}

// Маршруты потоков. lift — подъём точки к лицевой поверхности трубы, чтобы маркер лежал на трубе.
const chainOf = (...parts) => {
  const out = [];
  for (const part of parts) for (const point of part) if (!out.length || G.len3(G.sub3(point, out[out.length - 1])) > 1e-3) out.push(point);
  return out;
};
const lifted = (points, r) => points.map((point) => ({ point, lift: r + 0.12 }));
const plain = (points) => points.map((point) => ({ point, lift: 0 }));
const route = (name) => ROUTES[name].map((point) => [...point]);
const smoothAir = (points, radius = 7) => G.fillet(points, radius, 8);
const FLOWS = [];
// направление к зрителю, перпендикулярное оси участка
function liftDir(a, b) {
  const d = G.sub3(b, a);
  const len = G.len3(d);
  if (len < 1e-9) return VIEW;
  const t = G.mul3(d, 1 / len);
  const perp = G.sub3(VIEW, G.mul3(t, G.dot3(VIEW, t)));
  return G.len3(perp) < 1e-6 ? VIEW : G.unit3(perp);
}
function flow(id, kind, nodes, { closed = false, spacing, zones = [] } = {}) {
  const points = nodes.map((node) => node.point);
  const lifts = nodes.map((node) => node.lift);
  const loop = closed ? [...points, points[0]] : points;
  const liftLoop = closed ? [...lifts, lifts[0]] : lifts;
  const total = G.pathLength(loop);
  const step = 0.6;
  const samples = [];
  let walked = 0;
  for (let i = 1; i < loop.length; i++) {
    const a = loop[i - 1];
    const b = loop[i];
    const len = G.len3(G.sub3(b, a));
    const la = liftLoop[i - 1];
    const lb = liftLoop[i];
    for (let s = samples.length ? Math.ceil((walked + 1e-9) / step) * step - walked : 0; s <= len + 1e-9; s += step) {
      const t = len ? s / len : 0;
      const centre = G.lerp3(a, b, t);
      const lift = la + (lb - la) * t;
      samples.push({ s: walked + s, p: G.add3(centre, G.mul3(liftDir(a, b), lift)), onPipe: lift > 0 });
    }
    walked += len;
  }
  const segs = [];
  let current = null;
  for (const sample of samples) {
    const [lo, hi] = slotOf(sample.p, sample.onPipe);
    const valid = lo <= hi;
    if (current && current.valid === valid && (!valid || Math.max(current.lo, lo) <= Math.min(current.hi, hi))) {
      current.b = sample.s;
      if (valid) [current.lo, current.hi] = [Math.max(current.lo, lo), Math.min(current.hi, hi)];
    } else {
      if (current) segs.push(current);
      current = { a: sample.s, b: sample.s, lo, hi, valid };
    }
  }
  if (current) segs.push(current);
  if (process.argv.includes("--why-flow") && id === "gC") {
    for (const sample of samples.filter((_, i) => i % 6 === 0)) {
      const [lo, hi] = slotOf(sample.p);
      console.log(sample.s.toFixed(1), sample.p.map((v) => v.toFixed(1)).join(","), "lo", lo, R.items[lo - 1]?.name, "hi", hi, R.items[hi]?.name);
    }
  }
  // края сегментов — на середине между соседними пробами
  for (let i = 1; i < segs.length; i++) {
    const mid = (segs[i - 1].b + segs[i].a) / 2;
    segs[i - 1].b = mid;
    segs[i].a = mid;
  }
  segs[0].a = 0;
  segs[segs.length - 1].b = total;
  const screen = [];
  for (let s = 0; s <= total + 1e-9; s += 1) screen.push(at(G.pointAlong(loop, Math.min(s, total))).map(f2));
  const liftAt = (s) => {
    let acc = 0;
    for (let i = 1; i < loop.length; i++) {
      const len = G.len3(G.sub3(loop[i], loop[i - 1]));
      if (acc + len >= s) return liftLoop[i - 1] + (liftLoop[i] - liftLoop[i - 1]) * ((s - acc) / (len || 1));
      acc += len;
    }
    return liftLoop[liftLoop.length - 1];
  };
  // экранная точка с подъёмом к зрителю (на лицевой поверхности трубы)
  for (let i = 0; i < screen.length; i++) {
    const s = Math.min(i, total);
    const tangent = G.tangentAlong(loop, s);
    screen[i] = at(G.add3(G.pointAlong(loop, s), G.mul3(liftDir([0, 0, 0], tangent), liftAt(s)))).map(f2);
  }
  FLOWS.push({ id, kind, closed, total: f2(total), spacing, path: loop.map((p) => p.map(f2)), lift: liftLoop.map(f2), screen, zones: zones.map(([s0, s1, tag]) => [f2(s0), f2(s1), tag]), segs: segs.map((seg) => ({ a: f2(seg.a), b: f2(seg.b), slot: seg.lo, valid: seg.valid })) });
}
const arcWhere = (points, test) => {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const len = G.len3(G.sub3(points[i], points[i - 1]));
    const steps = Math.max(1, Math.ceil(len / 0.25));
    for (let j = 1; j <= steps; j++) if (test(G.lerp3(points[i - 1], points[i], j / steps))) return acc + (len * j) / steps;
    acc += len;
  }
  return acc;
};

// 1. Воздух зала: три замкнутые петли, по одной на стойку.
const SERVER_OF = [5, 3, 1];
RACKS.forEach((rack, k) => {
  const xk = rack.x0 + 15;
  const zk = SERVER_Z[SERVER_OF[k]] + SERVER_H / 2;
  const gx = [-84, -71, -58][k];
  const gy = [48, 58, 68][k];
  const ang = [-2.4, Math.PI / 2 + 0.25, -0.5][k];
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  const raw = [
    [gx, gy, 134],
    [gx, gy, 61],
    [FANC.x + (gx - FANC.x) * 0.3, FANC.y + (gy - FANC.y) * 0.3, 57.4],
    [FANC.x, FANC.y, 49],
    [FANC.x + 17 * c, FANC.y + 17 * sn, 46],
    [FANC.x + 19 * c, FANC.y + 19 * sn, 32],
    [FANC.x + 9 * c, 62, 17],
    [-90, 66, 13],
    [xk + 6, 66, 13],
    [xk, 60, 13],
    [xk, 10, 13],
    [xk, 5, 26],
    [xk, 5, zk - 10],
    [xk, -4, zk],
    [xk, -40, zk],
    [xk, -76, zk],
    [xk, -86, zk + 10],
    [xk, -86, 128],
    [xk + 20, -70, 136],
    [gx - 14, gy - 26, 138],
  ];
  const pts = smoothAir([...raw, raw[0]]).slice(0, -1);
  const loop = [...pts, pts[0]];
  const fcOut = arcWhere(loop, (p) => p[2] < FC.z0);
  const dxOut = arcWhere(loop, (p) => p[2] < DX.z0);
  const srvIn = arcWhere(loop, (p) => p[1] < rack.y1 - 2.2 && p[2] > F + 5);
  const srvOut = arcWhere(loop, (p) => p[1] < -40 && p[2] > F + 5);
  const total = G.pathLength(loop);
  flow(`air${k}`, "air", plain(pts), { closed: true, spacing: 11, zones: [[0, fcOut, "w"], [fcOut, dxOut, "m"], [dxOut, srvOut, "c"], [srvOut, total, "w"]] });
});

// 2. Водно-гликолевая смесь: подача, две параллельные ветки, возврат.
{
  const PUMP_IN = [PUMP.inX, LANE.S, LANE.z];
  const PUMP_OUT = [PUMP.outX, LANE.S, LANE.z];
  const supply = chainOf(route("glycol.supply.dry"), [PUMP_IN, PUMP_OUT], route("glycol.supply.room"), route("glycol.crac.supply"), [SB]);
  const nodes = [...lifted(route("glycol.supply.dry"), LANE.r), ...plain([PUMP_IN, PUMP_OUT]), ...lifted(route("glycol.supply.room"), LANE.r), ...lifted(route("glycol.crac.supply"), GR), ...plain([SB])];
  flow("gS", "glycol", nodes, { spacing: 8, zones: [[0, 1e6, "c"]] });
  const fcIn = route("glycol.crac.fc.in");
  const fcOut = route("glycol.crac.fc.out");
  flow("gFC", "glycol", [...plain([SB]), ...lifted(fcIn, GR), ...plain([[COIL.x1 - 6, FC.inY, FC.inZ], [COIL.x1 - 6, FC.outY, FC.outZ]]), ...lifted(fcOut, GR), ...plain([RB])], { spacing: 7, zones: [[0, G.pathLength(chainOf([SB], fcIn)) + 3, "c"], [G.pathLength(chainOf([SB], fcIn)) + 3, 1e6, "w"]] });
  const cIn = route("glycol.crac.cond.in");
  const cOut = route("glycol.crac.cond.out");
  flow("gC", "glycol", [...plain([SB]), ...lifted(cIn, GR), ...plain([[BPHE.x0 + 2, ...BPHE.glyIn], [BPHE.x0 + 2, ...BPHE.glyOut]]), ...lifted(cOut, GR), ...plain([RB])], { spacing: 7, zones: [[0, G.pathLength(chainOf([SB], cIn)) + 2, "c"], [G.pathLength(chainOf([SB], cIn)) + 2, 1e6, "w"]] });
  const back = [...plain([RB]), ...lifted(route("glycol.crac.return"), GR), ...lifted(route("glycol.return.room"), LANE.r), ...plain([[HEADER.in.x, HEADER.in.y, HEADER.in.z]])];
  flow("gR", "glycol", back, { spacing: 8, zones: [[0, 1e6, "w"]] });
}

// 3. Хладагент: замкнутый цикл.
{
  const dis = route("ref.discharge");
  const liq = route("ref.liquid");
  const suc = route("ref.suction");
  const nodes = [
    ...plain([[COMP.x, COMP.y, COMP.z0 + 12]]),
    ...lifted(dis, RR),
    ...plain([[BPHE.x0 + 2, ...BPHE.refIn], [BPHE.x0 + 2, ...BPHE.refOut]]),
    ...lifted(liq, RR),
    ...plain([[COIL.x1 - 8, DX.liqY, DX.liqZ], [COIL.x1 - 8, DX.sucY, DX.sucZ]]),
    ...lifted(suc, RR),
  ];
  flow("ref", "ref", nodes, { closed: true, spacing: 5 });
}

// 4. Наружный воздух: только через драйкулер.
FANS.forEach((fan, index) => {
  for (const [dx, dy, j] of [[-9, 7, 0], [8, -6, 1]]) {
    const raw = [[fan.x + dx * 1.6, fan.y + dy + 14, 4], [fan.x + dx, fan.y + dy, 20], [fan.x + dx, fan.y + dy, DRY.legTop], [fan.x + dx * 0.7, fan.y + dy * 0.7, FAN.top + 2], [fan.x + dx * 1.1, fan.y + dy, 104], [fan.x + dx * 1.5, fan.y + dy * 1.2, 122]];
    const pts = G.fillet(raw, 8, 8);
    const coilMid = arcWhere(pts, (p) => p[2] > (DRY.legTop + DRY.coil1) / 2);
    flow(`out${index}${j}`, "outdoor", plain(pts), { spacing: 11, zones: [[0, coilMid, "c"], [coilMid, 1e6, "w"]] });
  }
});


// ── Воздух для слоя WebGL ──
// Потоки в свободном воздухе (узел: x, y, z, радиус) и заместители деталей, которые их закрывают.
// Шейдер собирается здесь же: числа геометрии попадают в него литералами, без массивов uniform.
const AIR_STREAMS = [];
const stream = (group, kind, nodes, radius = 9) => AIR_STREAMS.push({ group, kind, nodes: radius ? filletAir(nodes, radius) : nodes });
// скругление ломаной с интерполяцией радиуса трубки
function filletAir(nodes, radius) {
  const pts = G.fillet(nodes.map((n) => n.slice(0, 3)), radius, 3);
  const raw = nodes.map((n) => n.slice(0, 3));
  const cum = [0];
  for (let i = 1; i < raw.length; i++) cum.push(cum[i - 1] + G.len3(G.sub3(raw[i], raw[i - 1])));
  const along = [0];
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + G.len3(G.sub3(pts[i], pts[i - 1])));
  const scale = cum[cum.length - 1] / along[along.length - 1];
  return pts.map((p, i) => {
    const s = along[i] * scale;
    let j = 1;
    while (j < cum.length - 1 && cum[j] < s) j++;
    const t = Math.min(1, Math.max(0, (s - cum[j - 1]) / (cum[j] - cum[j - 1] || 1)));
    const m0 = nodes[j - 1][4] ?? 1;
    const m1 = nodes[j][4] ?? 1;
    return [...p, nodes[j - 1][3] + (nodes[j][3] - nodes[j - 1][3]) * t, m0 + (m1 - m0) * t];
  });
}
// подполье: от кондиционера вдоль открытого выреза к стойкам
stream("plenum", 0, [[-97, 66, 11, 0], [-110, 66, 11, 6.5], [-150, 65, 11, 7], [-205, 64, 11, 7], [-246, 61, 11, 4.5], [-262, 58, 11, 0]], 14);
RACKS.forEach((rack, k) => {
  const xk = rack.x0 + 15;
  const zk = SERVER_Z[SERVER_OF[k]] + SERVER_H / 2;
  const gx = [-84, -71, -58][k];
  const gy = [48, 58, 68][k];
  // холодный коридор: из перфорированной плиты вверх к лицевым панелям
  stream("aisle", 0, [[xk, 6, F + 0.5, 0, 1], [xk, 5, F + 9, 11, 1], [xk, 1, F + 48, 12, 0.72], [xk, -5, F + 86, 9, 0.42], [xk, -7.5, F + 100, 0, 0.3]], 0);
  // горячий коридор: из задних панелей вверх, над стойками к верхнему входу кондиционера
  stream("hot", 1, [[xk, rack.y0 - 3, zk, 0], [xk, -82, zk + 10, 7], [xk, -86, F + 100, 10], [xk + 4, -84, 132, 11, 0.9], [xk + 22, -66, 140, 10, 0.62], [gx - 14, gy - 26, 140, 9, 0.5], [gx, gy, 130, 8, 0.5], [gx, gy, CRAC.z1 - 1, 0, 0.5]], 10);
});
FANS.forEach((fan) => {
  stream("intake", 2, [[fan.x - 4, fan.y + 40, 2.5, 0, 0.8], [fan.x - 2, fan.y + 24, 12, 9, 1], [fan.x, fan.y + 6, 28, 12, 1], [fan.x, fan.y, DRY.legTop + 1, 0, 1]], 10);
  stream("exhaust", 3, [[fan.x, fan.y, FAN.top - 1, 0, 0.25], [fan.x, fan.y, FAN.top + 8, 15, 0.7], [fan.x + 3, fan.y + 2, 102, 18, 1], [fan.x + 7, fan.y + 4, 124, 20, 0.85], [fan.x + 9, fan.y + 5, 134, 0, 0.6]], 12);
});
const GL = (v) => {
  const s = (Math.round(v * 1000) / 1000).toString();
  return s.includes(".") || s.includes("e") ? s : `${s}.`;
};
const V3 = (p) => `vec3(${GL(p[0])},${GL(p[1])},${GL(p[2])})`;
const AIR_PERIOD = 576; // период рисунка вдоль потока: 48 ячеек по 12 единиц
// Код каждого потока: отрезки трубки с радиусом и плотностью в узлах. Отсечение по 3D-рамке потока,
// перекрытие деталями считает шейдер по буферу глубины сцены (scene3d.js).
const airStreamCode = [];
let airSegments = 0;
AIR_STREAMS.forEach(({ group, kind, nodes }, index) => {
  let s = 0;
  const segs = [];
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 1; i < nodes.length; i++) {
    const [a, b] = [nodes[i - 1], nodes[i]];
    const length = G.len3(G.sub3(b.slice(0, 3), a.slice(0, 3)));
    if (length < 1e-3) continue;
    if (Math.max(a[3], b[3]) > 0.05) segs.push(`seg(acc,p0,V,tF,${V3(a)},${V3(b)},vec3(${GL(a[3])},${GL(b[3])},${GL(s)}),vec2(${GL(a[4] ?? 1)},${GL(b[4] ?? 1)}));`);
    s += length;
    for (const n of [a, b]) for (let k2 = 0; k2 < 3; k2++) (lo[k2] = Math.min(lo[k2], n[k2] - 2 * n[3] - 1)), (hi[k2] = Math.max(hi[k2], n[k2] + 2 * n[3] + 1));
  }
  airSegments += segs.length;
  const phase = kind < 2 ? "uPhase.x" : "uPhase.y";
  const seed = GL(index * 3.7 + 1.3);
  airStreamCode.push({ group, lo, hi, code: `  if(hitBox(p0,V,${V3(lo)},${V3(hi)})){
    acc=vec4(0.);
    ${segs.join("\n    ")}
    d${kind}=max(d${kind},finish(acc,${phase},${seed},px));
  }` });
});
const AIR_GROUPS = [...new Set(airStreamCode.map((part) => part.group))].map((group) => {
  const parts = airStreamCode.filter((part) => part.group === group);
  const lo = [0, 1, 2].map((i) => f2(Math.min(...parts.map((p) => p.lo[i]))));
  const hi = [0, 1, 2].map((i) => f2(Math.max(...parts.map((p) => p.hi[i]))));
  return { group, lo, hi, code: parts.map((part) => part.code).join("\n") };
});
console.log(`air ${AIR_STREAMS.length} streams, ${airSegments} segments, groups ${AIR_GROUPS.map((g) => g.group).join(", ")}`);
const AIR_GL = { period: AIR_PERIOD, groups: AIR_GROUPS };

// Разметка маркеров в местах порядка отрисовки
const MARK_R = { air: 1.7, glycol: 1.45, ref: 1.25, outdoor: 1.7 };
const slotMarkup = new Map();
FLOWS.forEach((f, fi) => {
  f.segs.forEach((seg, si) => {
    if (!seg.valid) return;
    const count = Math.floor((seg.b - seg.a) / f.spacing) + 2;
    const dots = Array.from({ length: count }, () => `<circle r="${MARK_R[f.kind]}" cx="-99" cy="-99"/>`).join("");
    const markup = `<g class="mk" data-kind="${f.kind}" data-f="${fi}" data-s="${si}">${dots}</g>`;
    slotMarkup.set(seg.slot, (slotMarkup.get(seg.slot) ?? "") + markup);
  });
});
console.log("flows", FLOWS.map((f) => `${f.id}:${f.segs.length}/${f.segs.filter((s) => !s.valid).length}`).join(" "));

const groups = R.items.map((item, index) => `${slotMarkup.get(index) ?? ""}<g class="it" data-name="${item.name}" data-piece="${item.piece}"${GROUP[item.name] ? ` data-group="${GROUP[item.name]}"` : ""}${item.attrs ?? ""}>${item.svg}</g>`);
groups.push(slotMarkup.get(R.items.length) ?? "");
const LABEL_TEXT = "Учебный макет на массивном основании. Слева на фальшполе три серверные стойки по восемь серверов, перед ними три перфорированные плиты, у фасада снят ряд плит и видно подпольное пространство. В центре открытый шкаф прецизионного кондиционера: фильтр, теплообменник фрикулинга, испаритель, радиальный вентилятор, компрессор, пластинчатый конденсатор, клапаны и контроллер. Справа на улице драйкулер с двумя осевыми вентиляторами и линейный насос на подающей трубе. Маркеры показывают воздух зала, водно-гликолевую смесь, хладагент и наружный воздух.";
const svg = k.figureSvg({ width: W, height: H, label: LABEL_TEXT, body: [...back, `<g class="scene">${groups.join("")}</g>`] });

const MODE_PREFIX = ["crac.coil.fc", "crac.coil.dx", "crac.comp", "crac.bphe", "crac.valve12", "crac.valve13", "crac.txv", "dry.fan"];
const STEPS = [
  { id: "servers", title: "Серверы", groups: ["racks"], names: [], pick: ["racks", "floor"] },
  { id: "crac", title: "Кондиционер", groups: ["crac"], names: [], pick: ["crac"] },
  { id: "glycol", title: "Гликолевый контур", groups: ["glycol"], names: [], pick: ["glycol"] },
  { id: "dry", title: "Драйкулер", groups: ["dry"], names: [], pick: ["dry"] },
  { id: "modes", title: "Режимы", groups: [], names: R.items.map((item) => item.name).filter((name) => MODE_PREFIX.some((prefix) => name.startsWith(prefix))), pick: [] },
];
const pitch = (Math.PI * 2) / 22;
const WHEEL = Array.from({ length: 24 }, (_, i) => FAN_WHEEL.d((i / 24) * pitch));
// ── 3D: формы из рекордера, детали рисунка на поверхностях, разлёт ──
const BACK_SHAPES = [...R.solids.filter((shape) => shape.name === "stand.base" || shape.name === "stand.foot"), A.slab(STRIP, 0, 0.6, { name: "stand.strip" }, 3), A.slab(LABEL, 0, 0.8, { name: "stand.label" }, 3)];
const SCENE3D = export3d({ R, P, GROUP, extraItems: [{ name: "stand.base", svg: back.join(""), shapes: BACK_SHAPES }] });
SCENE3D.blades = BLADES3D.map((fan) => ({ ...fan, item: SCENE3D.items.findIndex((item) => item.n === fan.item) }));
SCENE3D.wheel = { item: SCENE3D.items.findIndex((item) => item.n === "crac.fan.wheel"), c: [FANC.x, FANC.y], z0: 41.2, z1: FANC.deck - 4, r0: 11.6, r1: 14.8, count: 22, twist: 0.35 };
SCENE3D.label = { x: LABEL.x, y: LABEL.y, w: LABEL.w, d: LABEL.d, z: 0.8, text: "УЧЕБНЫЙ МАКЕТ", size: 4.2, at: [LABEL.x + LABEL.w / 2, LABEL.y + 7.6] };
SCENE3D.centre = [f2((BASE.x * 2 + BASE.w) / 2), f2((BASE.y * 2 + BASE.d) / 2), 40];
SCENE3D.base = { x: BASE.x, y: BASE.y, w: BASE.w, d: BASE.d, z0: -BASE_H - FOOT_H };
SCENE3D.camera.view = [W, H];
console.log(`3d: ${SCENE3D.items.length} items, lines ${SCENE3D.stats.lines} (${SCENE3D.stats.points} points, dropped ${SCENE3D.stats.dropped}), dots ${SCENE3D.stats.dots}, fills ${SCENE3D.stats.fills}, ${(JSON.stringify(SCENE3D).length / 1024).toFixed(0)} KB`);
const DATA = { flows: FLOWS, steps: STEPS, wheel: WHEEL, air: AIR_GL, scene: SCENE3D };

// --explode: проходят ли детали друг сквозь друга в кадрах разборки. Те же часы, что на странице
// (общая разборка: узлы по очереди, сборка в обратном порядке; разборка одного узла), шаг 1/30 с;
// в каждом кадре смещение детали ставится её формам, и аудит кита ищет проникновения твёрдых тел и труб.
if (process.argv.includes("--explode")) {
  const EXd = SCENE3D.explode;
  const TMAX = EXd.partSpan + EXd.duration;
  const units = SCENE3D.units;
  const smoothX = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  const itemOfShape = new Map();
  R.items.forEach((item) => {
    const i3 = SCENE3D.items.find((one) => one.n === item.name);
    for (const shape of item.shapes) itemOfShape.set(shape, i3);
  });
  // трассы труб записаны отдельно от кусков-деталей: трасса едет вместе с деталями своей трубы
  for (const tube of R.tubes) {
    const i3 = SCENE3D.items.find((one) => one.n === tube.name || one.n.startsWith(`${tube.name}:`));
    if (i3) itemOfShape.set(tube, i3);
    else console.log(`  трасса без детали: ${tube.name}`);
  }
  const all = [...R.solids, ...R.tubes];
  const pose = (clocks, wholes) => {
    for (const shape of all) {
      const it = itemOfShape.get(shape);
      if (!it) {
        shape.move = [0, 0, 0];
        continue;
      }
      const c = clocks[it.u];
      const share = smoothX((c - it.w) / EXd.duration);
      const ws = wholes[it.u] * smoothX(c / 0.8);
      shape.move = [0, 1, 2].map((k2) => it.m[k2] * share + it.um[k2] * ws);
    }
  };
  // сценарии страницы: общая разборка и сборка; разборка узлов выбранного шага (как STEP_UNITS в live.js)
  const scenarios = [];
  const step = 1 / 30;
  const idOf = (id) => units.findIndex((u) => u.id === id);
  const sets = [units.map((u, i) => i).filter((i) => units[i].id !== "stand"), ...[["rack1", "rack2", "rack3"], ["crac"], ["pipes", "pump"], ["dry"]].map((ids) => ids.map(idOf))];
  sets.forEach((set, n) => {
    const whole = n === 0;
    const sorted = [...set].sort((a, b) => units[a].order - units[b].order);
    for (const open of [true, false]) {
      const seq = open ? sorted : [...sorted].reverse();
      const span = (seq.length - 1) * EXd.unitGap + TMAX;
      for (let t = 0; t <= span + 1e-9; t += step) {
        const clocks = units.map((_, i) => (set.includes(i) && !open ? TMAX : 0));
        seq.forEach((u, k) => {
          const local = Math.max(0, Math.min(TMAX, t - k * EXd.unitGap));
          clocks[u] = open ? local : TMAX - local;
        });
        scenarios.push({ label: `${whole ? "вся установка" : set.map((i) => units[i].id).join("+")} ${open ? "разборка" : "сборка"} ${t.toFixed(2)} с`, clocks, wholes: units.map((_, i) => (whole && set.includes(i) ? 1 : 0)) });
      }
    }
  });
  const found = new Map();
  const started = Date.now();
  for (const sc of scenarios) {
    pose(sc.clocks, sc.wholes);
    const hits = [...A.solidClearances(R.solids, { state: 1 }), ...A.clearances(R.tubes, R.solids, { state: 1 }).filter((p) => p.kind === "through")];
    for (const hit of hits) {
      const key = [hit.tube, hit.other].sort().join(" × ");
      if (!found.has(key) || found.get(key).clearance > hit.clearance) found.set(key, { ...hit, label: sc.label });
    }
  }
  for (const shape of all) shape.move = [0, 0, 0];
  console.log(`explode: ${scenarios.length} кадров, ${found.size} пар с проникновением, ${((Date.now() - started) / 1000).toFixed(0)} с`);
  const groupsOf = new Map();
  for (const [key, hit] of found) {
    const g = key.replace(/#\d+/g, "").replace(/rack\d/g, "rackN").replace(/srv\d/g, "srvN");
    if (!groupsOf.has(g) || groupsOf.get(g).clearance > hit.clearance) groupsOf.set(g, { ...hit, count: (groupsOf.get(g)?.count ?? 0) + 1 });
    else groupsOf.get(g).count++;
  }
  for (const [key, hit] of [...groupsOf].sort((a, b) => a[1].clearance - b[1].clearance)) console.log(`  ${key} ×${hit.count}  ${hit.clearance.toFixed(2)}  ${hit.label}  at ${hit.at.map((v) => v.toFixed(1)).join(",")}`);
}

const LICENSE = readFileSync(join(HERE, "vendor", "anatomy", "LICENSE"), "utf8").trim();
const MODEL = readFileSync(join(HERE, "model.mjs"), "utf8").replace(/^export /gm, "");
const LIVE = readFileSync(join(HERE, "live.js"), "utf8").replace("__DATA__", JSON.stringify(DATA));
const CSS = readFileSync(join(HERE, "page.css"), "utf8");
const SCENE3D_JS = readFileSync(join(HERE, "scene3d.js"), "utf8");

const swatch = (inner) => `<svg class="dc-swatch" viewBox="0 0 30 10" aria-hidden="true">${inner}</svg>`;
const dotRow = (cls, tag) => [5, 15, 25].map((x) => `<circle cx="${x}" cy="5" r="2.6" data-t="${tag}"/>`).join("");
// дымка в легенде: та же краска, что у воздуха в шейдере (светлая тема), с мягкими краями
const haze = (id, rgb, a) => swatch(`<defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="rgb(${rgb})" stop-opacity="0"/><stop offset=".3" stop-color="rgb(${rgb})" stop-opacity="${a}"/><stop offset=".7" stop-color="rgb(${rgb})" stop-opacity="${a}"/><stop offset="1" stop-color="rgb(${rgb})" stop-opacity="0"/></linearGradient></defs><rect x="0" y="1" width="30" height="8" rx="4" fill="url(#${id})"/>`);
const legend = [
  ["Холодный воздух зала — голубая дымка: из подполья через плиты к лицевым панелям", haze("dc-hz-c", "92,158,230", 0.5), "dc-only3d"],
  ["Тёплый воздух — охристая дымка: за стойками и к верхнему входу кондиционера", haze("dc-hz-w", "230,158,77", 0.44), "dc-only3d"],
  ["Смесь в трубах: голубые точки на подаче, охристые на возврате", swatch(`<g class="mk" data-kind="air"><circle cx="5" cy="5" r="2.6" data-t="c"/><circle cx="15" cy="5" r="2.6" data-t="c"/><circle cx="25" cy="5" r="2.6" data-t="w"/></g>`), "dc-only3d"],
  ["Холодный поток: воздух под полом и в холодном коридоре, смесь на подаче", swatch(`<g class="mk" data-kind="air">${dotRow("", "c")}</g>`), "dc-only2d"],
  ["Тёплый поток: воздух за стойками, смесь на возврате", swatch(`<g class="mk" data-kind="air">${dotRow("", "w")}</g>`), "dc-only2d"],
  ["Хладагент (нейтральные кольца)", swatch(`<g class="mk" data-kind="ref">${dotRow("", "n")}</g>`), ""],
  ["Наружный воздух — только через драйкулер", haze("dc-hz-o", "107,163,224", 0.5), "dc-only3d"],
  ["Наружный воздух — только через драйкулер", swatch(`<g class="mk" data-kind="outdoor"><circle cx="5" cy="5" r="2.6" data-t="c"/><circle cx="15" cy="5" r="2.6" data-t="c"/><circle cx="25" cy="5" r="2.6" data-t="w"/></g>`), "dc-only2d"],
  ["Выбранный узел — тёмный контур", swatch(`<path d="M2 8 L14 2 L28 8" fill="none" stroke="#000" stroke-width="1.2"/>`), ""],
];
const row = (key, sym, label) => `<div class="dc-row" data-q="${key}"><span class="dc-sym">${sym}<small>${label}</small></span><span class="dc-track"><span class="dc-fill" data-fill></span></span><span data-num>—</span></div>`;

const BODY = `
<div class="dc-page">
  <header class="dc-head">
    <h1>Как ЦОД отдаёт тепло</h1>
    <p class="dc-lead">Три замкнутые среды — воздух зала, водно-гликолевая смесь и хладагент — передают тепло серверов друг другу только через стенки теплообменников. На улицу оно уходит через сухой охладитель (драйкулер).</p>
    <p class="dc-note">Сцена объясняет принцип и не воспроизводит конкретную установку: исполнение по принципу Liebert HPM F выбрано условно, расположение оборудования обобщено, коэффициенты учебные. Наружный воздух в зал не подаётся — он проходит только через драйкулер.</p>
  </header>
  <div class="dc-layout">
    <div class="dc-main">
      <figure class="dc-card">
        <div class="iso-plate dc-stage">
          <div class="iso-plate-corners" aria-hidden="true">
            <span class="iso-plate-corner" data-corner="fig">Рис. 1</span>
            <span class="iso-plate-corner" data-corner="title">Зал · улица</span>
            <span class="iso-plate-corner" data-corner="hint"><span class="dc-wide dc-only3d">Тяните — вращение · X — разобрать · 1–5 · R</span><span class="dc-narrow dc-only3d">Тяните — вращение · 1–5</span><span class="dc-wide dc-only2d">Нажмите на узел · 1–5 · ← → · пробел · R</span><span class="dc-narrow dc-only2d">Нажмите на узел · 1–5</span></span>
            <span class="iso-plate-corner" data-corner="readout" data-readout></span>
          </div>
          <div class="dc-viewport" tabindex="0" role="group" aria-label="Разрез установки. Тяните, чтобы вращать сцену; Q и E поворачивают, W и S меняют наклон, X разбирает выбранный узел или всю установку на детали. Нажмите на стойки, кондиционер, трубы или драйкулер, чтобы выбрать узел. Escape возвращает обычный масштаб.">
            <div class="dc-zoomer">${svg}<canvas class="dc-view3d" aria-hidden="true"></canvas></div>
          </div>
          <p class="dc-sr" role="status" aria-live="polite" data-status></p>
        </div>
        <figcaption class="dc-legend">
          ${legend.map(([label, mark, cls]) => `<span class="dc-key${cls ? ` ${cls}` : ""}">${mark}${label}</span>`).join("")}
          <span class="dc-key dc-cond">Скорость маркеров, движения воздуха и вращения вентиляторов условная; показана только качественно. Плотность дымки тоже условная: тёплый воздух гуще при большей нагрузке, наружный — при большей интенсивности вентиляторов.</span>
        </figcaption>
      </figure>
      <section class="dc-box dc-explain" aria-live="off">
        <span class="dc-step-count" data-v="stepCount"></span>
        <h2 data-v="stepTitle">Как читать рисунок</h2>
        <p data-v="stepText"></p>
      </section>
      <section class="dc-box dc-balance">
        <h2>Тепловой баланс</h2>
        <div class="dc-rows">
          ${row("qIT", "Q_IT", "тепло серверов")}
          ${row("qFC", "Q_FC", "фрикулинг")}
          ${row("qDX", "Q_DX", "холодильный контур")}
          ${row("pComp", "P_comp", "работа компрессора")}
          ${row("qOut", "Q_out", "уходит на улицу")}
        </div>
        <p class="dc-eq" data-v="equation"></p>
        <p class="dc-why">Q_FC + Q_DX = Q_IT. Компрессор не уничтожает тепло: он поднимает его на более высокий температурный уровень и добавляет свою работу, поэтому в жару драйкулер отводит больше тепла, чем выделяют серверы.</p>
      </section>
    </div>
    <aside class="dc-panel" aria-label="Условия и управление">
      <section class="dc-box">
        <h2>Условия</h2>
        <div class="dc-field">
          <label for="dc-outdoor">Температура улицы <output data-v="outdoor" for="dc-outdoor"></output></label>
          <input id="dc-outdoor" type="range" min="${COEF.outdoor[0]}" max="${COEF.outdoor[1]}" step="0.5" value="20" aria-describedby="dc-outdoor-scale">
          <span class="dc-scale" id="dc-outdoor-scale"><span>−15 °C</span><span>+40 °C</span></span>
        </div>
        <div class="dc-field">
          <label for="dc-load">Нагрузка серверов <output data-v="load" for="dc-load"></output></label>
          <input id="dc-load" type="range" min="${COEF.load[0]}" max="${COEF.load[1]}" step="1" value="60" aria-describedby="dc-load-scale">
          <span class="dc-scale" id="dc-load-scale"><span>20 кВт</span><span>80 кВт</span></span>
        </div>
        <div class="dc-presets" role="group" aria-label="Погода">
          <button class="dc-btn" type="button" data-preset="-10">Мороз −10 °C</button>
          <button class="dc-btn" type="button" data-preset="20">Прохладно +20 °C</button>
          <button class="dc-btn" type="button" data-preset="35">Жара +35 °C</button>
        </div>
      </section>
      <section class="dc-box" aria-label="Текущий режим">
        <h2>Режим</h2>
        <p class="dc-mode" data-v="mode"></p>
        <div class="dc-share"><span>Фрикулинг</span><span class="dc-track"><span class="dc-fill" data-bar="fc"></span></span><output data-v="shareFC"></output></div>
        <div class="dc-share"><span>Компрессор</span><span class="dc-track"><span class="dc-fill" data-bar="dx"></span></span><output data-v="shareDX"></output></div>
        <dl class="dc-temps">
          <dt class="dc-th"></dt><dd class="dc-th">подача</dd><dd class="dc-th">возврат</dd>
          <dt>Воздух зала</dt><dd data-v="airSupply"></dd><dd data-v="airReturn"></dd>
          <dt>Смесь</dt><dd data-v="glySupply"></dd><dd data-v="glyReturn"></dd>
          <dt>Воздух между теплообменниками</dt><dd data-v="airBetween"></dd><dd></dd>
          <dt>Вентиляторы драйкулера, условно</dt><dd data-v="fan"></dd><dd></dd>
        </dl>
      </section>
      <section class="dc-box" aria-label="Узлы и управление">
        <h2>Узлы</h2>
        <div class="dc-steps" role="group" aria-label="Шаги">
          ${STEPS.map((step, index) => `<button class="dc-btn" type="button" data-step="${index}" aria-pressed="false"><kbd>${index + 1}</kbd>${step.title}</button>`).join("")}
        </div>
        <div class="dc-buttons">
          <button class="dc-btn" type="button" data-act="prev" aria-label="Предыдущий шаг">← Назад</button>
          <button class="dc-btn" type="button" data-act="next" aria-label="Следующий шаг">Вперёд →</button>
          <button class="dc-btn" type="button" data-act="tour" aria-pressed="false">Автопоказ</button>
          <button class="dc-btn" type="button" data-act="pause" aria-pressed="false">Пауза</button>
          <button class="dc-btn" type="button" data-act="zoom" aria-pressed="false">Увеличить ×1.6</button>
          <button class="dc-btn" type="button" data-act="reset">Сброс</button>
        </div>
        <div class="dc-buttons dc-view-buttons dc-only3d" role="group" aria-label="Вид">
          <button class="dc-btn" type="button" data-act="turn-left" aria-label="Повернуть сцену влево на 30°">↺ 30°</button>
          <button class="dc-btn" type="button" data-act="turn-right" aria-label="Повернуть сцену вправо на 30°">↻ 30°</button>
          <button class="dc-btn" type="button" data-act="explode" aria-pressed="false">Разобрать</button>
        </div>
        <p class="dc-hint">Клавиши: 1–5 — узлы, ← → — шаги, пробел — пауза, R — сброс, Escape — обычный масштаб.<span class="dc-only3d"> Q / E — поворот, W / S — наклон, X — разобрать или собрать (выбранный узел или всю установку); мышью: тянуть — вращение, Shift или правая кнопка — сдвиг.</span> Ползунки слушают стрелки сами.</p>
      </section>
    </aside>
  </div>
  <details class="dc-details">
    <summary>Что принято в этой учебной модели</summary>
    <ul>
      <li><b>3D-вид.</b> Сцена вращается и разбирается в браузере на WebGL. Меши строятся из тех же форм деталей, что проверяет аудит Anatomy (призмы, тела вращения, трубы), линии и винты рисунка перенесены на поверхности деталей; разлёт деталей — иллюстрация состава узлов, а не порядок реального монтажа. Без WebGL страница показывает изометрический SVG-рисунок.</li>
      <li><b>Почему HPM F.</b> Принцип исполнения F (Freecooler) взят из руководства Vertiv Liebert HPM A/W/F/D/H, редакция 23.01.2018, раздел 2.1.4, с учётом соседнего 2.1.3 (W): один теплообменник с рядами фрикулинга и рядами прямого испарения, внешний драйкулер, водно-гликолевая смесь, насос и смесь в поставку блока не входят, двухходовой регулирующий клапан (12) на теплообменнике фрикулинга и соленоидный клапан (13) на водяном пластинчатом конденсаторе. Модель выбрана условно: название Liebert Hiross само по себе не определяет модель и комплектацию.</li>
      <li><b>Геометрия обобщённая.</b> Размеры, расположение узлов, число серверов, трассы труб, опоры и насос нарисованы для объяснения принципа и не повторяют конкретную установку. Ряды фрикулинга и испарителя показаны двумя блоками; конфигурация подачи вниз под фальшпол (Downflow) есть в руководстве как вариант U.</li>
      <li><b>Режим следует из баланса.</b> В руководстве переход описан правилом «улица хотя бы на 5 градусов холоднее возвратного воздуха» и температурой ZET. Здесь режим не переключается по порогу: он получается из совместного решения уравнений, а крайние режимы определяются с допуском 0,001 кВт.</li>
      <li><b>Коэффициенты учебные, не паспортные:</b> подача воздуха 22 °C, C_air = 4 кВт/К, C_glycol = 8 кВт/К (расход × теплоёмкость, а не теплоёмкость зала), ε = 0,7, UA_max = 12 кВт/К, COP = 3, минимум подачи смеси 6 °C за счёт регулирования теплоотдачи драйкулера (в руководстве нижний предел воды или смеси на конденсаторе — 5 °C).</li>
      <li><b>Уравнения:</b> T_return = 22 + Q_IT / C_air; Q_DX = Q_IT − Q_FC; P_comp = Q_DX / COP; Q_out = Q_IT + P_comp; T_glycol_cold = max(6, T_outdoor + Q_out / (C_glycol × (exp(UA / C_glycol) − 1))); Q_FC = clamp(ε × C_air × (T_return − T_glycol_cold), 0, Q_IT); T_glycol_hot = T_glycol_cold + Q_out / C_glycol. Связанные уравнения решаются итерацией до сходимости; остаток проверяется.</li>
      <li><b>Не учтены</b> тепло вентиляторов и насоса, влажность и осушение, гидравлика и перепады давления. Деление расхода смеси между ветками в анимации пропорционально их тепловой нагрузке — для наглядности.</li>
      <li><b>Время условно.</b> Плавная смена картинки после движения ползунка не моделирует реальную длительность переходного процесса. Скорости маркеров и вращения вентиляторов условные; интенсивность вентиляторов драйкулера — доля использованного UA, а не обороты или настройки контроллера.</li>
      <li><b>Драйкулер без орошения</b> — допущение сцены: теплообмен с наружным воздухом только сухой.</li>
      <li><b>Источники:</b> <a href="https://www.vertiv.com/48d574/globalassets/products/thermal-management/room-cooling/vertiv-liebert-hpm/vertiv-liebert_hpm-um-en-emea-265011.pdf">Vertiv Liebert HPM A/W/F/D/H User Manual, ред. 23.01.2018 (PDF), разделы 2.1.3 и 2.1.4</a>; <a href="https://www.vertiv.com/en-us/products-catalog/thermal-management/heat-rejection/liebert-hpd/">Liebert HPD — наружный сухой охладитель, страница каталога Vertiv</a>. Проверено 11.10.2026; документы производителя могут обновляться.</li>
    </ul>
  </details>
  <p class="dc-foot">Иллюстрация построена на ките Anatomy (лицензия MIT, © 2026 Ryan). Полный текст лицензии — в комментарии в начале файла.</p>
</div>`;

const page = `<!doctype html>
<!--
Рисунок построен с использованием Anatomy (https://github.com/wheresryan22/anatomy, коммит dbf697a).
Часть кода и стилей кита (ISO_CSS, геометрия солидов, труб и аудит) распространяется по лицензии:

${LICENSE}
-->
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Как ЦОД отдаёт тепло</title><style>${k.ISO_CSS}${CSS}</style></head><body class="iso" data-theme="${DARK ? "dark" : "light"}">${BODY}<script type="module">${(glScript() + "\n" + SCENE3D_JS + "\n" + MODEL + "\n" + LIVE).replace(/<\/(script)/gi, "<\\/$1")}</script></body></html>`;

mkdirSync(join(HERE, "..", "outputs"), { recursive: true });
mkdirSync(join(HERE, "shots"), { recursive: true });
const out = DARK ? join(HERE, "shots", "dark.html") : join(HERE, "..", "outputs", "data-center-cooling.html");
writeFileSync(out, page);
console.log("wrote", out, `${(page.length / 1024).toFixed(0)} KB`, `${R.items.length} items`, `scale ${KS.toFixed(3)}`);
A.auditOrExit(R, P, {});
