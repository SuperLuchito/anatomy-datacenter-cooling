// Учебная модель установившегося теплового баланса: прецизионный кондиционер
// с жидкостным фрикулингом (принцип HPM F, выбран условно) и наружный сухой охладитель.
// Коэффициенты учебные, не паспортные. Тепло вентиляторов и насоса не учитывается.

export const COEF = {
  supplyAir: 22, // температура подачи воздуха, °C
  cAir: 4, // тепловая ёмкость воздушного потока (расход × теплоёмкость), кВт/К
  cGlycol: 8, // тепловая ёмкость потока водно-гликолевой смеси, кВт/К
  epsilon: 0.7, // эффективность теплообменника фрикулинга
  uaMax: 12, // максимальный UA драйкулера, кВт/К
  cop: 3, // холодильный коэффициент
  glycolMin: 6, // минимальная температура жидкости на подаче, °C (регулирование теплоотдачи)
  outdoor: [-15, 40], // диапазон температуры улицы, °C
  load: [20, 80], // диапазон нагрузки серверов, кВт
};

// Допуск, с которым крайние режимы считаются достигнутыми, кВт.
export const MODE_TOL = 1e-3;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function solve(tOutdoor, qIT, coef = COEF) {
  const { supplyAir, cAir, cGlycol, epsilon, uaMax, cop, glycolMin } = coef;
  const tReturn = supplyAir + qIT / cAir;
  const drycooler = cGlycol * (Math.exp(uaMax / cGlycol) - 1);
  const coldOf = (qOut) => Math.max(glycolMin, tOutdoor + qOut / drycooler);
  const freeOf = (tCold) => clamp(epsilon * cAir * (tReturn - tCold), 0, qIT);
  // Q_FC = F(Q_FC): отображение сжимающее (наклон epsilon·C_air / (COP·K) ≈ 0,03),
  // поэтому простая итерация сходится к единственному решению.
  let qFC = freeOf(coldOf(qIT));
  let iterations = 0;
  for (; iterations < 200; iterations++) {
    const qOut = qIT + (qIT - qFC) / cop;
    const next = freeOf(coldOf(qOut));
    const change = Math.abs(next - qFC);
    qFC = next;
    if (change < 1e-12) break;
  }
  const qDX = qIT - qFC;
  const pComp = qDX / cop;
  const qOut = qIT + pComp;
  const tCold = coldOf(qOut);
  const tHot = tCold + qOut / cGlycol;
  const residual = Math.abs(qFC - freeOf(tCold));
  // Регулирование: при морозе теплоотдача драйкулера снижается, чтобы подача не опускалась ниже минимума.
  const limited = tOutdoor + qOut / drycooler < glycolMin;
  const uaUsed = limited ? cGlycol * Math.log(1 + qOut / (cGlycol * (glycolMin - tOutdoor))) : uaMax;
  const mode = qDX <= MODE_TOL ? "free" : qFC <= MODE_TOL ? "compressor" : "mixed";
  return {
    tOutdoor,
    qIT,
    tReturn,
    tSupply: supplyAir,
    tBetween: tReturn - qFC / cAir, // воздух между теплообменником фрикулинга и испарителем
    qFC,
    qDX,
    pComp,
    qOut,
    tCold,
    tHot,
    limited,
    fan: uaUsed / uaMax, // показанная интенсивность наружных вентиляторов, условно
    mode,
    shareFC: qFC / qIT,
    shareDX: qDX / qIT,
    iterations,
    residual,
  };
}

export const MODE_NAME = { free: "Фрикулинг", mixed: "Смешанный режим", compressor: "Компрессорный режим" };

const comma = (text) => text.replace(".", ",").replace("-", "−");
export const fmt = (value, digits = 1) => comma((Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value).toFixed(digits));

// Доли для подписей: в смешанном режиме ни одна доля не округляется до 0 % или 100 %.
export function shares(state) {
  const fc = state.shareFC * 100;
  if (state.mode === "free") return { fc: "100", dx: "0" };
  if (state.mode === "compressor") return { fc: "0", dx: "100" };
  const round = (value) => {
    const whole = Math.round(value);
    if (whole >= 1 && whole <= 99) return String(whole);
    const tenth = Math.round(value * 10) / 10;
    return comma(Math.min(99.9, Math.max(0.1, tenth)).toFixed(1));
  };
  return { fc: round(fc), dx: round(100 - fc) };
}

// Мощность для подписи: работающий узел не показывается как 0,0 кВт.
export function power(value, on) {
  if (on && value < 0.05) return "<0,1";
  return fmt(value, 1);
}
