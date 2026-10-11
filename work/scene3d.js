// 3D-вид сцены на WebGL: те же формы, что записал аудит Anatomy, тона кита по нормали со светом от камеры,
// контуры (силуэт и рёбра) считаются на GPU, разборка и вращение вентиляторов — в вершинном шейдере,
// воздух — объём по буферу глубины сцены. Без WebGL страница остаётся на SVG-рисунке.
function createScene3D(canvas, D, { steps, air, theme, onLost } = {}) {
  const gl = canvas.getContext("webgl", { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, depth: true });
  if (!gl) return null;
  if (gl.getParameter(gl.MAX_VERTEX_ATTRIBS) < 8) return null;
  const uintIndex = gl.getExtension("OES_element_index_uint");

  // ── векторная арифметика ──
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a) => {
    const l = len(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  const W = D.camera.view ? D.camera.view[0] : 900;
  const H = D.camera.view ? D.camera.view[1] : 560;

  // ── атрибуты детали: смещение разборки, узел, вращение, маска шагов ──
  const SPIN = new Map();
  D.blades.forEach((fan, i) => SPIN.set(fan.item, i + 1));
  if (D.wheel.item >= 0) SPIN.set(D.wheel.item, 3);
  const maskOf = (item) => {
    let mask = 0;
    steps.forEach((step, i) => {
      if (step.groups.includes(item.g) || step.names.includes(item.n)) mask += 2 ** i;
    });
    if (item.lit) mask += 32;
    return mask;
  };
  const META = D.items.map((item, index) => ({ move: [...item.m, item.w], meta: [item.u, 0, maskOf(item), index] }));

  // ── накопители геометрии ──
  const faceBatches = [];
  let fb = null;
  const newFaceBatch = () => {
    fb = { pos: [], nor: [], move: [], meta: [], idx: [], n: 0 };
    faceBatches.push(fb);
  };
  newFaceBatch();
  const LIMIT = uintIndex ? 4e6 : 65000;
  const edges = { pos: [], n1: [], n2: [], move: [], meta: [], tone: [] };
  const details = { pos: [], move: [], meta: [], tone: [] };
  const fills = { pos: [], move: [], meta: [], tone: [] };
  const dots = { pos: [], move: [], meta: [], tone: [] };
  let cur = null; // { move, meta, edge, crease, spin, dark }

  function mesh(verts, tris) {
    if (fb.n + verts.length > LIMIT) newFaceBatch();
    const base = fb.n;
    const meta = [cur.meta[0], cur.spin, cur.meta[2] + (cur.dark ? 64 : 0), cur.meta[3]];
    for (const [p, n] of verts) {
      fb.pos.push(p[0], p[1], p[2]);
      fb.nor.push(n[0], n[1], n[2]);
      fb.move.push(...cur.move);
      fb.meta.push(...meta);
    }
    for (const t of tris) fb.idx.push(base + t);
    fb.n += verts.length;
  }
  // ребро: две грани с нормалями n1, n2; crease — рисуется всегда, когда видна хотя бы одна грань
  function edge(a, b, n1, n2, crease) {
    edges.pos.push(...a, ...b);
    edges.n1.push(...n1, ...n1);
    edges.n2.push(...n2, ...n2);
    const meta = [cur.meta[0], cur.spin, cur.meta[2], cur.meta[3]];
    edges.move.push(...cur.move, ...cur.move);
    edges.meta.push(...meta, ...meta);
    const tone = [cur.edge, crease ? cur.crease + 1 : 0];
    edges.tone.push(...tone, ...tone);
  }
  const CREASE = Math.cos((40 * Math.PI) / 180);

  // ── формы ──
  function earClip(poly) {
    // треугольники многоугольника на плоскости (обход любой)
    const n = poly.length;
    let area = 0;
    for (let i = 0; i < n; i++) area += poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1];
    const idx = Array.from({ length: n }, (_, i) => i);
    if (area < 0) idx.reverse();
    const tris = [];
    const isEar = (i0, i1, i2, rest) => {
      const [a, b, c] = [poly[i0], poly[i1], poly[i2]];
      const crossZ = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (crossZ <= 1e-12) return false;
      for (const j of rest) {
        if (j === i0 || j === i1 || j === i2) continue;
        const p = poly[j];
        const s1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
        const s2 = (c[0] - b[0]) * (p[1] - b[1]) - (c[1] - b[1]) * (p[0] - b[0]);
        const s3 = (a[0] - c[0]) * (p[1] - c[1]) - (a[1] - c[1]) * (p[0] - c[0]);
        if (s1 >= 0 && s2 >= 0 && s3 >= 0) return false;
      }
      return true;
    };
    let guard = 0;
    while (idx.length > 3 && guard++ < 10000) {
      let cut = false;
      for (let k = 0; k < idx.length; k++) {
        const i0 = idx[(k + idx.length - 1) % idx.length];
        const i1 = idx[k];
        const i2 = idx[(k + 1) % idx.length];
        if (isEar(i0, i1, i2, idx)) {
          tris.push(i0, i1, i2);
          idx.splice(k, 1);
          cut = true;
          break;
        }
      }
      if (!cut) break;
    }
    if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
    return tris;
  }

  function prism(F, flat, s0, s1) {
    const o = F.slice(0, 3);
    const a = F.slice(3, 6);
    const u = F.slice(6, 9);
    const v = F.slice(9, 12);
    let poly = [];
    for (let i = 0; i < flat.length; i += 2) poly.push([flat[i], flat[i + 1]]);
    if (poly.length > 2 && Math.hypot(poly[0][0] - poly[poly.length - 1][0], poly[0][1] - poly[poly.length - 1][1]) < 1e-6) poly.pop();
    let area = 0;
    for (let i = 0; i < poly.length; i++) area += poly[i][0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * poly[i][1];
    if (area < 0) poly = poly.reverse();
    const n = poly.length;
    const W3 = ([x, y], s) => add(add(o, mul(a, s)), add(mul(u, x), mul(v, y)));
    const sideN = poly.map((p, i) => {
      const q = poly[(i + 1) % n];
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      return unit(add(mul(u, dy), mul(v, -dx)));
    });
    const top = unit(a);
    const bottom = mul(top, -1);
    const verts = [];
    const tris = [];
    for (let i = 0; i < n; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % n];
      const b = verts.length;
      verts.push([W3(p, s0), sideN[i]], [W3(q, s0), sideN[i]], [W3(q, s1), sideN[i]], [W3(p, s1), sideN[i]]);
      tris.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const cap = earClip(poly);
    for (const [s, nn] of [[s1, top], [s0, bottom]]) {
      const b = verts.length;
      for (const p of poly) verts.push([W3(p, s), nn]);
      for (const t of cap) tris.push(b + t);
    }
    mesh(verts, tris);
    // рёбра: верх и низ всегда; вертикальные — на острых углах, на скруглённых — посередине поворота
    for (let i = 0; i < n; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % n];
      edge(W3(p, s1), W3(q, s1), top, sideN[i], true);
      edge(W3(p, s0), W3(q, s0), bottom, sideN[i], true);
    }
    const turn = sideN.map((nn, i) => Math.acos(Math.max(-1, Math.min(1, dot(sideN[(i + n - 1) % n], nn)))));
    const crease = turn.map((t) => t > Math.acos(CREASE));
    // скругления: серия малых поворотов с суммой больше 60° — одна линия в её середине
    let i = 0;
    const seen = new Set();
    while (i < n) {
      if (turn[i] > 0.05 && !crease[i] && !seen.has(i)) {
        const run = [];
        let j = i;
        while (turn[j % n] > 0.05 && !crease[j % n] && run.length < n) {
          run.push(j % n);
          seen.add(j % n);
          j++;
        }
        const total = run.reduce((sum, k) => sum + turn[k], 0);
        if (total > (60 * Math.PI) / 180) {
          let acc = 0;
          for (const k of run) {
            acc += turn[k];
            if (acc >= total / 2) {
              crease[k] = true;
              break;
            }
          }
        }
        i = j;
      } else i++;
    }
    for (let k = 0; k < n; k++) edge(W3(poly[k], s0), W3(poly[k], s1), sideN[(k + n - 1) % n], sideN[k], crease[k]);
  }

  function body(F, flat) {
    const o = F.slice(0, 3);
    const a = unit(F.slice(3, 6));
    const u = F.slice(6, 9);
    const v = F.slice(9, 12);
    let prof = [];
    for (let i = 0; i < flat.length; i += 2) prof.push([flat[i], Math.max(0, flat[i + 1])]);
    let area = 0;
    for (let i = 0; i < prof.length; i++) area += prof[i][0] * prof[(i + 1) % prof.length][1] - prof[(i + 1) % prof.length][0] * prof[i][1];
    const sign = area < 0 ? 1 : -1; // внешняя нормаль ребра профиля (ds, dr) = sign·(−dr, ds)
    const rMax = Math.max(...prof.map((p) => p[1]));
    const N = Math.max(20, Math.min(56, Math.round(rMax * 2.2)));
    const ang = Array.from({ length: N + 1 }, (_, k) => (k / N) * Math.PI * 2);
    const radial = (t) => add(mul(u, Math.cos(t)), mul(v, Math.sin(t)));
    const at = (s, r, t) => add(add(o, mul(a, s)), mul(radial(t), r));
    // рёбра профиля (замкнутый многоугольник)
    const segs = [];
    for (let i = 0; i < prof.length; i++) {
      const p = prof[i];
      const q = prof[(i + 1) % prof.length];
      if (p[1] < 1e-6 && q[1] < 1e-6) continue;
      const ds = q[0] - p[0];
      const dr = q[1] - p[1];
      const l = Math.hypot(ds, dr);
      if (l < 1e-6) continue;
      segs.push({ p, q, ns: (sign * -dr) / l, nr: (sign * ds) / l });
    }
    const nAt = (seg, t) => unit(add(mul(a, seg.ns), mul(radial(t), seg.nr)));
    // сглаживание нормалей на изломах меньше 30°
    const smooth = segs.map((seg, i) => {
      const prev = segs[(i + segs.length - 1) % segs.length];
      const next = segs[(i + 1) % segs.length];
      const dPrev = seg.ns * prev.ns + seg.nr * prev.nr;
      const dNext = seg.ns * next.ns + seg.nr * next.nr;
      const joinPrev = prev.q === seg.p && dPrev > Math.cos((30 * Math.PI) / 180);
      const joinNext = seg.q === next.p && dNext > Math.cos((30 * Math.PI) / 180);
      return {
        a: joinPrev ? [(seg.ns + prev.ns) / 2, (seg.nr + prev.nr) / 2] : [seg.ns, seg.nr],
        b: joinNext ? [(seg.ns + next.ns) / 2, (seg.nr + next.nr) / 2] : [seg.ns, seg.nr],
      };
    });
    const verts = [];
    const tris = [];
    segs.forEach((seg, i) => {
      const b = verts.length;
      const [na, nb] = [smooth[i].a, smooth[i].b];
      for (let k = 0; k <= N; k++) {
        const t = ang[k];
        verts.push([at(seg.p[0], seg.p[1], t), unit(add(mul(a, na[0]), mul(radial(t), na[1])))]);
        verts.push([at(seg.q[0], seg.q[1], t), unit(add(mul(a, nb[0]), mul(radial(t), nb[1])))]);
      }
      for (let k = 0; k < N; k++) {
        const i0 = b + k * 2;
        tris.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2);
      }
    });
    mesh(verts, tris);
    // меридианы — кандидаты в силуэт (у плоских торцов нормаль одна, их нет)
    for (const seg of segs) {
      if (Math.abs(seg.nr) < 1e-4) continue;
      for (let k = 0; k < N; k++) {
        const t = ang[k];
        edge(at(seg.p[0], seg.p[1], t), at(seg.q[0], seg.q[1], t), nAt(seg, t - Math.PI / N), nAt(seg, t + Math.PI / N), false);
      }
    }
    // кольца в вершинах профиля: излом — линия, гладкое место — только силуэт
    segs.forEach((seg, i) => {
      const next = segs[(i + 1) % segs.length];
      if (next.p !== seg.q || seg.q[1] < 1e-6) return;
      const crease = seg.ns * next.ns + seg.nr * next.nr < Math.cos((35 * Math.PI) / 180);
      const r = seg.q[1];
      for (let k = 0; k < N; k++) {
        const tm = (ang[k] + ang[k + 1]) / 2;
        edge(at(seg.q[0], r, ang[k]), at(seg.q[0], r, ang[k + 1]), nAt(seg, tm), nAt(next, tm), crease);
      }
    });
  }

  function tube(flat, radii, round) {
    const pts = [];
    for (let i = 0; i < flat.length; i += 3) pts.push([flat[i], flat[i + 1], flat[i + 2]]);
    if (pts.length < 2) return;
    const rMax = Math.max(...radii);
    const N = Math.max(6, Math.min(22, Math.round(rMax * 5 + 6)));
    const m = pts.length;
    const T = pts.map((p, i) => unit(sub(pts[Math.min(m - 1, i + 1)], pts[Math.max(0, i - 1)])));
    let U = unit(cross(T[0], Math.abs(T[0][2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));
    const frames = [];
    for (let i = 0; i < m; i++) {
      U = unit(sub(U, mul(T[i], dot(U, T[i]))));
      frames.push([U, cross(T[i], U)]);
    }
    const ang = Array.from({ length: N + 1 }, (_, k) => (k / N) * Math.PI * 2);
    const rad = (i, t) => add(mul(frames[i][0], Math.cos(t)), mul(frames[i][1], Math.sin(t)));
    const verts = [];
    const tris = [];
    for (let i = 0; i < m; i++) for (let k = 0; k <= N; k++) {
      const n = rad(i, ang[k]);
      verts.push([add(pts[i], mul(n, radii[i])), n]);
    }
    for (let i = 0; i < m - 1; i++)
      for (let k = 0; k < N; k++) {
        const a0 = i * (N + 1) + k;
        const b0 = (i + 1) * (N + 1) + k;
        tris.push(a0, b0, b0 + 1, a0, b0 + 1, a0 + 1);
      }
    // торцы: плоский диск или полусфера
    for (const end of [0, 1]) {
      const i = end ? m - 1 : 0;
      const out = mul(T[i], end ? 1 : -1);
      if (round[end]) {
        const rings = 5;
        let prev = Array.from({ length: N + 1 }, (_, k) => i * (N + 1) + k);
        for (let j = 1; j <= rings; j++) {
          const phi = (j / rings) * (Math.PI / 2);
          const ring = [];
          for (let k = 0; k <= N; k++) {
            const n = unit(add(mul(rad(i, ang[k]), Math.cos(phi)), mul(out, Math.sin(phi))));
            ring.push(verts.length);
            verts.push([add(pts[i], mul(n, radii[i])), n]);
          }
          for (let k = 0; k < N; k++) tris.push(prev[k], ring[k], ring[k + 1], prev[k], ring[k + 1], prev[k + 1]);
          prev = ring;
        }
      } else if (radii[i] > 0.05) {
        const c = verts.length;
        verts.push([pts[i], out]);
        for (let k = 0; k <= N; k++) verts.push([add(pts[i], mul(rad(i, ang[k]), radii[i])), out]);
        for (let k = 0; k < N; k++) tris.push(c, c + 1 + k, c + 2 + k);
      }
    }
    mesh(verts, tris);
    for (let i = 0; i < m - 1; i++)
      for (let k = 0; k < N; k++) {
        const t = ang[k];
        const mid = (s) => unit(add(rad(i, s), rad(i + 1, s)));
        edge(add(pts[i], mul(rad(i, t), radii[i])), add(pts[i + 1], mul(rad(i + 1, t), radii[i + 1])), mid(t - Math.PI / N), mid(t + Math.PI / N), false);
      }
    for (const end of [0, 1]) {
      const i = end ? m - 1 : 0;
      const out = mul(T[i], end ? 1 : -1);
      for (let k = 0; k < N; k++) {
        const tm = (ang[k] + ang[k + 1]) / 2;
        const pa = add(pts[i], mul(rad(i, ang[k]), radii[i]));
        const pb = add(pts[i], mul(rad(i, ang[k + 1]), radii[i]));
        if (round[end]) edge(pa, pb, rad(i, tm), out, false);
        else if (radii[i] > 0.05) edge(pa, pb, rad(i, tm), out, true);
      }
    }
  }

  function ball(o, r, flats) {
    const LAT = 14;
    const LON = 28;
    const verts = [];
    const tris = [];
    for (let j = 0; j <= LAT; j++) {
      const phi = (j / LAT) * Math.PI;
      for (let k = 0; k <= LON; k++) {
        const t = (k / LON) * Math.PI * 2;
        let n = [Math.sin(phi) * Math.cos(t), Math.sin(phi) * Math.sin(t), Math.cos(phi)];
        let p = add(o, mul(n, r));
        for (const [nx, ny, nz, cut] of flats) {
          const f = [nx, ny, nz];
          const over = dot(sub(p, o), f) - cut;
          if (over > 0) {
            p = sub(p, mul(f, over));
            n = f;
          }
        }
        verts.push([p, n]);
      }
    }
    for (let j = 0; j < LAT; j++)
      for (let k = 0; k < LON; k++) {
        const a0 = j * (LON + 1) + k;
        const b0 = a0 + LON + 1;
        tris.push(a0, b0, b0 + 1, a0, b0 + 1, a0 + 1);
      }
    mesh(verts, tris);
    const sph = (j, k) => {
      const phi = (j / LAT) * Math.PI;
      const t = (k / LON) * Math.PI * 2;
      return [Math.sin(phi) * Math.cos(t), Math.sin(phi) * Math.sin(t), Math.cos(phi)];
    };
    for (let j = 1; j < LAT; j++)
      for (let k = 0; k < LON; k++) edge(verts[j * (LON + 1) + k][0], verts[j * (LON + 1) + k + 1][0], sph(j - 0.5, k + 0.5), sph(j + 0.5, k + 0.5), false);
    for (let j = 0; j < LAT; j++)
      for (let k = 0; k < LON; k++) edge(verts[j * (LON + 1) + k][0], verts[(j + 1) * (LON + 1) + k][0], sph(j + 0.5, k - 0.5), sph(j + 0.5, k + 0.5), false);
  }

  function box(o, axes, half) {
    const ax = [axes.slice(0, 3), axes.slice(3, 6), axes.slice(6, 9)];
    const F = [...o, ...ax[2], ...ax[0], ...ax[1]];
    prism(F, [-half[0], -half[1], half[0], -half[1], half[0], half[1], -half[0], half[1]], -half[2], half[2]);
  }

  // ── сборка сцены ──
  const TONE = { hi: 0, mid: 1, lo: 2, faint: 3 };
  D.items.forEach((item, index) => {
    const meta = META[index];
    cur = { move: meta.move, meta: meta.meta, edge: item.e, crease: item.c, spin: 0, dark: false };
    const isWheel = index === D.wheel.item;
    for (const s of item.s) {
      if (isWheel) continue;
      if (s.k === "p") prism(s.F, s.poly, s.s[0], s.s[1]);
      else if (s.k === "b") body(s.F, s.poly);
      else if (s.k === "t") tube(s.pts, s.r, s.round);
      else if (s.k === "s") ball(s.o, s.r, s.flats);
      else if (s.k === "x") box(s.o, s.axes, s.half);
    }
    for (const [tone, flat] of item.l) {
      for (let i = 0; i + 5 < flat.length; i += 3) {
        details.pos.push(flat[i], flat[i + 1], flat[i + 2], flat[i + 3], flat[i + 4], flat[i + 5]);
        for (let j = 0; j < 2; j++) {
          details.move.push(...meta.move);
          details.meta.push(meta.meta[0], 0, meta.meta[2], index);
          details.tone.push(tone, 0);
        }
      }
    }
    for (const [tone, r, x, y, z] of item.d) {
      dots.pos.push(x, y, z);
      dots.move.push(...meta.move);
      dots.meta.push(meta.meta[0], 0, meta.meta[2], index);
      dots.tone.push(tone, r);
    }
    for (const [shade, flat] of item.f) {
      const pts = [];
      for (let i = 0; i < flat.length; i += 3) pts.push([flat[i], flat[i + 1], flat[i + 2]]);
      // плоский многоугольник: веер из первой точки
      for (let i = 1; i + 1 < pts.length; i++)
        for (const p of [pts[0], pts[i], pts[i + 1]]) {
          fills.pos.push(...p);
          fills.move.push(...meta.move);
          fills.meta.push(meta.meta[0], 0, meta.meta[2], index);
          fills.tone.push(6 + shade, 0);
        }
    }
  });
  // рабочее колесо кондиционера: задний диск, лопатки (вращаются), покрывной диск
  {
    const w = D.wheel;
    const meta = META[w.item];
    const FF = [w.c[0], w.c[1], 0, 0, 0, 1, 1, 0, 0, 0, 1, 0];
    cur = { move: meta.move, meta: meta.meta, edge: TONE.mid, crease: TONE.faint, spin: 0, dark: true };
    body(FF, [40, 0, 40, w.r1 + 0.2, w.z0, w.r1 + 0.2, w.z0, 0]);
    cur = { move: meta.move, meta: meta.meta, edge: TONE.hi, crease: TONE.faint, spin: 0, dark: false };
    body(FF, [w.z1, w.r0, w.z1, w.r1 + 0.2, w.z1 + 4, w.r1 + 0.2, w.z1 + 4, w.r0]);
    cur = { move: meta.move, meta: meta.meta, edge: TONE.mid, crease: TONE.faint, spin: 3, dark: false };
    for (let k = 0; k < w.count; k++) {
      const t0 = (k / w.count) * Math.PI * 2;
      const t1 = t0 + w.twist;
      const pa = [w.c[0] + w.r0 * Math.cos(t0), w.c[1] + w.r0 * Math.sin(t0)];
      const pb = [w.c[0] + w.r1 * Math.cos(t1), w.c[1] + w.r1 * Math.sin(t1)];
      const dir = unit([pb[0] - pa[0], pb[1] - pa[1], 0]);
      const side = [-dir[1] * 0.18, dir[0] * 0.18];
      prism([0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0], [pa[0] - side[0], pa[1] - side[1], pb[0] - side[0], pb[1] - side[1], pb[0] + side[0], pb[1] + side[1], pa[0] + side[0], pa[1] + side[1]], w.z0, w.z1);
    }
  }
  // лопасти драйкулера и тёмный проём под ними
  D.blades.forEach((fan, i) => {
    const meta = META[fan.item];
    cur = { move: meta.move, meta: meta.meta, edge: TONE.hi, crease: TONE.faint, spin: i + 1, dark: false };
    for (const blade of fan.blades) prism([fan.c[0], fan.c[1], 0, 0, 0, 1, 1, 0, 0, 0, 1, 0], blade.flat(), fan.z - 0.3, fan.z + 0.3);
    cur = { move: meta.move, meta: meta.meta, edge: TONE.faint, crease: TONE.faint, spin: 0, dark: true };
    body([fan.c[0], fan.c[1], 0, 0, 0, 1, 1, 0, 0, 0, 1, 0], [fan.deck + 0.02, 0, fan.deck + 0.02, fan.rIn - 0.05, fan.deck + 0.12, fan.rIn - 0.05, fan.deck + 0.12, 0]);
  });

  // ── шейдеры ──
  const VCOMMON = `
precision highp float;
uniform vec4 uCam;
uniform vec3 uC;
uniform vec2 uO;
uniform float uK;
uniform vec2 uView;
uniform float uDepth;
uniform float uT[9];
uniform float uU[9];
uniform vec3 uUM[9];
uniform float uDur;
uniform float uSpin[3];
uniform vec2 uSpinC[3];
uniform float uStep;
vec3 toward(){return vec3(uCam.y*uCam.w,uCam.x*uCam.w,uCam.z);}
float bit(float mask,float k){return mod(floor(mask/pow(2.,k)+.001),2.);}
vec2 spinOf(float s){
  int i=int(s+.5)-1;
  if(i<0)return vec2(1.,0.);
  float a=0.;
  for(int k=0;k<3;k++)if(k==i)a=uSpin[k];
  return vec2(cos(a),sin(a));
}
vec2 spinC(float s){int i=int(s+.5)-1;vec2 c=vec2(0.);for(int k=0;k<3;k++)if(k==i)c=uSpinC[k];return c;}
vec3 turn(vec3 p,float s){vec2 cs=spinOf(s);if(s<.5)return p;vec2 c=spinC(s);vec2 q=p.xy-c;return vec3(c+vec2(q.x*cs.x-q.y*cs.y,q.x*cs.y+q.y*cs.x),p.z);}
vec3 turnN(vec3 n,float s){vec2 cs=spinOf(s);if(s<.5)return n;return vec3(n.x*cs.x-n.y*cs.y,n.x*cs.y+n.y*cs.x,n.z);}
vec3 offsetOf(vec4 mv,float unitId){
  float t=0.;float u=0.;vec3 um=vec3(0.);
  for(int k=0;k<9;k++)if(float(k)==unitId){t=uT[k];u=uU[k];um=uUM[k];}
  float x=clamp((t-mv.w)/uDur,0.,1.);
  float share=x*x*(3.-2.*x);
  return mv.xyz*share+um*u;
}
vec4 clipOf(vec3 p){
  vec3 q=p-uC;
  vec2 s=uO+uK*vec2(q.x*uCam.x-q.y*uCam.y,(q.x*uCam.y+q.y*uCam.x)*uCam.z-q.z*uCam.w);
  float d=dot(q,toward());
  return vec4(s.x/uView.x*2.-1.,1.-s.y/uView.y*2.,-d/uDepth,1.);
}
float depthOf(vec3 p){return dot(p-uC,toward());}
float focusShift(float mask){
  if(uStep<-.5)return 1.;
  return bit(mask,uStep)>.5?0.:2.;
}`;
  const FACE_V = `${VCOMMON}
attribute vec3 aPos;attribute vec3 aNor;attribute vec4 aMove;attribute vec4 aMeta;
varying vec3 vN;varying float vFlags;varying float vDepth;
void main(){
  vec3 p=turn(aPos,aMeta.y)+offsetOf(aMove,aMeta.x);
  vN=turnN(aNor,aMeta.y);
  vFlags=aMeta.z;
  vDepth=depthOf(p);
  gl_Position=clipOf(p);
}`;
  const FACE_F = `
precision highp float;
varying vec3 vN;varying float vFlags;varying float vDepth;
uniform vec3 uL;
uniform vec3 uShade[5];
uniform vec3 uLitShade;uniform vec3 uLitTop;
uniform float uMode; // 0 цвет, 1 глубина, 2 номер детали
uniform float uDepth;
uniform float uPick;
float bit(float mask,float k){return mod(floor(mask/pow(2.,k)+.001),2.);}
vec3 pack(float v){vec3 e=fract(v*vec3(1.,255.,65025.));e-=e.yzz*vec3(1./255.,1./255.,0.);return e;}
void main(){
  if(uMode>1.5){gl_FragColor=vec4(mod(uPick,256.)/255.,floor(uPick/256.)/255.,0.,1.);return;}
  if(uMode>.5){gl_FragColor=vec4(pack(clamp((vDepth+uDepth)/(2.*uDepth),0.,.999)),1.);return;}
  vec3 n=normalize(vN);
  float sc=dot(n,uL);
  float w=.012;
  float b1=smoothstep(-w,w,sc);float b2=smoothstep(.2-w,.2+w,sc);float b3=smoothstep(.42-w,.42+w,sc);float b4=smoothstep(.62-w,.62+w,sc);
  vec3 c=mix(mix(mix(mix(uShade[0],uShade[1],b1),uShade[2],b2),uShade[3],b3),uShade[4],b4);
  if(bit(vFlags,5.)>.5)c=mix(uLitShade,uLitTop,b4);
  if(bit(vFlags,6.)>.5)c=uShade[0];
  gl_FragColor=vec4(c,1.);
}`;
  const EDGE_V = `${VCOMMON}
attribute vec3 aPos;attribute vec3 aN1;attribute vec3 aN2;attribute vec4 aMove;attribute vec4 aMeta;attribute vec2 aTone;
uniform vec3 uTone[6];
uniform float uAlpha;
varying vec4 vColor;
void main(){
  vec3 V=toward();
  float f1=dot(turnN(aN1,aMeta.y),V);float f2=dot(turnN(aN2,aMeta.y),V);
  bool sil=f1*f2<0.;
  bool cr=aTone.y>.5&&(f1>-.02||f2>-.02);
  if(!(sil||cr)){gl_Position=vec4(2.,2.,2.,1.);vColor=vec4(0.);return;}
  float t=sil?aTone.x:aTone.y-1.;
  float idx=min(t+focusShift(aMeta.z),5.);
  vec3 c=uTone[5];
  for(int k=0;k<6;k++)if(float(k)==idx)c=uTone[k];
  vColor=vec4(c,1.)*uAlpha;
  vec3 p=turn(aPos,aMeta.y)+offsetOf(aMove,aMeta.x);
  gl_Position=clipOf(p);
}`;
  const LINE_F = `
precision highp float;
varying vec4 vColor;
void main(){gl_FragColor=vColor;}`;
  const DETAIL_V = `${VCOMMON}
attribute vec3 aPos;attribute vec4 aMove;attribute vec4 aMeta;attribute vec2 aTone;
uniform vec3 uTone[6];
uniform vec3 uShade0;
uniform vec3 uDot;
uniform float uAlpha;
uniform float uPx;
uniform float uPoint;
varying vec4 vColor;
void main(){
  vec3 p=aPos+offsetOf(aMove,aMeta.x);
  gl_Position=clipOf(p);
  if(aTone.x>5.5){vColor=vec4(uShade0,1.);return;}
  if(uPoint>.5){
    // винты и индикаторы: точка кита (цвет точки, прозрачность по тону)
    float a=aTone.x>4.5?.32:aTone.x<.5?.85:aTone.x<1.5?.45:aTone.x<2.5?.22:.12;
    if(uStep>-.5&&bit(aMeta.z,uStep)<.5)a*=.55;
    vColor=vec4(uDot,1.)*a;
    gl_PointSize=max(1.,aTone.y*2.*uPx);
    return;
  }
  float idx=min(aTone.x+focusShift(aMeta.z),5.);
  vec3 c=uTone[5];
  for(int k=0;k<6;k++)if(float(k)==idx)c=uTone[k];
  vColor=vec4(c,1.)*uAlpha;
}`;
  const DOT_F = `
precision highp float;
varying vec4 vColor;
uniform float uPoint;
void main(){
  if(uPoint>.5){vec2 q=gl_PointCoord*2.-1.;float r=dot(q,q);if(r>1.)discard;gl_FragColor=vColor*(1.-smoothstep(.55,1.,r));return;}
  gl_FragColor=vColor;
}`;
  const MARK_V = `${VCOMMON}
attribute vec3 aPos;attribute vec4 aColor;attribute vec2 aSize;
varying vec4 vColor;varying float vRing;
uniform float uPx;
void main(){gl_Position=clipOf(aPos);gl_PointSize=aSize.x*uPx;vColor=aColor;vRing=aSize.y;}`;
  const MARK_F = `
precision highp float;
varying vec4 vColor;varying float vRing;
uniform vec3 uPaper;uniform vec3 uRef;
void main(){
  vec2 q=gl_PointCoord*2.-1.;float r=length(q);
  float edge=1.-smoothstep(.82,1.,r);
  if(edge<=0.)discard;
  vec3 c;
  if(vRing>.5){c=mix(uPaper,uRef,smoothstep(.38,.55,r));}
  else{c=mix(vColor.rgb,uPaper,smoothstep(.62,.8,r));}
  gl_FragColor=vec4(c,1.)*edge*vColor.a;
}`;
  const HALO_V = `${VCOMMON}
attribute vec2 aXY;
varying vec2 vXY;
uniform vec4 uBase;uniform float uZ;
void main(){vXY=aXY;gl_Position=clipOf(vec3(aXY,uZ));}`;
  const HALO_F = `
precision highp float;
varying vec2 vXY;
uniform vec4 uBase;uniform vec3 uHalo;uniform float uHaloA;
void main(){
  vec2 c=uBase.xy+uBase.zw*.5;vec2 q=abs(vXY-c)-uBase.zw*.5+10.;
  float d=length(max(q,0.))+min(max(q.x,q.y),0.)-10.;
  float a=uHaloA*(1.-smoothstep(-14.,16.,d));
  gl_FragColor=vec4(uHalo,1.)*a;
}`;
  const TEXT_V = `${VCOMMON}
attribute vec3 aPos;attribute vec2 aUV;attribute vec4 aMove;attribute vec4 aMeta;
varying vec2 vUV;
void main(){vUV=aUV;gl_Position=clipOf(aPos+offsetOf(aMove,aMeta.x));}`;
  const TEXT_F = `
precision highp float;
varying vec2 vUV;uniform sampler2D uTex;uniform vec3 uInk;
void main(){float a=texture2D(uTex,vUV).a;gl_FragColor=vec4(uInk,1.)*a;}`;

  const compile = (type, source) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  };
  function program(vs, fs, attribs) {
    const v = compile(gl.VERTEX_SHADER, vs);
    const f = compile(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const p = gl.createProgram();
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    attribs.forEach((name, i) => gl.bindAttribLocation(p, i, name));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error(gl.getProgramInfoLog(p));
      return null;
    }
    const where = {};
    const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, "");
      where[name] = { at: gl.getUniformLocation(p, info.name), type: info.type, size: info.size };
    }
    return { p, where, attribs };
  }
  const P = {
    face: program(FACE_V, FACE_F, ["aPos", "aNor", "aMove", "aMeta"]),
    edge: program(EDGE_V, LINE_F, ["aPos", "aN1", "aN2", "aMove", "aMeta", "aTone"]),
    detail: program(DETAIL_V, DOT_F, ["aPos", "aMove", "aMeta", "aTone"]),
    mark: program(MARK_V, MARK_F, ["aPos", "aColor", "aSize"]),
    halo: program(HALO_V, HALO_F, ["aXY"]),
    text: program(TEXT_V, TEXT_F, ["aPos", "aUV", "aMove", "aMeta"]),
  };
  if (Object.values(P).some((p) => !p)) return null;

  const setU = (prog, name, value) => {
    const u = prog.where[name];
    if (!u) return;
    const T = gl;
    if (u.type === T.FLOAT) Array.isArray(value) || value instanceof Float32Array ? T.uniform1fv(u.at, value) : T.uniform1f(u.at, value);
    else if (u.type === T.FLOAT_VEC2) T.uniform2fv(u.at, value);
    else if (u.type === T.FLOAT_VEC3) T.uniform3fv(u.at, value);
    else if (u.type === T.FLOAT_VEC4) T.uniform4fv(u.at, value);
    else if (u.type === T.SAMPLER_2D) T.uniform1i(u.at, value);
  };
  const buffer = (data, target = gl.ARRAY_BUFFER, Type = Float32Array) => {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data instanceof Type ? data : new Type(data), gl.STATIC_DRAW);
    return b;
  };
  const faceGpu = faceBatches.map((batch) => ({
    pos: buffer(batch.pos),
    nor: buffer(batch.nor),
    move: buffer(batch.move),
    meta: buffer(batch.meta),
    idx: buffer(batch.idx, gl.ELEMENT_ARRAY_BUFFER, uintIndex ? Uint32Array : Uint16Array),
    count: batch.idx.length,
  }));
  const edgeGpu = { pos: buffer(edges.pos), n1: buffer(edges.n1), n2: buffer(edges.n2), move: buffer(edges.move), meta: buffer(edges.meta), tone: buffer(edges.tone), count: edges.pos.length / 3 };
  const detailGpu = { pos: buffer(details.pos), move: buffer(details.move), meta: buffer(details.meta), tone: buffer(details.tone), count: details.pos.length / 3 };
  const fillGpu = { pos: buffer(fills.pos), move: buffer(fills.move), meta: buffer(fills.meta), tone: buffer(fills.tone), count: fills.pos.length / 3 };
  const dotGpu = { pos: buffer(dots.pos), move: buffer(dots.move), meta: buffer(dots.meta), tone: buffer(dots.tone), count: dots.pos.length / 3 };
  const stats = { faces: faceBatches.reduce((s, b) => s + b.idx.length / 3, 0), vertices: faceBatches.reduce((s, b) => s + b.n, 0), edges: edgeGpu.count / 2, details: detailGpu.count / 2, dots: dotGpu.count };
  const attrib = (i, buf, size) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, size, gl.FLOAT, false, 0, 0);
  };
  const useAttribs = (n) => {
    for (let i = 0; i < 8; i++) (i < n ? gl.enableVertexAttribArray(i) : gl.disableVertexAttribArray(i));
  };

  // тень-ореол под основанием и табличка с надписью
  const B = D.base;
  const haloGpu = buffer([B.x - 30, B.y - 30, B.x + B.w + 30, B.y - 30, B.x + B.w + 30, B.y + B.d + 30, B.x - 30, B.y - 30, B.x + B.w + 30, B.y + B.d + 30, B.x - 30, B.y + B.d + 30]);
  const label = D.label;
  const textCanvas = document.createElement("canvas");
  textCanvas.width = 1024;
  textCanvas.height = 128;
  {
    const c2 = textCanvas.getContext("2d");
    c2.clearRect(0, 0, 1024, 128);
    c2.fillStyle = "#000";
    c2.textAlign = "center";
    c2.textBaseline = "middle";
    c2.font = '600 58px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
    if ("letterSpacing" in c2) c2.letterSpacing = "6px";
    c2.fillText(label.text, 512, 64);
  }
  const textTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, textTex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const labelItem = D.items.findIndex((item) => item.n === "stand.base");
  const textW = label.w - 8;
  const textH = textW / 8;
  const tz = label.z + 0.02;
  const [lx, ly] = label.at;
  const lm = META[labelItem];
  const textGpu = {
    pos: buffer([lx - textW / 2, ly + textH / 2, tz, lx + textW / 2, ly + textH / 2, tz, lx + textW / 2, ly - textH / 2, tz, lx - textW / 2, ly + textH / 2, tz, lx + textW / 2, ly - textH / 2, tz, lx - textW / 2, ly - textH / 2, tz]),
    uv: buffer([0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0]),
    move: buffer(Array(6).fill(lm.move).flat()),
    meta: buffer(Array(6).fill([lm.meta[0], 0, lm.meta[2], labelItem]).flat()),
  };

  // ── маркеры потоков жидкостей (динамический буфер) ──
  const markGpu = { pos: gl.createBuffer(), color: gl.createBuffer(), size: gl.createBuffer(), count: 0 };

  // ── цвета из токенов страницы ──
  const probe = document.createElement("canvas").getContext("2d");
  const colorOf = (css, fallback) => {
    probe.fillStyle = fallback;
    probe.fillStyle = css || fallback;
    const s = probe.fillStyle;
    if (s[0] === "#") return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
    const m = s.match(/[\d.]+/g);
    return m ? m.slice(0, 3).map((x) => +x / 255) : [0, 0, 0];
  };
  let COL = null;
  function readTokens() {
    const css = getComputedStyle(canvas.closest(".iso") || document.body);
    const t = (name, fb) => colorOf(css.getPropertyValue(name).trim(), fb);
    COL = {
      shade: [t("--anatomy-shade-0", "#dcdcd9"), t("--anatomy-shade-1", "#e5e5e2"), t("--anatomy-shade-2", "#ededea"), t("--anatomy-shade-3", "#f4f4f1"), t("--anatomy-top", "#ffffff")],
      litShade: t("--anatomy-lit-shade", "#eeeeeb"),
      litTop: t("--anatomy-lit-top", "#ffffff"),
      tone: [t("--anatomy-lit", "#000000"), t("--anatomy-hi", "#26262a"), t("--anatomy-mid", "#8a8a8f"), t("--anatomy-lo", "#b4b4b8"), t("--anatomy-faint", "#d4d4d6"), t("--anatomy-faint", "#d4d4d6")],
      dot: t("--anatomy-dot", "#3a3a3e"),
      paper: t("--anatomy-paper", "#fcfaf5"),
      halo: t("--anatomy-halo", "#8a8a80"),
      haloA: parseFloat(css.getPropertyValue("--anatomy-halo-opacity")) || 0.32,
      cold: t("--mk-cold", "#4a83b4"),
      warm: t("--mk-warm", "#c08636"),
      ref: t("--mk-ref", "#56565c"),
      text: t("--anatomy-lo", "#b4b4b8"),
    };
  }
  readTokens();

  // ── воздух: объём по буферу глубины ──
  const depthFbo = { fb: gl.createFramebuffer(), tex: gl.createTexture(), rb: gl.createRenderbuffer(), w: 0, h: 0, valid: false };
  const AIR_COMMON = `
precision highp float;
uniform vec4 uCam;uniform vec3 uC;uniform vec2 uO;uniform float uK;uniform vec2 uView;uniform float uDepth;
uniform vec2 uCanvas;uniform sampler2D uZ;
uniform vec4 uLevel;uniform vec2 uPhase;uniform float uLight;uniform float uTime;
float hash12(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float hash13(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float hp(vec3 i,float per){return hash13(vec3(i.x,mod(i.y,per),i.z));}
float tnoise(vec3 p,float per){vec3 i=floor(p);vec3 f=fract(p);f=f*f*(3.-2.*f);
  float a=mix(mix(hp(i,per),hp(i+vec3(1.,0.,0.),per),f.x),mix(hp(i+vec3(0.,1.,0.),per),hp(i+vec3(1.,1.,0.),per),f.x),f.y);
  float b=mix(mix(hp(i+vec3(0.,0.,1.),per),hp(i+vec3(1.,0.,1.),per),f.x),mix(hp(i+vec3(0.,1.,1.),per),hp(i+vec3(1.,1.,1.),per),f.x),f.y);
  return mix(a,b,f.z);}
float unpack(vec4 e){return dot(e.rgb,vec3(1.,1./255.,1./65025.));}
bool hitBox(vec3 p0,vec3 V,vec3 lo,vec3 hi){vec3 inv=1./V;vec3 t0=(lo-p0)*inv;vec3 t1=(hi-p0)*inv;vec3 a=min(t0,t1);vec3 b=max(t0,t1);return max(max(a.x,a.y),a.z)<min(min(b.x,b.y),b.z);}
void seg(inout vec4 acc,vec3 p0,vec3 V,float tF,vec3 a,vec3 b,vec3 rs,vec2 m){
  float ra=rs.x;float rb=rs.y;float s0=rs.z;
  vec3 d=b-a;vec3 w=a-p0;
  vec3 dp=d-dot(d,V)*V;vec3 wp=w-dot(w,V)*V;
  float u=clamp(-dot(wp,dp)/max(dot(dp,dp),1e-4),0.,1.);
  vec3 e=wp+u*dp;float d2=dot(e,e);
  float r=mix(ra,rb,u);
  if(r<.05||d2>4.*r*r)return;
  float g=exp(-2.2*d2/(r*r))*smoothstep(0.,3.,r);
  float tq=dot(w+u*d,V);
  float sig=.45*r+.6;
  float vis=1./(1.+exp(min(2.41*(tF-tq)/sig,40.)));
  vec3 n=cross(V,d);float nl=length(n);
  float x=nl>1e-4?dot(e,n/nl):0.;
  float wgt=g+1e-5;
  acc.x=max(acc.x,g*vis*mix(m.x,m.y,u));acc.y+=wgt;acc.z+=wgt*(s0+u*length(d));acc.w+=wgt*x;
}
float finish(vec4 acc,float ph,float seed,float px){
  if(acc.x<.003)return 0.;
  float s=acc.z/acc.y;float x=acc.w/acc.y;
  float q=(s-ph)/12.;
  float fine=smoothstep(2.5,4.5,1.3/px);
  float n=.6*tnoise(vec3(x/2.6+seed,q,uTime*.08),48.)+.4*mix(.5,tnoise(vec3(x/1.3+seed*1.7,q*2.,uTime*.13+3.1),96.),fine);
  float streak=smoothstep(.3,.82,n);
  return acc.x*(.26+.74*streak);
}
vec4 ink(float dens,vec3 tint,vec3 glow,float cap){
  float a=cap*(1.-exp(-2.4*dens));
  vec4 light=vec4(tint*a,a);
  vec3 c=glow*dens*.75;
  vec4 dark=vec4(c,max(c.r,max(c.g,c.b)));
  return mix(dark,light,uLight);
}
vec4 over(vec4 top,vec4 under){return top+under*(1.-top.a);}
`;
  const AIR_MAIN = (code) => `${AIR_COMMON}
void main(){
  vec2 vb=vec2(gl_FragCoord.x,uCanvas.y-gl_FragCoord.y)*(uView.x/uCanvas.x);
  vec3 V=vec3(uCam.y*uCam.w,uCam.x*uCam.w,uCam.z);
  vec3 R=vec3(uCam.x,-uCam.y,0.);
  vec3 Dn=vec3(uCam.y*uCam.z,uCam.x*uCam.z,-uCam.w);
  vec2 q=(vb-uO)/uK;
  vec3 p0=uC+q.x*R+q.y*Dn;
  float px=(uView.x/uCanvas.x)/uK;
  vec4 z=texture2D(uZ,gl_FragCoord.xy/uCanvas);
  float tF=z.a<.5?-1e4:unpack(z)*2.*uDepth-uDepth;
  float d0=0.;float d1=0.;float d2=0.;float d3=0.;
  vec4 acc;
${code}
  vec4 col=over(ink(d1*uLevel.y,vec3(.9,.62,.3),vec3(1.,.62,.26),.44),ink(d0*uLevel.x,vec3(.36,.62,.9),vec3(.32,.58,1.),.56));
  col=over(ink(d3*uLevel.w,vec3(.92,.64,.3),vec3(1.,.66,.3),.46),over(ink(d2*uLevel.z,vec3(.42,.64,.88),vec3(.42,.62,.95),.5),col));
  col.rgb=min(col.rgb,vec3(col.a));
  float n=(hash12(gl_FragCoord.xy+fract(uTime*.61)*91.)+hash12(gl_FragCoord.yx*1.37+fract(uTime*.37)*57.)-1.)/255.;
  col=max(col+n*smoothstep(0.,1.5/255.,col.a),0.);
  col.rgb=min(col.rgb,vec3(col.a));
  gl_FragColor=col;
}`;
  const AIR_V = "attribute vec2 aXY;void main(){gl_Position=vec4(aXY,0.,1.);}";
  const airGroups = (air?.groups ?? []).map((group) => ({ ...group, prog: program(AIR_V, AIR_MAIN(group.code), ["aXY"]) }));
  const airOk = airGroups.every((g) => g.prog);
  const quad = buffer([-1, -1, 3, -1, -1, 3]);

  // ── камера ──
  const cam = { az: 58, el: 30, zoom: 1, pan: [0, 0] };
  const C = D.centre;
  const K0 = D.camera.k;
  const restO = (() => {
    const [sA, cA, sE, cE] = D.camera.cam;
    return [D.camera.origin[0] + K0 * (C[0] * sA - C[1] * cA), D.camera.origin[1] + K0 * ((C[0] * cA + C[1] * sA) * sE - C[2] * cE)];
  })();
  const DEPTH = 700;
  function camUniforms() {
    const a = (cam.az * Math.PI) / 180;
    const e = (cam.el * Math.PI) / 180;
    return { uCam: [Math.sin(a), Math.cos(a), Math.sin(e), Math.cos(e)], uC: C, uO: [restO[0] + cam.pan[0], restO[1] + cam.pan[1]], uK: K0 * cam.zoom, uView: [W, H], uDepth: DEPTH };
  }
  const viewDir = () => {
    const a = (cam.az * Math.PI) / 180;
    const e = (cam.el * Math.PI) / 180;
    return [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
  };
  const project = (p) => {
    const u = camUniforms();
    const [sA, cA, sE, cE] = u.uCam;
    const q = sub(p, C);
    return [u.uO[0] + u.uK * (q[0] * sA - q[1] * cA), u.uO[1] + u.uK * ((q[0] * cA + q[1] * sA) * sE - q[2] * cE)];
  };

  // ── состояние, которое задаёт страница ──
  const UNIT_COUNT = D.units.length;
  const st = {
    T: new Float32Array(9),
    U: new Float32Array(9),
    UM: new Float32Array(27),
    spin: new Float32Array(3),
    step: -1,
    air: { levels: [0, 0, 0, 0], phase: [0, 0], time: 0 },
    marks: [],
  };
  D.units.forEach((u, i) => st.UM.set(u.unit, i * 3));
  const spinC = new Float32Array([...D.blades.flatMap((f) => f.c), ...D.wheel.c]);

  let ratio = 1;
  function fit() {
    const box = canvas.getBoundingClientRect();
    ratio = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(box.width * ratio));
    const h = Math.max(1, Math.round(box.height * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      depthFbo.valid = false;
    }
  }
  const common = (prog) => {
    const u = camUniforms();
    for (const [k, v] of Object.entries(u)) setU(prog, k, v);
    setU(prog, "uT", st.T);
    setU(prog, "uU", st.U);
    setU(prog, "uUM", st.UM);
    setU(prog, "uDur", D.explode.duration);
    setU(prog, "uSpin", st.spin);
    setU(prog, "uSpinC", spinC);
    setU(prog, "uStep", st.step);
  };
  function drawFaces(mode, pick = 0) {
    const prog = P.face;
    gl.useProgram(prog.p);
    common(prog);
    setU(prog, "uMode", mode);
    setU(prog, "uPick", pick);
    const a = (cam.az * Math.PI) / 180;
    setU(prog, "uL", unit([-Math.sin(a), Math.cos(a), 1.2]));
    setU(prog, "uShade", new Float32Array(COL.shade.flat()));
    setU(prog, "uLitShade", COL.litShade);
    setU(prog, "uLitTop", COL.litTop);
    useAttribs(4);
    for (const b of faceGpu) {
      attrib(0, b.pos, 3);
      attrib(1, b.nor, 3);
      attrib(2, b.move, 4);
      attrib(3, b.meta, 4);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idx);
      gl.drawElements(gl.TRIANGLES, b.count, uintIndex ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
    }
  }
  function ensureDepth() {
    if (depthFbo.valid && depthFbo.w === canvas.width && depthFbo.h === canvas.height) return;
    const { fb, tex, rb } = depthFbo;
    if (depthFbo.w !== canvas.width || depthFbo.h !== canvas.height) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, canvas.width, canvas.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      depthFbo.w = canvas.width;
      depthFbo.h = canvas.height;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    drawFaces(1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    depthFbo.valid = true;
  }
  function drawAir() {
    const lv = st.air.levels;
    if (!airOk || lv.every((v) => v < 1e-3)) return;
    ensureDepth();
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.SCISSOR_TEST);
    const u = camUniforms();
    const sx = canvas.width / W;
    const sy = canvas.height / H;
    for (const g of airGroups) {
      // прямоугольник группы: проекция углов её рамки
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < 8; i++) {
        const p = project([i & 1 ? g.hi[0] : g.lo[0], i & 2 ? g.hi[1] : g.lo[1], i & 4 ? g.hi[2] : g.lo[2]]);
        x0 = Math.min(x0, p[0]);
        x1 = Math.max(x1, p[0]);
        y0 = Math.min(y0, p[1]);
        y1 = Math.max(y1, p[1]);
      }
      const X0 = Math.max(0, Math.floor(x0 * sx));
      const X1 = Math.min(canvas.width, Math.ceil(x1 * sx));
      const Y0 = Math.max(0, Math.floor(canvas.height - y1 * sy));
      const Y1 = Math.min(canvas.height, Math.ceil(canvas.height - y0 * sy));
      if (X1 <= X0 || Y1 <= Y0) continue;
      gl.scissor(X0, Y0, X1 - X0, Y1 - Y0);
      gl.useProgram(g.prog.p);
      for (const [k, v] of Object.entries(u)) setU(g.prog, k, v);
      setU(g.prog, "uCanvas", [canvas.width, canvas.height]);
      setU(g.prog, "uLevel", lv);
      setU(g.prog, "uPhase", st.air.phase);
      setU(g.prog, "uLight", theme === "dark" ? 0 : 1);
      setU(g.prog, "uTime", st.air.time);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, depthFbo.tex);
      setU(g.prog, "uZ", 0);
      useAttribs(1);
      attrib(0, quad, 2);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.SCISSOR_TEST);
  }

  let depthKey = "";
  function draw() {
    fit();
    // буфер глубины для воздуха пересчитывается, когда меняется вид или положение деталей
    const key = [cam.az, cam.el, cam.zoom, cam.pan[0], cam.pan[1], ...st.T, ...st.U].map((v) => v.toFixed(3)).join(",");
    if (key !== depthKey) {
      depthKey = key;
      depthFbo.valid = false;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const pxPerUnit = ((K0 * cam.zoom) / 1) * (canvas.width / W);
    // ореол под основанием
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    {
      const prog = P.halo;
      gl.useProgram(prog.p);
      common(prog);
      setU(prog, "uBase", [B.x, B.y, B.w, B.d]);
      setU(prog, "uZ", B.z0);
      setU(prog, "uHalo", COL.halo);
      setU(prog, "uHaloA", COL.haloA);
      useAttribs(1);
      attrib(0, haloGpu, 2);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    // грани
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 2);
    drawFaces(0);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    // заливки (экран контроллера) поверх граней
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const lineAlpha = Math.min(1, 0.55 * ratio + 0.15);
    {
      const prog = P.detail;
      gl.useProgram(prog.p);
      common(prog);
      setU(prog, "uTone", new Float32Array(COL.tone.flat()));
      setU(prog, "uShade0", COL.shade[0]);
      setU(prog, "uDot", COL.dot);
      setU(prog, "uAlpha", lineAlpha);
      setU(prog, "uPx", pxPerUnit / K0 / 1);
      useAttribs(4);
      setU(prog, "uPoint", 0);
      if (fillGpu.count) {
        attrib(0, fillGpu.pos, 3);
        attrib(1, fillGpu.move, 4);
        attrib(2, fillGpu.meta, 4);
        attrib(3, fillGpu.tone, 2);
        gl.drawArrays(gl.TRIANGLES, 0, fillGpu.count);
      }
    }
    // контуры и рёбра
    {
      const prog = P.edge;
      gl.useProgram(prog.p);
      common(prog);
      setU(prog, "uTone", new Float32Array(COL.tone.flat()));
      setU(prog, "uAlpha", lineAlpha);
      useAttribs(6);
      attrib(0, edgeGpu.pos, 3);
      attrib(1, edgeGpu.n1, 3);
      attrib(2, edgeGpu.n2, 3);
      attrib(3, edgeGpu.move, 4);
      attrib(4, edgeGpu.meta, 4);
      attrib(5, edgeGpu.tone, 2);
      gl.drawArrays(gl.LINES, 0, edgeGpu.count);
    }
    // линии и точки рисунка
    {
      const prog = P.detail;
      gl.useProgram(prog.p);
      common(prog);
      setU(prog, "uTone", new Float32Array(COL.tone.flat()));
      setU(prog, "uDot", COL.dot);
      setU(prog, "uAlpha", lineAlpha);
      setU(prog, "uPx", (canvas.width / W) * cam.zoom);
      useAttribs(4);
      setU(prog, "uPoint", 0);
      attrib(0, detailGpu.pos, 3);
      attrib(1, detailGpu.move, 4);
      attrib(2, detailGpu.meta, 4);
      attrib(3, detailGpu.tone, 2);
      gl.drawArrays(gl.LINES, 0, detailGpu.count);
      setU(prog, "uPoint", 1);
      attrib(0, dotGpu.pos, 3);
      attrib(1, dotGpu.move, 4);
      attrib(2, dotGpu.meta, 4);
      attrib(3, dotGpu.tone, 2);
      gl.drawArrays(gl.POINTS, 0, dotGpu.count);
    }
    // надпись на табличке
    {
      const prog = P.text;
      gl.useProgram(prog.p);
      common(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textTex);
      setU(prog, "uTex", 0);
      setU(prog, "uInk", COL.text);
      useAttribs(4);
      attrib(0, textGpu.pos, 3);
      attrib(1, textGpu.uv, 2);
      attrib(2, textGpu.move, 4);
      attrib(3, textGpu.meta, 4);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    // маркеры жидкостей
    if (markGpu.count) {
      const prog = P.mark;
      gl.useProgram(prog.p);
      common(prog);
      setU(prog, "uPx", (canvas.width / W) * cam.zoom * K0);
      setU(prog, "uPaper", COL.paper);
      setU(prog, "uRef", COL.ref);
      useAttribs(3);
      attrib(0, markGpu.pos, 3);
      attrib(1, markGpu.color, 4);
      attrib(2, markGpu.size, 2);
      gl.drawArrays(gl.POINTS, 0, markGpu.count);
    }
    drawAir();
    gl.depthMask(true);
  }

  // номер детали под точкой холста
  const pickFbo = { fb: gl.createFramebuffer(), tex: gl.createTexture(), rb: gl.createRenderbuffer(), w: 0, h: 0 };
  function pick(clientX, clientY) {
    fit();
    const box = canvas.getBoundingClientRect();
    const x = Math.floor(((clientX - box.left) / box.width) * canvas.width);
    const y = Math.floor((1 - (clientY - box.top) / box.height) * canvas.height);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return -1;
    if (pickFbo.w !== canvas.width || pickFbo.h !== canvas.height) {
      gl.bindTexture(gl.TEXTURE_2D, pickFbo.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.bindRenderbuffer(gl.RENDERBUFFER, pickFbo.rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, canvas.width, canvas.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pickFbo.tex, 0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, pickFbo.rb);
      pickFbo.w = canvas.width;
      pickFbo.h = canvas.height;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, pickFbo.fb);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, y, 1, 1);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    // номер детали в цвет: проход по деталям через uPick невозможен одним вызовом, поэтому номер берётся из атрибута
    drawPickIds();
    const px = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px[3] ? px[0] + px[1] * 256 - 1 : -1;
  }
  const PICK_F = `
precision highp float;
varying float vId;
void main(){float id=vId+1.;gl_FragColor=vec4(mod(id,256.)/255.,floor(id/256.)/255.,0.,1.);}`;
  const PICK_V = `${VCOMMON}
attribute vec3 aPos;attribute vec3 aNor;attribute vec4 aMove;attribute vec4 aMeta;
varying float vId;
void main(){vId=aMeta.w;gl_Position=clipOf(turn(aPos,aMeta.y)+offsetOf(aMove,aMeta.x));}`;
  const pickProg = program(PICK_V, PICK_F, ["aPos", "aNor", "aMove", "aMeta"]);
  function drawPickIds() {
    gl.useProgram(pickProg.p);
    common(pickProg);
    useAttribs(4);
    for (const b of faceGpu) {
      attrib(0, b.pos, 3);
      attrib(1, b.nor, 3);
      attrib(2, b.move, 4);
      attrib(3, b.meta, 4);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.idx);
      gl.drawElements(gl.TRIANGLES, b.count, uintIndex ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
    }
  }

  // маркеры: точки на трубах со стороны зрителя
  function setMarks(list) {
    const V = viewDir();
    const pos = [];
    const color = [];
    const size = [];
    for (const m of list) {
      const t = m.tangent;
      const lift = unit(sub(V, mul(t, dot(V, t))));
      const p = add(add(m.at, mul(lift, m.lift)), mul(V, 0.2));
      pos.push(...p);
      color.push(...m.color);
      size.push(m.size, m.ring ? 1 : 0);
    }
    markGpu.count = list.length;
    api.firstMark = pos.slice(0, 3).map((v) => Math.round(v * 100) / 100);
    gl.bindBuffer(gl.ARRAY_BUFFER, markGpu.pos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, markGpu.color);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(color), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, markGpu.size);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(size), gl.DYNAMIC_DRAW);
  }

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    onLost?.();
  });

  const api = {
    gl,
    stats,
    cam,
    st,
    colors: () => COL,
    readTokens,
    draw,
    pick,
    project,
    viewDir,
    setMarks,
    invalidate() {
      depthFbo.valid = false;
    },
    unitCount: UNIT_COUNT,
    firstMark: null,
  };
  return api;
}
