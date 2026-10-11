// Экспорт сцены в 3D: формы деталей из рекордера аудита, детали рисунка (линии, винты, экраны),
// поднятые обратно на поверхность детали лучом камеры, и векторы разлёта по узлам.
import * as A from "./vendor/anatomy/kit/audit.mjs";
import { glCamera } from "./vendor/anatomy/kit/gl.mjs";

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const TONES = { hi: 0, mid: 1, lo: 2, faint: 3, lit: 4 };

// компактная запись формы
function packShape(shape) {
  const F = (f) => [...f.o, ...f.a, ...f.u, ...f.v].map(r3);
  if (shape.kind === "prism") return { k: "p", F: F(shape.F), poly: shape.poly.flat().map(r3), s: [r3(shape.s0), r3(shape.s1)] };
  if (shape.kind === "body") return { k: "b", F: F(shape.F), poly: shape.poly.flat().map(r3) };
  if (shape.kind === "tube") return { k: "t", pts: shape.points.flat().map(r3), r: shape.radii.map(r3), round: shape.round ?? [false, false] };
  if (shape.kind === "ball") return { k: "s", o: shape.o.map(r3), r: r3(shape.r), flats: shape.flats ?? [] };
  if (shape.kind === "box") return { k: "x", o: shape.o.map(r3), axes: shape.axes.flat().map(r3), half: shape.half.map(r3) };
  throw new Error(`неизвестная форма ${shape.kind}`);
}

// луч камеры через точку рисунка и поиск ближайшей к зрителю поверхности
function caster(P) {
  const cam = glCamera(P);
  const [sA, cA, sE, cE] = cam.cam;
  const V = [cA * cE, sA * cE, sE];
  const rayOf = ([x, y]) => {
    const qx = (x - cam.origin[0]) / cam.k;
    const qy = (y - cam.origin[1]) / cam.k;
    return [qx * sA, -qx * cA, -qy / cE];
  };
  return function cast(shapes, bounds, vb) {
    const o = rayOf(vb);
    let t0 = -1e9;
    let t1 = 1e9;
    for (let i = 0; i < 3; i++) {
      const lo = (bounds.min[i] - 0.5 - o[i]) / V[i];
      const hi = (bounds.max[i] + 0.5 - o[i]) / V[i];
      t0 = Math.max(t0, Math.min(lo, hi));
      t1 = Math.min(t1, Math.max(lo, hi));
    }
    if (t0 > t1) return null;
    const dist = (t) => {
      const p = [o[0] + V[0] * t, o[1] + V[1] * t, o[2] + V[2] * t];
      let d = Infinity;
      for (const shape of shapes) d = Math.min(d, A.sdf(shape, p));
      return d;
    };
    let t = t1;
    let best = { d: Infinity, t };
    for (let step = 0; step < 400 && t > t0; step++) {
      const d = dist(t);
      if (Math.abs(d) < best.d) best = { d: Math.abs(d), t };
      if (d < 0.02) {
        // уточнение границы делением пополам между t и t + шаг назад
        let a = t;
        let b = Math.min(t1, t + Math.max(0.05, Math.abs(d) + 0.05));
        for (let i = 0; i < 24; i++) {
          const m = (a + b) / 2;
          if (dist(m) < 0) a = m;
          else b = m;
        }
        return [o[0] + V[0] * b, o[1] + V[1] * b, o[2] + V[2] * b];
      }
      t -= Math.max(0.03, d * 0.9);
    }
    if (best.d < 0.6) return [o[0] + V[0] * best.t, o[1] + V[1] * best.t, o[2] + V[2] * best.t];
    return null;
  };
}

// разбор разметки детали: линии, точки и заливки, которые не рисует сама геометрия
function markupOf(svg) {
  const lines = [];
  const dots = [];
  const fills = [];
  for (const m of svg.matchAll(/<path class="iso-line([^"]*)"([^>]*?)d="([^"]*)"/g)) {
    const cls = m[1];
    if (/iso-edge|iso-crease|tb-edge/.test(cls)) continue;
    const tone = (m[2].match(/data-tone="(\w+)"/) ?? [, "lo"])[1];
    lines.push({ tone, d: m[3], bevel: /iso-bevel/.test(cls) });
  }
  for (const m of svg.matchAll(/<g class="iso-dots"( data-tone="(\w+)")?>([^]*?)<\/g>/g)) {
    const tone = m[2] ?? "base";
    for (const c of m[3].matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/g)) dots.push({ tone, at: [+c[1], +c[2]], r: +c[3] });
  }
  for (const m of svg.matchAll(/<path class="dc-screen" d="([^"]*)"/g)) fills.push({ shade: 0, d: m[1] });
  return { lines, dots, fills };
}

function polylines(d) {
  const out = [];
  let current = null;
  for (const m of d.matchAll(/([MLZ])([^MLZ]*)/g)) {
    const nums = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (m[1] === "M") {
      current = [[nums[0], nums[1]]];
      out.push(current);
      for (let i = 2; i + 1 < nums.length; i += 2) current.push([nums[i], nums[i + 1]]);
    } else if (m[1] === "L") {
      for (let i = 0; i + 1 < nums.length; i += 2) current.push([nums[i], nums[i + 1]]);
    } else if (m[1] === "Z" && current && current.length > 1) current.push([...current[0]]);
  }
  return out;
}

const unionBounds = (shapes) => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const shape of shapes) {
    const b = A.boundsOf(shape);
    for (let i = 0; i < 3; i++) (min[i] = Math.min(min[i], b.min[i])), (max[i] = Math.max(max[i], b.max[i]));
  }
  return { min, max };
};

// Узлы сцены и правила разлёта, как на сборочном чертеже: каждая группа деталей уходит своим путём,
// рамы, опоры и трубопровод остаются на месте. unit — смещение всего узла при общей разборке,
// order — очередь узла (меньше — раньше), parts — правила [префикс имени, вектор или функция].
const up = (z) => () => [0, 0, z];
const drawer = (dy, k) => (item, u) => [0, dy, (item.b[2] - u.min[2]) * k];
export const UNITS = [
  { id: "stand", title: "Основание", match: (n) => n.startsWith("stand."), unit: [0, 0, 0], order: 9, parts: [] },
  { id: "floor", title: "Фальшпол", match: (n) => n.startsWith("floor."), unit: [0, 0, 0], order: 8, parts: [["floor.deck", up(30)], ["floor.stringer", up(15)]] },
  ...[1, 2, 3].map((k) => ({
    id: `rack${k}`,
    title: `Стойка ${k}`,
    match: (n) => n.startsWith(`rack${k}.`),
    unit: [0, -16, 44],
    order: 1 + k,
    parts: [
      [`rack${k}.roof`, up(46)],
      [`rack${k}.back`, () => [0, -42, 0]],
      [`rack${k}.srv`, drawer(32, 0.3)],
    ],
  })),
  {
    id: "crac",
    title: "Кондиционер",
    match: (n) => n.startsWith("crac.") || n.startsWith("ref.") || n.startsWith("glycol.crac") || n.startsWith("glycol.tee"),
    unit: [0, 0, 26],
    order: 1,
    parts: [
      // крыша и фильтр выдвигаются вперёд из-под переходного короба канала (обслуживание спереди)
      ["crac.roof", () => [0, 64, 0]],
      ["crac.filter", () => [0, 50, 0]],
      ["crac.coil.", () => [0, 56, 0]],
      ["crac.fan.beam", () => [0, 0, 0]],
      ["crac.fan.", () => [0, 60, 0]],
      ["crac.side.left", () => [-34, 0, 0]],
      ["crac.side.right", () => [32, 0, 0]],
      ["crac.ctrl", () => [0, 30, 0]],
      ["crac.back", () => [0, -36, 0]],
      ["crac.bphe", () => [20, 0, 0]],
    ],
  },
  // крайняя опора канала стоит у торца стойки 1: при подъёме канала она отходит в сторону, чтобы стойки прошли назад
  { id: "duct", title: "Канал возврата", match: (n) => n.startsWith("duct."), unit: [0, 0, 70], order: -1, parts: [["duct.post", (item) => (item.b[0] < -240 ? [-16, 0, 0] : [0, 0, 0])]] },
  { id: "pipes", title: "Трубы", match: (n) => n.startsWith("glycol."), unit: [0, 0, 0], order: 6, parts: [] },
  {
    id: "pump",
    title: "Насос",
    match: (n) => n.startsWith("pump."),
    unit: [0, 0, 0],
    order: 5,
    parts: [["pump.cover", up(46)], ["pump.motor", up(34)], ["pump.terminal", up(16)], ["pump.lantern", up(18)]],
  },
  {
    id: "dry",
    title: "Драйкулер",
    match: (n) => n.startsWith("dry."),
    unit: [28, 0, 0],
    order: 0,
    parts: [["dry.fan", up(48)], ["dry.deck", up(26)], ["dry.ebox", () => [18, 0, 0]], ["dry.panel", (item, u) => [0, Math.sign((item.b[1] + item.b[4]) / 2 - (u.min[1] + u.max[1]) / 2) * 18, 0]]],
  },
];
export const EXPLODE = { duration: 0.9, unitGap: 0.16, partSpan: 0.45 };

export function export3d({ R, P, GROUP, extraItems = [] }) {
  const cast = caster(P);
  const items = [...R.items, ...extraItems];
  const stats = { lines: 0, points: 0, dropped: 0, dots: 0, fills: 0 };
  const out = items.map((item) => {
    const shapes = item.shapes ?? [];
    const bounds = unionBounds(shapes);
    const svg = item.svg ?? "";
    const edge = (svg.match(/class="iso-line iso-edge" data-tone="(\w+)"/) ?? [, "mid"])[1];
    const crease = (svg.match(/class="iso-line iso-crease" data-tone="(\w+)"/) ?? [, "faint"])[1];
    const { lines, dots, fills } = markupOf(svg);
    const lineOut = [];
    for (const line of lines) {
      for (const poly of polylines(line.d)) {
        let run = [];
        const flush = () => {
          if (run.length > 1) lineOut.push([TONES[line.tone] ?? 2, run.flat().map(r2)]);
          run = [];
        };
        for (const p of poly) {
          stats.points++;
          const hit = cast(shapes, bounds, p);
          if (hit) run.push(hit);
          else {
            stats.dropped++;
            flush();
          }
        }
        flush();
        stats.lines++;
      }
    }
    const dotOut = [];
    for (const dot of dots) {
      const hit = cast(shapes, bounds, dot.at);
      if (!hit) {
        stats.dropped++;
        continue;
      }
      stats.dots++;
      dotOut.push([dot.tone === "base" ? 5 : TONES[dot.tone] ?? 2, r2(dot.r), ...hit.map(r2)]);
    }
    const fillOut = [];
    for (const fill of fills) {
      const pts = polylines(fill.d)[0].map((p) => cast(shapes, bounds, p));
      if (pts.some((p) => !p)) continue;
      stats.fills++;
      fillOut.push([fill.shade, pts.flat().map(r2)]);
    }
    return {
      n: item.name,
      g: GROUP[item.name] ?? null,
      e: TONES[edge] ?? 1,
      c: TONES[crease] ?? 3,
      lit: /data-lit/.test(svg.slice(0, 200)) ? 1 : 0,
      s: shapes.map(packShape),
      l: lineOut,
      d: dotOut,
      f: fillOut,
      b: [...bounds.min.map(r2), ...bounds.max.map(r2)],
    };
  });

  // разлёт: центр узла по рамке его деталей; деталь уходит от центра по spread, узел — на unit
  const unitOf = (name) => UNITS.findIndex((u) => u.match(name));
  const groups = UNITS.map(() => []);
  out.forEach((item, index) => {
    const u = unitOf(item.n);
    if (u < 0) throw new Error(`деталь вне узлов: ${item.n}`);
    item.u = u;
    groups[u].push(index);
  });
  UNITS.forEach((unit, u) => {
    const list = groups[u];
    if (!list.length) return;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const index of list) for (let i = 0; i < 3; i++) (min[i] = Math.min(min[i], out[index].b[i])), (max[i] = Math.max(max[i], out[index].b[i + 3]));
    const ctx = { min, max };
    for (const index of list) {
      const item = out[index];
      const rule = unit.parts.find(([prefix]) => item.n.startsWith(prefix));
      item.m = (rule ? rule[1](item, ctx) : [0, 0, 0]).map(r2);
      item.um = unit.unit;
    }
    // дальние детали уходят первыми, ближние — последними; возвращаются в обратном порядке
    const reach = Math.max(1e-6, ...list.map((index) => Math.hypot(...out[index].m)));
    for (const index of list) out[index].w = r3((1 - Math.hypot(...out[index].m) / reach) * EXPLODE.partSpan);
  });
  const units = UNITS.map(({ id, title, unit, order }) => ({ id, title, unit, order }));
  return { items: out, units, explode: EXPLODE, camera: glCamera(P), stats };
}
