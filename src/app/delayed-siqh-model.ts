export type SIQHParameters = {
  beta: number;
  eta: number;
  rho: number;
  delta: number;
  r1: number;
  d1: number;
  r2: number;
  d2: number;
  alpha: number;
  tau: number;
  mu: number;
  population: number;
};

export type SIQHInitial = {
  S: number;
  I: number;
  Q: number;
  H: number;
  Rc: number;
  Dc: number;
};

export type SIQHControls = {
  u1: number;
  u2: number;
};

export type SIQHSimulation = {
  times: number[];
  S: number[];
  I: number[];
  Q: number[];
  H: number[];
  Rc: number[];
  Dc: number[];
  confirmed: number[];
  controls: SIQHControls;
  threshold: number;
};

export const DEFAULT_SIQH_PARAMETERS: SIQHParameters = {
  beta: 0.5549400942689774,
  eta: 0.00011103145269559275,
  rho: 0.015292945923126402,
  delta: 0.02018505376445493,
  r1: 0.031542009835208315,
  d1: 0.0007436976761041119,
  r2: 0.09440779040904891,
  d2: 0.00011201338402129409,
  alpha: 0.9959103140786588,
  tau: 2,
  mu: 1 / (85 * 365),
  population: 125465856,
};

export const DEFAULT_SIQH_INITIAL: SIQHInitial = {
  S: 62526544.5,
  I: 275178,
  Q: 137589,
  H: 62526544.5,
  Rc: 9022432,
  Dc: 31077,
};

export const JAPAN_WEEKLY_DATA = [
  { day: 0, confirmed: 9191098, recovered: 9022432, deaths: 31077 },
  { day: 7, confirmed: 9305998, recovered: 9123012, deaths: 31266 },
  { day: 14, confirmed: 9496651, recovered: 9228323, deaths: 31363 },
  { day: 21, confirmed: 9903381, recovered: 9389831, deaths: 31494 },
  { day: 28, confirmed: 10604679, recovered: 9732623, deaths: 31697 },
  { day: 35, confirmed: 11888057, recovered: 10380180, deaths: 32170 },
  { day: 42, confirmed: 13344898, recovered: 11397919, deaths: 32976 },
  { day: 49, confirmed: 14861375, recovered: 12800155, deaths: 34323 },
  { day: 56, confirmed: 16161801, recovered: 14255797, deaths: 35955 },
  { day: 63, confirmed: 17756658, recovered: 15672972, deaths: 37887 },
  { day: 70, confirmed: 18939344, recovered: 17110166, deaths: 39880 },
  { day: 77, confirmed: 19769989, recovered: 18300412, deaths: 41840 },
  { day: 84, confirmed: 20399933, recovered: 19415557, deaths: 43177 },
].map((point) => ({ ...point, isolated: point.confirmed - point.recovered - point.deaths }));

const EPSILON = 1e-12;

function gamma(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (value < 0.5) return Math.PI / (Math.sin(Math.PI * value) * gamma(1 - value));
  const shifted = value - 1;
  let sum = 0.99999999999980993;
  coefficients.forEach((coefficient, index) => {
    sum += coefficient / (shifted + index + 1);
  });
  const t = shifted + coefficients.length - 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, shifted + 0.5) * Math.exp(-t) * sum;
}

function validate(parameters: SIQHParameters, initial: SIQHInitial, tEnd: number, dt: number, controls: SIQHControls) {
  const rates = [parameters.beta, parameters.eta, parameters.rho, parameters.delta, parameters.r1, parameters.d1, parameters.r2, parameters.d2, parameters.mu];
  if (rates.some((value) => !Number.isFinite(value) || value < 0)) throw new Error("所有速率参数必须是非负数。");
  if (!(parameters.alpha > 0 && parameters.alpha <= 1)) throw new Error("分数阶 α 必须在 (0, 1] 内。");
  if (!Number.isFinite(parameters.tau) || parameters.tau < 0) throw new Error("潜伏期 τ 不能小于 0。");
  if (!Number.isFinite(parameters.population) || parameters.population <= 0) throw new Error("总人口 N 必须大于 0。");
  if (!Number.isFinite(tEnd) || tEnd < 1 || tEnd > 180) throw new Error("演示时长应在 1–180 天内。");
  if (!Number.isFinite(dt) || dt < 0.1 || dt > 2) throw new Error("时间步长应在 0.1–2 天内。");
  if ([controls.u1, controls.u2].some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error("控制强度 u₁、u₂ 必须在 0–1 内。");
  if (Object.values(initial).some((value) => !Number.isFinite(value) || value < 0)) throw new Error("六个初始仓室必须是非负数。");
}

function rates(parameters: SIQHParameters) {
  const power = (value: number) => Math.pow(Math.max(0, value), parameters.alpha);
  return {
    beta: power(parameters.beta),
    eta: power(parameters.eta),
    rho: power(parameters.rho),
    delta: power(parameters.delta),
    r1: power(parameters.r1),
    d1: power(parameters.d1),
    r2: power(parameters.r2),
    d2: power(parameters.d2),
    mu: power(parameters.mu),
  };
}

function derivative(state: number[], delayedI: number, parameters: SIQHParameters, controls: SIQHControls) {
  const [S, I, Q, H] = state;
  const powered = rates(parameters);
  const infection = powered.beta * S * Math.max(0, delayedI) / parameters.population;
  const protectedFlow = (1 - powered.rho) * controls.u1 * S;
  const testingFlow = (1 - powered.delta) * controls.u2 * I;
  return [
    powered.mu * parameters.population - infection + powered.eta * (1 - controls.u1) * H - powered.rho * S - powered.mu * S - protectedFlow,
    infection - powered.delta * I - powered.r1 * I - powered.d1 * I - powered.mu * I - testingFlow,
    powered.delta * I + testingFlow - powered.r2 * Q - powered.d2 * Q - powered.mu * Q,
    powered.rho * S + protectedFlow + powered.r1 * I + powered.r2 * Q - powered.eta * (1 - controls.u1) * H - powered.mu * H,
    powered.r2 * Q,
    powered.d2 * Q,
  ];
}

export function siqhThreshold(parameters: SIQHParameters) {
  const powered = rates(parameters);
  const dfeDenominator = (powered.rho + powered.mu) * (powered.eta + powered.mu) - powered.eta * powered.rho;
  const susceptibleFraction = powered.mu * (powered.eta + powered.mu) / Math.max(dfeDenominator, EPSILON);
  const infectedRemoval = powered.delta + powered.r1 + powered.d1 + powered.mu;
  return powered.beta * susceptibleFraction / Math.max(infectedRemoval, EPSILON);
}

export function simulateDelayedSIQH({
  parameters,
  initial,
  tEnd,
  dt,
  controls = { u1: 0, u2: 0 },
}: {
  parameters: SIQHParameters;
  initial: SIQHInitial;
  tEnd: number;
  dt: number;
  controls?: SIQHControls;
}): SIQHSimulation {
  validate(parameters, initial, tEnd, dt, controls);
  const steps = Math.max(1, Math.ceil(tEnd / dt));
  const actualDt = tEnd / steps;
  const alpha = parameters.alpha;
  const scalePredictor = Math.pow(actualDt, alpha) / gamma(alpha + 1);
  const scaleCorrector = Math.pow(actualDt, alpha) / gamma(alpha + 2);
  const delaySteps = Math.round(parameters.tau / actualDt);
  const initialVector = [initial.S, initial.I, initial.Q, initial.H, initial.Rc, initial.Dc];
  const states: number[][] = [initialVector];
  const derivatives: number[][] = [derivative(initialVector, initial.I, parameters, controls)];

  for (let n = 0; n < steps; n += 1) {
    const predictor = [...initialVector];
    const corrector = [...initialVector];
    for (let j = 0; j <= n; j += 1) {
      const predictorWeight = Math.pow(n + 1 - j, alpha) - Math.pow(n - j, alpha);
      let correctorWeight: number;
      if (j === 0) {
        correctorWeight = Math.pow(n, alpha + 1) - (n - alpha) * Math.pow(n + 1, alpha);
      } else {
        correctorWeight = Math.pow(n - j + 2, alpha + 1) + Math.pow(n - j, alpha + 1) - 2 * Math.pow(n - j + 1, alpha + 1);
      }
      for (let compartment = 0; compartment < 6; compartment += 1) {
        predictor[compartment] += scalePredictor * predictorWeight * derivatives[j][compartment];
        corrector[compartment] += scaleCorrector * correctorWeight * derivatives[j][compartment];
      }
    }
    const delayedIndex = n + 1 - delaySteps;
    const delayedI = delayedIndex > n ? predictor[1] : states[Math.max(0, delayedIndex)][1];
    const predictedDerivative = derivative(predictor, delayedI, parameters, controls);
    for (let compartment = 0; compartment < 6; compartment += 1) {
      corrector[compartment] = Math.max(0, corrector[compartment] + scaleCorrector * predictedDerivative[compartment]);
    }
    states.push(corrector);
    const storedDelayIndex = Math.max(0, n + 1 - delaySteps);
    derivatives.push(derivative(corrector, states[storedDelayIndex][1], parameters, controls));
  }

  const times = Array.from({ length: steps + 1 }, (_, index) => index * actualDt);
  const pick = (index: number) => states.map((state) => state[index]);
  const Q = pick(2);
  const Rc = pick(4);
  const Dc = pick(5);
  return {
    times,
    S: pick(0),
    I: pick(1),
    Q,
    H: pick(3),
    Rc,
    Dc,
    confirmed: Q.map((value, index) => value + Rc[index] + Dc[index]),
    controls,
    threshold: siqhThreshold(parameters),
  };
}

export function peakOf(values: number[], times: number[]) {
  let index = 0;
  for (let current = 1; current < values.length; current += 1) {
    if (values[current] > values[index]) index = current;
  }
  return { value: values[index], day: times[index] };
}
