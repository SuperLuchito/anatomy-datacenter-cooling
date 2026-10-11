// Проверка учебной модели на сетке условий. Запуск: node model-test.mjs
import { COEF, MODE_TOL, solve, shares, power } from "./model.mjs";

const problems = [];
const fail = (text) => problems.length < 40 && problems.push(text);
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

const [t0, t1] = COEF.outdoor;
const [q0, q1] = COEF.load;
let count = 0;
let worstResidual = 0;
let maxIterations = 0;
const modes = { free: 0, mixed: 0, compressor: 0 };

for (let q = q0; q <= q1 + 1e-9; q += 0.5) {
  let previous = null;
  for (let t = t0; t <= t1 + 1e-9; t += 0.1) {
    const s = solve(t, q);
    count++;
    modes[s.mode]++;
    worstResidual = Math.max(worstResidual, s.residual);
    maxIterations = Math.max(maxIterations, s.iterations);
    const at = `t=${t.toFixed(1)} q=${q.toFixed(1)}`;
    for (const [key, value] of Object.entries(s)) if (typeof value === "number" && !Number.isFinite(value)) fail(`${at}: ${key} не конечно`);
    if (s.qFC < -1e-12 || s.qFC > q + 1e-12) fail(`${at}: Q_FC вне [0, Q_IT]: ${s.qFC}`);
    if (s.qDX < -1e-12) fail(`${at}: отрицательная нагрузка компрессора ${s.qDX}`);
    if (s.pComp < -1e-12) fail(`${at}: отрицательная мощность компрессора ${s.pComp}`);
    if (!near(s.qFC + s.qDX, q)) fail(`${at}: Q_FC + Q_DX ≠ Q_IT`);
    if (!near(s.qOut, q + s.pComp)) fail(`${at}: Q_out ≠ Q_IT + P_comp`);
    if (!near(s.pComp, s.qDX / COEF.cop)) fail(`${at}: P_comp ≠ Q_DX / COP`);
    if (!near(COEF.cGlycol * (s.tHot - s.tCold), s.qOut)) fail(`${at}: баланс жидкости не сходится`);
    if (!near(COEF.cAir * (s.tReturn - s.tSupply), q)) fail(`${at}: баланс воздуха не сходится`);
    if (!near(COEF.cAir * (s.tReturn - s.tBetween), s.qFC)) fail(`${at}: воздух на теплообменнике фрикулинга`);
    if (!near(COEF.cAir * (s.tBetween - s.tSupply), s.qDX)) fail(`${at}: воздух на испарителе`);
    if (s.tCold < COEF.glycolMin - 1e-9) fail(`${at}: подача жидкости ниже ${COEF.glycolMin} °C`);
    const dry = COEF.cGlycol * (Math.exp((s.fan * COEF.uaMax) / COEF.cGlycol) - 1);
    if (!near(s.tCold, s.tOutdoor + s.qOut / dry, 1e-7)) fail(`${at}: драйкулер не сходится с использованным UA`);
    if (s.fan <= 0 || s.fan > 1 + 1e-12) fail(`${at}: интенсивность вентиляторов вне (0, 1]: ${s.fan}`);
    if (s.qFC > Math.max(0, COEF.epsilon * COEF.cAir * (s.tReturn - s.tCold)) + 1e-9) fail(`${at}: Q_FC больше предела теплообменника`);
    if (s.qFC > 1e-9 && s.tBetween < s.tCold - 1e-9) fail(`${at}: воздух охлаждён ниже температуры жидкости`);
    if (s.tHot < s.tCold) fail(`${at}: возврат холоднее подачи`);
    if (s.residual > 1e-9) fail(`${at}: остаток итерации ${s.residual}`);
    const label = shares(s);
    if (s.mode === "mixed" && (label.fc === "100" || label.fc === "0" || label.dx === "100" || label.dx === "0")) fail(`${at}: смешанный режим подписан как крайний ${label.fc}/${label.dx}`);
    if (s.mode !== "free" && power(s.pComp, true) === "0,0") fail(`${at}: работающий компрессор подписан 0,0 кВт`);
    if (previous && s.shareFC > previous.shareFC + 1e-12) fail(`${at}: доля фрикулинга растёт с температурой улицы`);
    if (previous && s.qOut < previous.qOut - 1e-12) fail(`${at}: отводимое тепло падает с ростом температуры улицы`);
    previous = s;
  }
}

// Узкие окрестности границ режимов: проверяем подписи при Q_DX порядка допуска.
for (const q of [20, 40, 60, 80]) {
  let lo = COEF.outdoor[0];
  let hi = COEF.outdoor[1];
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (solve(mid, q).qDX > 0) hi = mid;
    else lo = mid;
  }
  for (const dt of [-1e-3, -1e-6, 0, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 0.05]) {
    const s = solve(hi + dt, q);
    const label = shares(s);
    if (s.mode === "mixed" && (label.fc === "100" || label.dx === "0")) fail(`граница q=${q} dt=${dt}: подпись 100 % при работающем компрессоре`);
    if (s.mode === "free" && s.qDX > MODE_TOL) fail(`граница q=${q}: режим фрикулинга при Q_DX=${s.qDX}`);
  }
  console.log(`граница фрикулинга при ${q} кВт: ${hi.toFixed(3)} °C`);
}

const check = (label, t, q, expected) => {
  const s = solve(t, q);
  const parts = [];
  for (const [key, value] of Object.entries(expected)) {
    const got = s[key];
    const ok = typeof value === "string" ? got === value : Math.abs(got - value) <= 0.05;
    parts.push(`${key}=${typeof got === "number" ? got.toFixed(2) : got}${ok ? "" : ` (ожидалось ${value})`}`);
    if (!ok) fail(`${label}: ${key}=${got}, ожидалось ${value}`);
  }
  console.log(`${label}: ${parts.join(" · ")} · T_возд ${s.tReturn.toFixed(1)}→${s.tSupply} °C · жидкость ${s.tCold.toFixed(2)}→${s.tHot.toFixed(2)} °C · вентиляторы ${(s.fan * 100).toFixed(1)} %`);
};
check("−10 °C, 60 кВт", -10, 60, { qFC: 60, qDX: 0, pComp: 0, qOut: 60, mode: "free" });
check("+20 °C, 60 кВт", 20, 60, { qFC: 40.9, qDX: 19.1, pComp: 6.4, qOut: 66.4, mode: "mixed" });
check("+35 °C, 60 кВт", 35, 60, { qFC: 0, qDX: 60, pComp: 20, qOut: 80, mode: "compressor" });
for (const [t, q] of [[-15, 20], [-15, 80], [40, 20], [40, 80]]) {
  const s = solve(t, q);
  console.log(`угол ${t} °C, ${q} кВт: ${s.mode} · Q_FC ${s.qFC.toFixed(2)} · P ${s.pComp.toFixed(2)} · Q_out ${s.qOut.toFixed(2)} · жидкость ${s.tCold.toFixed(2)}→${s.tHot.toFixed(2)} °C · вентиляторы ${(s.fan * 100).toFixed(1)} %`);
}

console.log(`состояний: ${count} · фрикулинг ${modes.free} · смешанный ${modes.mixed} · компрессорный ${modes.compressor} · макс. остаток ${worstResidual.toExponential(1)} · макс. итераций ${maxIterations}`);
if (problems.length) {
  console.log(`модель: ${problems.length} проблем`);
  for (const line of problems) console.log("  " + line);
  process.exitCode = 1;
} else console.log("модель: все проверки пройдены");
