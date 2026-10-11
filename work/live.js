// Живое поведение сцены. Все числа и скорости берутся из одной модели (solve).
const DATA = __DATA__;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const clampTo = (value, low, high) => Math.min(high, Math.max(low, value));

const stage = $(".dc-stage");
const viewport = $(".dc-viewport");
const zoomer = $(".dc-zoomer");
const svg = $(".dc-zoomer svg");
const readout = $("[data-readout]");
const status = $("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");

const ui = {
  outdoor: $("#dc-outdoor"),
  load: $("#dc-load"),
  outdoorValue: $("[data-v='outdoor']"),
  loadValue: $("[data-v='load']"),
  mode: $("[data-v='mode']"),
  shareFC: $("[data-v='shareFC']"),
  shareDX: $("[data-v='shareDX']"),
  barFC: $("[data-bar='fc']"),
  barDX: $("[data-bar='dx']"),
  airSupply: $("[data-v='airSupply']"),
  airReturn: $("[data-v='airReturn']"),
  airBetween: $("[data-v='airBetween']"),
  glySupply: $("[data-v='glySupply']"),
  glyReturn: $("[data-v='glyReturn']"),
  fan: $("[data-v='fan']"),
  stepTitle: $("[data-v='stepTitle']"),
  stepText: $("[data-v='stepText']"),
  stepCount: $("[data-v='stepCount']"),
  balance: $$("[data-q]"),
  equation: $("[data-v='equation']"),
  pause: $("[data-act='pause']"),
  tour: $("[data-act='tour']"),
  zoom: $("[data-act='zoom']"),
  steps: $$("[data-step]"),
  presets: $$("[data-preset]"),
};

// ── состояние ──
const DEFAULT = { outdoor: 20, load: 60 };
const state = {
  target: { ...DEFAULT },
  shown: { ...DEFAULT },
  step: -1,
  paused: false,
  touring: false,
  tourClock: 0,
  zoom: 1,
  pan: [0, 0],
};
let model = solve(state.shown.outdoor, state.shown.load);

// ── маркеры потоков ──
const flows = DATA.flows.map((flow, fi) => {
  const count = Math.max(1, Math.round(flow.total / flow.spacing));
  const spacing = flow.total / count;
  const segs = flow.segs.map((seg, si) => {
    const el = svg.querySelector(`.mk[data-f="${fi}"][data-s="${si}"]`);
    return { ...seg, el, dots: el ? [...el.children] : [] };
  });
  return { ...flow, count, spacing, segs, phase: 0, speed: 0 };
});
const flowById = Object.fromEntries(flows.map((flow) => [flow.id, flow]));

function screenAt(flow, s) {
  const i = Math.min(Math.floor(s), flow.screen.length - 2);
  const t = s - i;
  const a = flow.screen[i];
  const b = flow.screen[i + 1];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function placeFlow(flow) {
  for (const seg of flow.segs) seg.used = 0;
  let segIndex = 0;
  let zoneIndex = 0;
  for (let i = 0; i < flow.count; i++) {
    const s = flow.phase + i * flow.spacing;
    if (s >= flow.total) break;
    while (segIndex < flow.segs.length - 1 && s >= flow.segs[segIndex].b) segIndex++;
    while (zoneIndex < flow.zones.length - 1 && s >= flow.zones[zoneIndex][1]) zoneIndex++;
    const seg = flow.segs[segIndex];
    if (!seg.valid || !seg.el) continue;
    const dot = seg.dots[seg.used++];
    if (!dot) continue;
    const [x, y] = screenAt(flow, s);
    dot.setAttribute("cx", x.toFixed(2));
    dot.setAttribute("cy", y.toFixed(2));
    const tag = flow.zones.length ? flow.zones[zoneIndex][2] : "n";
    if (dot.__t !== tag) {
      dot.setAttribute("data-t", tag);
      dot.__t = tag;
    }
    if (dot.__hidden) {
      dot.removeAttribute("visibility");
      dot.__hidden = false;
    }
  }
  for (const seg of flow.segs) {
    for (let i = seg.used ?? 0; i < seg.dots.length; i++) {
      const dot = seg.dots[i];
      if (!dot.__hidden) {
        dot.setAttribute("visibility", "hidden");
        dot.__hidden = true;
      }
    }
  }
}

// скорости движения условные: единиц сцены в секунду
function speedsFrom(m) {
  const branchFC = m.qOut > 0 ? m.qFC / m.qOut : 0;
  const branchC = m.qOut > 0 ? (m.qDX + m.pComp) / m.qOut : 0;
  return {
    air: 24,
    gS: 15,
    gR: 15,
    gFC: 15 * branchFC,
    gC: 15 * branchC,
    ref: m.mode === "free" ? 0 : 12 * Math.min(1.2, m.qDX / 60 + 0.08),
    outdoor: 26 * m.fan,
    fanDeg: 240 * m.fan,
  };
}

// ── вентиляторы ──
const dryFans = $$("[data-fan]", svg);
const wheel = $("[data-wheel]", svg);
let fanAngle = 0;
let wheelPhase = 0;

// ── выделение узлов ──
const STEPS = DATA.steps;
const items = $$(".it", svg);
function applyFocus() {
  const step = STEPS[state.step];
  for (const item of items) {
    const on = step ? step.groups.includes(item.dataset.group) || step.names.includes(item.dataset.name) : false;
    if (on) item.setAttribute("data-on", "");
    else item.removeAttribute("data-on");
  }
  if (step) stage.setAttribute("data-focus", step.id);
  else stage.removeAttribute("data-focus");
  ui.steps.forEach((button, index) => button.setAttribute("aria-pressed", String(index === state.step)));
}

// ── тексты ──
const nf = (value, digits = 1) => fmt(value, digits);
const deg = (value) => `${value > 0.05 ? "+" : ""}${nf(value)} °C`;
function stepText(index, m) {
  const sh = shares(m);
  switch (index) {
    case 0:
      return `Серверы берут холодный воздух ${nf(m.tSupply)} °C из холодного коридора: он поднимается из подполья через три перфорированные плиты и входит в лицевые панели. Сзади стоек воздух выходит нагретым до ${nf(m.tReturn)} °C. Нагрузка ${nf(m.qIT)} кВт целиком переходит в воздух: при тепловой ёмкости потока 4 кВт/К он нагревается на ${nf(m.qIT / 4)} К.`;
    case 1:
      return `Тёплый воздух входит в кондиционер сверху, проходит фильтр, затем ряды фрикулинга, где его охлаждает водно-гликолевая смесь, и испаритель холодильного контура, который снимает остаток. Вентилятор подаёт воздух вниз, под фальшпол. Сейчас фрикулинг снимает ${power(m.qFC, m.qFC > 0)} кВт, испаритель ${power(m.qDX, m.mode !== "free")} кВт; между теплообменниками воздух ${nf(m.tBetween)} °C.`;
    case 2:
      return `Насос гонит смесь по замкнутому контуру. В кондиционере поток делится: клапан 12 пропускает её в теплообменник фрикулинга, клапан 13 — в пластинчатый конденсатор. Смесь приходит ${nf(m.tCold)} °C и уходит ${nf(m.tHot)} °C, унося ${nf(m.qOut)} кВт. С воздухом зала и с улицей она не смешивается: тепло проходит только через стенки теплообменников.`;
    case 3:
      return `Вентиляторы протягивают наружный воздух снизу через ребристый теплообменник, воздух нагревается и уходит вверх; орошения нет, теплообмен сухой. В зал уличный воздух не попадает. ${m.limited ? `Сейчас мороз: интенсивность вентиляторов снижена до ${nf(m.fan * 100, 0)} % (условно), чтобы смесь не остывала ниже 6 °C.` : "Сейчас вентиляторы работают в полную условную интенсивность."}`;
    case 4:
      if (m.mode === "free")
        return `Фрикулинг: смесь из драйкулера холоднее воздуха настолько, что теплообменник фрикулинга снимает все ${nf(m.qIT)} кВт. Компрессор выключен, хладагент стоит, наружу уходит ровно тепло серверов: ${nf(m.qOut)} кВт.`;
      if (m.mode === "mixed")
        return `Смешанный режим: фрикулинг снимает ${sh.fc} % нагрузки, остальное — холодильный контур. Компрессор добавляет ${power(m.pComp, true)} кВт работы, поэтому драйкулер отводит ${nf(m.qOut)} кВт: больше, чем выделяют серверы.`;
      return `Компрессорный режим: смесь теплее возвратного воздуха, фрикулинг ничего не снимает. Всю нагрузку несёт холодильный контур, компрессор добавляет ${nf(m.pComp)} кВт, и наружу уходит ${nf(m.qOut)} кВт.`;
    default:
      return "Выберите узел кнопкой, клавишами 1–5 или нажатием на рисунок. Ползунки меняют условия; все числа и скорости маркеров берутся из одной учебной модели установившегося баланса.";
  }
}

const cache = new Map();
function setText(el, text) {
  if (!el) return;
  if (cache.get(el) !== text) {
    el.textContent = text;
    cache.set(el, text);
  }
}

function render() {
  const m = model;
  const sh = shares(m);
  setText(ui.outdoorValue, deg(state.target.outdoor));
  setText(ui.loadValue, `${nf(state.target.load, 0)} кВт`);
  setText(ui.mode, MODE_NAME[m.mode]);
  setText(ui.shareFC, `${sh.fc} %`);
  setText(ui.shareDX, `${sh.dx} %`);
  ui.barFC.style.width = `${(m.shareFC * 100).toFixed(2)}%`;
  ui.barDX.style.width = `${(m.shareDX * 100).toFixed(2)}%`;
  setText(ui.airSupply, `${nf(m.tSupply)} °C`);
  setText(ui.airReturn, `${nf(m.tReturn)} °C`);
  setText(ui.airBetween, `${nf(m.tBetween)} °C`);
  setText(ui.glySupply, `${nf(m.tCold)} °C`);
  setText(ui.glyReturn, `${nf(m.tHot)} °C`);
  setText(ui.fan, `${nf(m.fan * 100, 0)} %`);
  const values = { qIT: m.qIT, qFC: m.qFC, qDX: m.qDX, pComp: m.pComp, qOut: m.qOut };
  const on = { qIT: true, qFC: m.qFC > 0, qDX: m.mode !== "free", pComp: m.mode !== "free", qOut: true };
  for (const row of ui.balance) {
    const key = row.dataset.q;
    setText($("[data-num]", row), `${power(values[key], on[key])} кВт`);
    $("[data-fill]", row).style.width = `${clampTo((values[key] / 110) * 100, 0, 100).toFixed(2)}%`;
  }
  setText(ui.equation, `Q_out = Q_IT + P_comp = ${nf(m.qIT)} + ${power(m.pComp, m.mode !== "free")} = ${nf(m.qOut)} кВт`);
  setText(ui.stepTitle, state.step >= 0 ? `${state.step + 1}. ${STEPS[state.step].title}` : "Как читать рисунок");
  setText(ui.stepText, stepText(state.step, m));
  setText(ui.stepCount, state.step >= 0 ? `шаг ${state.step + 1} из 5` : "узел не выбран");
  setText(readout, `${MODE_NAME[m.mode]} · ${deg(m.tOutdoor)} · Q_out ${nf(m.qOut)} кВт`);
  stage.dataset.mode = m.mode;
  // промежуточный цвет воздуха между теплообменниками: доля фрикулинга
  stage.style.setProperty("--mk-mid-mix", `${(m.shareFC * 100).toFixed(1)}%`);
  ui.outdoor.setAttribute("aria-valuetext", `${deg(state.target.outdoor)}`);
  ui.load.setAttribute("aria-valuetext", `${nf(state.target.load, 0)} киловатт`);
}

// ── анимация ──
let frame = 0;
let last = 0;
let visible = true;
let idleTimer = 0;
let lastMode = model.mode;
window.__dcFrames = 0;

function recompute() {
  model = solve(state.shown.outdoor, state.shown.load);
  if (model.mode !== lastMode) {
    announce(`Режим: ${MODE_NAME[model.mode]}`);
    lastMode = model.mode;
  }
}

function advance(dt) {
  const calm = still.matches;
  const k = calm ? 1 : 1 - Math.exp(-dt / 0.35);
  for (const key of ["outdoor", "load"]) {
    const gap = state.target[key] - state.shown[key];
    state.shown[key] = Math.abs(gap) < 0.005 ? state.target[key] : state.shown[key] + gap * k;
  }
  recompute();
  const sp = speedsFrom(model);
  const moving = !state.paused && !calm;
  for (const flow of flows) {
    const speed = flow.kind === "air" ? sp.air : flow.kind === "outdoor" ? sp.outdoor : flow.kind === "ref" ? sp.ref : sp[flow.id] ?? 0;
    const idle = speed < 1e-6;
    if (flow.idle !== idle) {
      flow.idle = idle;
      for (const seg of flow.segs) seg.el?.toggleAttribute("data-idle", idle);
    }
    if (moving) flow.phase = (flow.phase + speed * dt) % flow.spacing;
  }
  if (moving) {
    fanAngle = (fanAngle + sp.fanDeg * dt) % 360;
    wheelPhase = (wheelPhase + dt * 1.6) % 1;
  }
  for (const flow of flows) placeFlow(flow);
  for (const fan of dryFans) fan.setAttribute("transform", `rotate(${fanAngle.toFixed(2)})`);
  if (wheel) {
    const index = Math.floor(wheelPhase * DATA.wheel.length) % DATA.wheel.length;
    if (wheel.__i !== index) {
      wheel.innerHTML = DATA.wheel[index];
      wheel.__i = index;
    }
  }
  if (state.touring && !calm) {
    state.tourClock += dt;
    const next = Math.floor(state.tourClock / 6.5) % STEPS.length;
    if (next !== state.step) select(next, { fromTour: true });
  }
  render();
  const settling = state.target.outdoor !== state.shown.outdoor || state.target.load !== state.shown.load;
  return moving || settling || state.touring;
}

function tick(now) {
  frame = 0;
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  window.__dcFrames++;
  const keep = advance(dt);
  if (keep && visible && !document.hidden) frame = requestAnimationFrame(tick);
}
function run() {
  if (!frame && visible && !document.hidden) {
    last = 0;
    frame = requestAnimationFrame(tick);
  }
}
function stop() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}
function redraw() {
  if (frame) return;
  advance(0);
}

new IntersectionObserver(
  (entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) run();
    else stop();
  },
  { rootMargin: "120px 0px" },
).observe(stage);
document.addEventListener("visibilitychange", () => (document.hidden ? stop() : run()));

// ── сообщения для экранного диктора ──
let announceTimer = 0;
function announce(text) {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    status.textContent = text;
  }, 60);
}

// ── обзор и бездействие ──
function stopTour() {
  if (!state.touring) return;
  state.touring = false;
  ui.tour.setAttribute("aria-pressed", "false");
  setText(ui.tour, "Автопоказ");
}
function startTour() {
  if (still.matches) return;
  const next = (state.step + 1) % STEPS.length;
  state.touring = true;
  state.tourClock = next * 6.5 + 0.001;
  ui.tour.setAttribute("aria-pressed", "true");
  setText(ui.tour, "Остановить показ");
  select(next, { fromTour: true });
  run();
}
function touched() {
  stopTour();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!state.paused && !still.matches) startTour();
  }, 20000);
}

// ── действия ──
function select(index, { fromTour = false } = {}) {
  state.step = index;
  applyFocus();
  render();
  if (index >= 0) announce(`Шаг ${index + 1} из 5: ${STEPS[index].title}. ${stepText(index, model)}`);
  if (!fromTour) redraw();
}
function setCondition(key, value, { instant = false } = {}) {
  const input = key === "outdoor" ? ui.outdoor : ui.load;
  const v = clampTo(Number(value), Number(input.min), Number(input.max));
  state.target[key] = v;
  if (input.value !== String(v)) input.value = String(v);
  if (state.paused || still.matches || instant) state.shown[key] = v;
  render();
  if (state.paused || still.matches) redraw();
  else run();
}
function setPaused(paused) {
  state.paused = paused;
  ui.pause.setAttribute("aria-pressed", String(paused));
  setText(ui.pause, paused ? "Продолжить" : "Пауза");
  stage.toggleAttribute("data-paused", paused);
  if (paused) {
    state.shown = { ...state.target };
    stopTour();
    redraw();
    announce("Движение на паузе");
  } else {
    announce("Движение продолжается");
    run();
  }
}
function setZoom(zoom) {
  state.zoom = zoom;
  if (zoom === 1) state.pan = [0, 0];
  else {
    const box = viewport.getBoundingClientRect();
    state.pan = [-(zoom - 1) * box.width * 0.45, -(zoom - 1) * box.height * 0.5];
  }
  applyPan();
  ui.zoom.setAttribute("aria-pressed", String(zoom !== 1));
  setText(ui.zoom, zoom === 1 ? "Увеличить ×1.6" : "Обычный масштаб ×1");
  viewport.toggleAttribute("data-zoomed", zoom !== 1);
}
function applyPan() {
  const box = viewport.getBoundingClientRect();
  const minX = -(state.zoom - 1) * box.width;
  const minY = -(state.zoom - 1) * box.height;
  state.pan = [clampTo(state.pan[0], minX, 0), clampTo(state.pan[1], minY, 0)];
  zoomer.style.transform = state.zoom === 1 ? "" : `translate(${state.pan[0].toFixed(1)}px, ${state.pan[1].toFixed(1)}px) scale(${state.zoom})`;
}
function reset() {
  stopTour();
  setPaused(false);
  state.target = { ...DEFAULT };
  state.shown = { ...DEFAULT };
  ui.outdoor.value = String(DEFAULT.outdoor);
  ui.load.value = String(DEFAULT.load);
  setZoom(1);
  for (const flow of flows) flow.phase = 0;
  select(-1);
  recompute();
  render();
  redraw();
  announce("Состояние сброшено: +20 °C, 60 кВт");
}

// ── события ──
ui.outdoor.addEventListener("input", () => {
  touched();
  setCondition("outdoor", ui.outdoor.value);
});
ui.load.addEventListener("input", () => {
  touched();
  setCondition("load", ui.load.value);
});
ui.presets.forEach((button) =>
  button.addEventListener("click", () => {
    touched();
    setCondition("outdoor", button.dataset.preset);
    announce(`Условия: ${button.textContent.trim()}`);
  }),
);
ui.steps.forEach((button, index) =>
  button.addEventListener("click", () => {
    touched();
    select(index);
  }),
);
$("[data-act='prev']").addEventListener("click", () => {
  touched();
  select(state.step <= 0 ? STEPS.length - 1 : state.step - 1);
});
$("[data-act='next']").addEventListener("click", () => {
  touched();
  select((state.step + 1) % STEPS.length);
});
ui.tour.addEventListener("click", () => {
  clearTimeout(idleTimer);
  if (state.touring) stopTour();
  else {
    if (state.paused) setPaused(false);
    startTour();
  }
});
ui.pause.addEventListener("click", () => {
  touched();
  setPaused(!state.paused);
});
$("[data-act='reset']").addEventListener("click", () => {
  touched();
  reset();
});
ui.zoom.addEventListener("click", () => {
  touched();
  setZoom(state.zoom === 1 ? 1.6 : 1);
});

// нажатие на узел рисунка и перетаскивание увеличенной сцены
let drag = null;
viewport.addEventListener("pointerdown", (event) => {
  touched();
  if (state.zoom === 1 || event.button !== 0) return;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: [...state.pan], moved: false };
});
viewport.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) > 4) {
    drag.moved = true;
    viewport.setPointerCapture(event.pointerId);
    viewport.setAttribute("data-dragging", "");
  }
  if (drag.moved) {
    state.pan = [drag.pan[0] + dx, drag.pan[1] + dy];
    applyPan();
  }
});
const endDrag = (event) => {
  if (!drag || event.pointerId !== drag.id) return;
  if (drag.moved) {
    viewport.__suppressClick = true;
    setTimeout(() => (viewport.__suppressClick = false), 0);
  }
  viewport.removeAttribute("data-dragging");
  drag = null;
};
viewport.addEventListener("pointerup", endDrag);
viewport.addEventListener("pointercancel", endDrag);
svg.addEventListener("click", (event) => {
  if (viewport.__suppressClick) return;
  const item = event.target.closest(".it");
  if (!item) return;
  const index = STEPS.findIndex((step) => step.pick.includes(item.dataset.group));
  if (index >= 0) {
    touched();
    select(index);
  }
});
window.addEventListener("resize", applyPan);

// клавиатура: 1–5, стрелки, пробел, R (и физическая клавиша R в русской раскладке), Escape
document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target;
  const tag = target?.tagName;
  const isRange = tag === "INPUT" && target.type === "range";
  const isText = tag === "TEXTAREA" || (tag === "INPUT" && !isRange) || target?.isContentEditable;
  if (isText) return;
  const digit = /^Digit([1-5])$/.exec(event.code) || /^Numpad([1-5])$/.exec(event.code);
  if (digit && !isRange) {
    event.preventDefault();
    touched();
    select(Number(digit[1]) - 1);
    return;
  }
  if (event.code === "KeyR" || event.key === "r" || event.key === "R" || event.key === "к" || event.key === "К") {
    event.preventDefault();
    touched();
    reset();
    return;
  }
  if (event.key === "Escape") {
    if (state.zoom !== 1) {
      event.preventDefault();
      touched();
      setZoom(1);
    }
    return;
  }
  if (isRange) return; // стрелки и пробел остаются у ползунков
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    touched();
    select((state.step + 1) % STEPS.length);
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    touched();
    select(state.step <= 0 ? STEPS.length - 1 : state.step - 1);
  } else if (event.code === "Space" || event.key === " ") {
    if (tag === "BUTTON" || tag === "SUMMARY" || tag === "A") return; // пробел нажимает кнопку
    event.preventDefault();
    touched();
    setPaused(!state.paused);
  }
});

still.addEventListener?.("change", () => {
  if (still.matches) stopTour();
  stage.toggleAttribute("data-still", still.matches);
  redraw();
  run();
});
stage.toggleAttribute("data-still", still.matches);

// старт
applyFocus();
recompute();
render();
advance(0);
touched();
run();
