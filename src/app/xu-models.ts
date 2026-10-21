export type SVIRParameters = {
  Lambda: number;
  alpha: number;
  beta1: number;
  beta2: number;
  beta3: number;
  omega: number;
  mu: number;
  xi: number;
  gamma1: number;
  gamma2: number;
};

export type SVIRState = [number, number, number, number, number, number];

export type SVIRSimulationInput = {
  parameters: SVIRParameters;
  initial: SVIRState;
  tEnd: number;
  dt: number;
  incidenceScale: number;
};

export type SVIRSimulation = {
  times: number[];
  states: SVIRState[];
  memory: number[];
  maxMassError: number;
  steps: number;
};

export type Equilibrium = {
  key: "E0" | "E1" | "E2" | "Ee";
  name: string;
  values: Array<number | null>;
  available: boolean;
};

export type SVIRAnalysis = {
  R0: number;
  R1: number;
  R2: number;
  R3: number;
  scenario: "无病" | "原始株占优" | "新株占优" | "双株共存";
  selectedEquilibrium: "E0" | "E1" | "E2" | "Ee";
  equilibria: Equilibrium[];
  sensitivities: Array<{ parameter: "β" | "Λ" | "γ" | "μ"; index: number; tenPercentEffect: number }>;
};

export type Observation = {
  day: number;
  date?: string;
  active: number;
  recovered: number;
};

export type SIRParameters = {
  Lambda: number;
  alpha: number;
  beta: number;
  mu: number;
  gamma: number;
  sigma: number;
};

export type SIRInitial = [number, number, number];

export type SIRSimulation = {
  times: number[];
  states: Array<[number, number, number]>;
  seed: number;
};

export const SVIR_PRESETS: Record<string, { label: string; parameters: SVIRParameters }> = {
  fig2: {
    label: "论文图 2（可复现修正）",
    parameters: { Lambda: 0.1, alpha: 0.8, beta1: 0.8, beta2: 0.4, beta3: 0.08, omega: 0.003, mu: 0.1, xi: 0.2, gamma1: 0.2, gamma2: 0.2 },
  },
  fig3: {
    label: "论文图 3（原始株）",
    parameters: { Lambda: 0.1, alpha: 0.8, beta1: 0.8, beta2: 0.2, beta3: 0.8, omega: 0.003, mu: 0.1, xi: 0.1, gamma1: 0.1, gamma2: 0.2 },
  },
  fig4: {
    label: "论文图 4（新株）",
    parameters: { Lambda: 0.1, alpha: 0.8, beta1: 0.5, beta2: 0.8, beta3: 0.7, omega: 0.003, mu: 0.1, xi: 0.2, gamma1: 0.2, gamma2: 0.2 },
  },
  fig5: {
    label: "论文图 5（双株）",
    parameters: { Lambda: 0.1, alpha: 0.8, beta1: 0.7, beta2: 0.7, beta3: 0.7, omega: 0.003, mu: 0.1, xi: 0.1, gamma1: 0.1, gamma2: 0.2 },
  },
};

export const DEFAULT_SVIR_INITIAL: SVIRState = [0.86, 0.05, 0.04, 0.025, 0.015, 0.01];

export const DEFAULT_SIR_PARAMETERS: SIRParameters = {
  Lambda: 0.6,
  alpha: 0.9,
  beta: 0.4,
  mu: 0.4,
  gamma: 0.5,
  sigma: 0.5,
};

export const INDIA_WEEKLY_DATA: Observation[] = [
  { day: 0, date: "2020-09-07", active: 883697, recovered: 3323950 },
  { day: 7, date: "2020-09-14", active: 990061, recovered: 3859399 },
  { day: 14, date: "2020-09-21", active: 975861, recovered: 4497867 },
  { day: 21, date: "2020-09-28", active: 947576, recovered: 5101397 },
  { day: 28, date: "2020-10-05", active: 919023, recovered: 5662490 },
  { day: 35, date: "2020-10-12", active: 838729, recovered: 6227295 },
  { day: 42, date: "2020-10-19", active: 748538, recovered: 6733328 },
  { day: 49, date: "2020-10-26", active: 625857, recovered: 7201070 },
  { day: 56, date: "2020-11-02", active: 541405, recovered: 7603121 },
  { day: 63, date: "2020-11-09", active: 505265, recovered: 7959406 },
  { day: 70, date: "2020-11-16", active: 453401, recovered: 8290370 },
  { day: 77, date: "2020-11-23", active: 438667, recovered: 8604955 },
  { day: 84, date: "2020-11-30", active: 435603, recovered: 8889585 },
  { day: 91, date: "2020-12-07", active: 383866, recovered: 9178946 },
  { day: 98, date: "2020-12-14", active: 339820, recovered: 9422636 },
  { day: 105, date: "2020-12-21", active: 292518, recovered: 9636487 },
  { day: 112, date: "2020-12-28", active: 268581, recovered: 9807569 },
  { day: 119, date: "2021-01-04", active: 231036, recovered: 9975958 },
  { day: 126, date: "2021-01-11", active: 216558, recovered: 10111294 },
  { day: 133, date: "2021-01-18", active: 200514, recovered: 10228753 },
  { day: 140, date: "2021-01-25", active: 177266, recovered: 10345985 },
  { day: 147, date: "2021-02-01", active: 163353, recovered: 10448406 },
  { day: 154, date: "2021-02-08", active: 143625, recovered: 10548521 },
  { day: 161, date: "2021-02-15", active: 136872, recovered: 10633025 },
  { day: 168, date: "2021-02-22", active: 147306, recovered: 10712665 },
];

function validateFinite(values: number[], label: string) {
  if (values.some((value) => !Number.isFinite(value))) throw new Error(`${label}必须是有限数值。`);
}

function svirDerivative(
  state: SVIRState,
  memoryValue: number,
  p: SVIRParameters,
  incidenceScale: number,
): SVIRState {
  const [S, V, I1, I2, R1, R2] = state;
  const infectionS1 = (p.beta1 * S * I1) / incidenceScale;
  const infectionS2 = (p.beta2 * S * I2) / incidenceScale;
  const infectionV2 = (p.beta3 * V * I2) / incidenceScale;
  const infectionR12 = (p.beta2 * R1 * I2) / incidenceScale;
  const vaccineFailure = p.omega * memoryValue;
  return [
    p.Lambda + vaccineFailure - infectionS1 - infectionS2 - p.mu * S - p.xi * S,
    p.xi * S - vaccineFailure - infectionV2 - p.mu * V,
    infectionS1 - (p.gamma1 + p.mu) * I1,
    infectionS2 + infectionV2 + infectionR12 - (p.gamma2 + p.mu) * I2,
    p.gamma1 * I1 - p.mu * R1 - infectionR12,
    p.gamma2 * I2 - p.mu * R2,
  ];
}

export function simulateSVIR(input: SVIRSimulationInput): SVIRSimulation {
  const { parameters: p, initial, tEnd, dt, incidenceScale } = input;
  validateFinite([...Object.values(p), ...initial, tEnd, dt, incidenceScale], "参数");
  if (p.alpha <= 0 || p.alpha > 1) throw new Error("分数阶 α 必须在 (0, 1] 内。");
  if ([p.Lambda, p.beta1, p.beta2, p.beta3, p.omega, p.mu, p.xi, p.gamma1, p.gamma2, ...initial].some((v) => v < 0)) {
    throw new Error("流行病学参数和初始状态不能为负数。");
  }
  if (dt <= 0 || tEnd <= 0 || incidenceScale <= 0) throw new Error("终止时间、步长和接触规模必须大于 0。");
  const steps = Math.round(tEnd / dt);
  if (steps < 1 || steps > 2200) throw new Error("本地演示最多计算 2,200 步，请增大步长或缩短时间。");
  const actualDt = tEnd / steps;
  const kappa = 1 - p.alpha;
  const weights = new Array<number>(steps + 1).fill(0);
  weights[0] = 1;
  for (let j = 1; j <= steps; j += 1) weights[j] = (1 - (kappa + 1) / j) * weights[j - 1];
  const tempered = weights.map((weight, j) => weight * Math.exp(-p.mu * actualDt * j));
  const fractionalScale = actualDt ** -kappa;
  const states: SVIRState[] = [initial.slice() as SVIRState];
  const times = [0];
  const memory = [fractionalScale * initial[1]];

  for (let n = 1; n <= steps; n += 1) {
    let history = 0;
    for (let lag = 1; lag <= n; lag += 1) history += tempered[lag] * states[n - lag][1];
    const current = states[n - 1];
    const fNow = svirDerivative(current, memory[n - 1], p, incidenceScale);
    let next = current.map((value, index) => value + actualDt * fNow[index]) as SVIRState;
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const memoryNext = fractionalScale * (next[1] + history);
      const fNext = svirDerivative(next, memoryNext, p, incidenceScale);
      next = current.map((value, index) => value + 0.5 * actualDt * (fNow[index] + fNext[index])) as SVIRState;
    }
    if (next.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e18)) {
      throw new Error("数值解发散，请减小步长或调整参数。");
    }
    next = next.map((value) => Math.max(0, value)) as SVIRState;
    states.push(next);
    times.push(n * actualDt);
    memory.push(fractionalScale * (next[1] + history));
  }

  const initialTotal = initial.reduce((sum, value) => sum + value, 0);
  let maxMassError = 0;
  states.forEach((state, index) => {
    const expected = p.mu > 0
      ? p.Lambda / p.mu + (initialTotal - p.Lambda / p.mu) * Math.exp(-p.mu * times[index])
      : initialTotal + p.Lambda * times[index];
    maxMassError = Math.max(maxMassError, Math.abs(state.reduce((sum, value) => sum + value, 0) - expected));
  });
  return { times, states, memory, maxMassError, steps };
}

function nullEquilibrium(key: Equilibrium["key"], name: string): Equilibrium {
  return { key, name, values: [null, null, null, null, null, null], available: false };
}

function rootOnInterval(fn: (value: number) => number, upper: number): number | null {
  const tiny = Math.max(upper * 1e-10, 1e-12);
  let left = tiny;
  let fLeft = fn(left);
  const slices = 300;
  for (let index = 1; index <= slices; index += 1) {
    const right = tiny + ((upper - tiny) * index) / slices;
    const fRight = fn(right);
    if (Number.isFinite(fLeft) && Number.isFinite(fRight) && fLeft * fRight <= 0) {
      let low = left;
      let high = right;
      for (let iteration = 0; iteration < 70; iteration += 1) {
        const mid = (low + high) / 2;
        const fMid = fn(mid);
        if (fn(low) * fMid <= 0) high = mid;
        else low = mid;
      }
      return (low + high) / 2;
    }
    left = right;
    fLeft = fRight;
  }
  return null;
}

export function analyzeSVIR(p: SVIRParameters, incidenceScale = 1): SVIRAnalysis {
  const effectiveFailure = p.omega * p.mu ** (1 - p.alpha);
  const denominator = p.mu * (p.xi + effectiveFailure + p.mu);
  const S0 = denominator > 0 ? (p.Lambda * (effectiveFailure + p.mu)) / denominator : Number.NaN;
  const V0 = denominator > 0 ? (p.xi * p.Lambda) / denominator : Number.NaN;
  const E0: Equilibrium = { key: "E0", name: "无病平衡", values: [S0, V0, 0, 0, 0, 0], available: Number.isFinite(S0 + V0) };

  let E1 = nullEquilibrium("E1", "原始株平衡");
  if (p.beta1 > 0 && p.mu > 0) {
    const S1 = (incidenceScale * (p.gamma1 + p.mu)) / p.beta1;
    const V1 = (p.xi * S1) / (effectiveFailure + p.mu);
    const I1 = (p.Lambda + effectiveFailure * V1 - (p.mu + p.xi) * S1) / (p.gamma1 + p.mu);
    const R1eq = (p.gamma1 * I1) / p.mu;
    if ([S1, V1, I1, R1eq].every((value) => Number.isFinite(value) && value >= 0)) {
      E1 = { key: "E1", name: "原始株平衡", values: [S1, V1, I1, 0, R1eq, 0], available: true };
    }
  }

  let E2 = nullEquilibrium("E2", "新株平衡");
  if (p.mu > 0) {
    const upper = Math.max(p.Lambda / p.mu, 1);
    const stateAtI2 = (I2: number) => {
      const vaccineDenominator = effectiveFailure + p.mu + (p.beta3 * I2) / incidenceScale;
      const S = p.Lambda / (p.mu + p.xi + (p.beta2 * I2) / incidenceScale - (effectiveFailure * p.xi) / vaccineDenominator);
      const V = (p.xi * S) / vaccineDenominator;
      return { S, V };
    };
    const I2 = rootOnInterval((value) => {
      const { S, V } = stateAtI2(value);
      return (p.beta2 * S + p.beta3 * V) / incidenceScale - (p.gamma2 + p.mu);
    }, upper);
    if (I2 !== null) {
      const { S, V } = stateAtI2(I2);
      const R2eq = (p.gamma2 * I2) / p.mu;
      if ([S, V, I2, R2eq].every((value) => Number.isFinite(value) && value >= 0)) {
        E2 = { key: "E2", name: "新株平衡", values: [S, V, 0, I2, 0, R2eq], available: true };
      }
    }
  }

  let Ee = nullEquilibrium("Ee", "双株共存平衡");
  if (p.beta1 > 0 && p.mu > 0) {
    const S = (incidenceScale * (p.gamma1 + p.mu)) / p.beta1;
    const upper = Math.max(p.Lambda / p.mu, 1);
    const coexistence = (I2: number) => {
      const V = (p.xi * S) / (effectiveFailure + p.mu + (p.beta3 * I2) / incidenceScale);
      const I1 = (p.Lambda + effectiveFailure * V - (p.beta2 * S * I2) / incidenceScale - (p.mu + p.xi) * S) / (p.gamma1 + p.mu);
      const R1eq = (p.gamma1 * I1) / (p.mu + (p.beta2 * I2) / incidenceScale);
      return { V, I1, R1eq };
    };
    const I2 = rootOnInterval((value) => {
      const { V, R1eq } = coexistence(value);
      return (p.beta2 * (S + R1eq) + p.beta3 * V) / incidenceScale - (p.gamma2 + p.mu);
    }, upper);
    if (I2 !== null) {
      const { V, I1, R1eq } = coexistence(I2);
      const R2eq = (p.gamma2 * I2) / p.mu;
      if ([S, V, I1, I2, R1eq, R2eq].every((value) => Number.isFinite(value) && value >= 0)) {
        Ee = { key: "Ee", name: "双株共存平衡", values: [S, V, I1, I2, R1eq, R2eq], available: true };
      }
    }
  }

  const maxBeta = Math.max(p.beta1, p.beta2, p.beta3);
  const minGamma = Math.min(p.gamma1, p.gamma2);
  const R0 = p.mu > 0 ? (maxBeta * p.Lambda) / (incidenceScale * p.mu * (minGamma + p.mu)) : Number.POSITIVE_INFINITY;
  const R1 = (p.beta1 * S0) / (incidenceScale * (p.gamma1 + p.mu));
  const R2 = (p.beta2 * S0 + p.beta3 * V0) / (incidenceScale * (p.gamma2 + p.mu));
  const R3 = E1.available
    ? (p.beta2 * ((E1.values[0] ?? 0) + (E1.values[4] ?? 0)) + p.beta3 * (E1.values[1] ?? 0)) / (incidenceScale * (p.gamma2 + p.mu))
    : Number.NaN;

  let scenario: SVIRAnalysis["scenario"] = "双株共存";
  let selectedEquilibrium: SVIRAnalysis["selectedEquilibrium"] = "Ee";
  if (Math.max(R1, R2) <= 1) {
    scenario = "无病";
    selectedEquilibrium = "E0";
  } else if (R1 > 1 && (!Number.isFinite(R3) || R3 <= 1)) {
    scenario = "原始株占优";
    selectedEquilibrium = "E1";
  } else if (R2 > 1 && R1 <= 1) {
    scenario = "新株占优";
    selectedEquilibrium = "E2";
  }

  const sensitivities: SVIRAnalysis["sensitivities"] = [
    { parameter: "β", index: 1, tenPercentEffect: 10 },
    { parameter: "Λ", index: 1, tenPercentEffect: 10 },
    { parameter: "γ", index: -minGamma / (minGamma + p.mu), tenPercentEffect: (-10 * minGamma) / (minGamma + p.mu) },
    { parameter: "μ", index: -1 - p.mu / (minGamma + p.mu), tenPercentEffect: -10 * (1 + p.mu / (minGamma + p.mu)) },
  ];

  return { R0, R1, R2, R3, scenario, selectedEquilibrium, equilibria: [E0, E1, E2, Ee], sensitivities };
}

function gammaFunction(value: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];
  if (value < 0.5) return Math.PI / (Math.sin(Math.PI * value) * gammaFunction(1 - value));
  const z = value - 1;
  let x = 0.9999999999998099;
  coefficients.forEach((coefficient, index) => { x += coefficient / (z + index + 1); });
  const t = z + coefficients.length - 0.5;
  return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * x;
}

function seededUniform(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizedGaussian(count: number, seed: number): number[] {
  const random = seededUniform(seed);
  const values: number[] = [];
  while (values.length < count) {
    const u1 = Math.max(random(), 1e-12);
    const u2 = random();
    const radius = Math.sqrt(-2 * Math.log(u1));
    values.push(radius * Math.cos(2 * Math.PI * u2));
    if (values.length < count) values.push(radius * Math.sin(2 * Math.PI * u2));
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(values.length - 1, 1));
  return values.map((value) => (value - mean) / (deviation || 1));
}

export function simulateStochasticSIR(
  parameters: SIRParameters,
  initial: SIRInitial,
  tEnd: number,
  dt: number,
  seed = 2025,
): SIRSimulation {
  validateFinite([...Object.values(parameters), ...initial, tEnd, dt], "参数");
  if (parameters.alpha <= 0 || parameters.alpha > 1) throw new Error("分数阶 α 必须在 (0, 1] 内。");
  if ([parameters.Lambda, parameters.beta, parameters.mu, parameters.gamma, parameters.sigma, ...initial].some((value) => value < 0)) {
    throw new Error("参数和初始状态不能为负数。");
  }
  const steps = Math.round(tEnd / dt);
  if (steps < 1 || steps > 1600) throw new Error("单次随机模拟最多 1,600 步，请增大步长或缩短时间。");
  const h = tEnd / steps;
  const p = parameters.alpha;
  const noise = normalizedGaussian(steps + 1, seed);
  const states: Array<[number, number, number]> = [initial.slice() as SIRInitial];
  const times = [0];
  const fValues: Array<[number, number, number]> = [];
  const multiplier = h ** p / gammaFunction(p + 2);

  const rightHandSide = (state: SIRInitial, w: number): SIRInitial => {
    const [S, I, R] = state;
    const randomTransmission = parameters.sigma * S * I * w;
    return [
      parameters.Lambda - parameters.beta * S * I - parameters.mu * S - randomTransmission,
      parameters.beta * S * I - (parameters.mu + parameters.gamma) * I + randomTransmission,
      -parameters.mu * R + parameters.gamma * I,
    ];
  };

  for (let n = 0; n < steps; n += 1) {
    const a: SIRInitial = [0, 0, 0];
    const b: SIRInitial = [0, 0, 0];
    for (let j = 0; j <= n; j += 1) {
      if (!fValues[j]) fValues[j] = rightHandSide(states[j], noise[j]);
      const tmpA = j === 0
        ? n ** (p + 1) - (n - p) * (n + 1) ** p
        : (n - j + 2) ** (p + 1) + (n - j) ** (p + 1) - 2 * (n - j + 1) ** (p + 1);
      const tmpB = (h ** p * ((n + 1 - j) ** p - (n - j) ** p)) / p;
      for (let stateIndex = 0; stateIndex < 3; stateIndex += 1) {
        a[stateIndex] += tmpA * fValues[j][stateIndex];
        b[stateIndex] += tmpB * fValues[j][stateIndex];
      }
    }
    const predictor = initial.map((value, index) => value + b[index] / gammaFunction(p)) as SIRInitial;
    const deterministic: SIRInitial = [
      parameters.Lambda - parameters.beta * predictor[0] * predictor[1] - parameters.mu * predictor[0],
      parameters.beta * predictor[0] * predictor[1] - (parameters.mu + parameters.gamma) * predictor[1],
      -parameters.mu * predictor[2] + parameters.gamma * predictor[1],
    ];
    const directNoise = parameters.sigma * states[n][0] * states[n][1] * noise[n];
    let next: SIRInitial = [
      initial[0] + multiplier * (deterministic[0] + a[0] - directNoise),
      initial[1] + multiplier * (deterministic[1] + a[1] + directNoise),
      initial[2] + multiplier * (deterministic[2] + a[2]),
    ];
    if (next.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e12)) {
      throw new Error("随机路径数值发散，请降低 σ 或减小步长。");
    }
    next = next.map((value) => Math.max(0, value)) as SIRInitial;
    states.push(next);
    times.push((n + 1) * h);
  }
  return { times, states, seed };
}

export function sirReproductionNumber(p: SIRParameters) {
  return p.mu > 0 ? (p.beta * p.Lambda) / (p.mu * (p.mu + p.gamma)) : Number.POSITIVE_INFINITY;
}

export function sirEquilibrium(p: SIRParameters): SIRInitial {
  const reproduction = sirReproductionNumber(p);
  if (reproduction <= 1 || p.beta <= 0 || p.mu <= 0) return [p.Lambda / p.mu, 0, 0];
  const S = (p.mu + p.gamma) / p.beta;
  const I = (p.Lambda - p.mu * S) / (p.mu + p.gamma);
  return [S, I, (p.gamma * I) / p.mu];
}

export function extinctionTime(simulation: SIRSimulation, threshold = 1e-3): number | null {
  const window = Math.min(10, Math.max(3, Math.floor(simulation.states.length / 20)));
  for (let index = 0; index <= simulation.states.length - window; index += 1) {
    if (simulation.states.slice(index, index + window).every((state) => state[1] < threshold)) return simulation.times[index];
  }
  return null;
}

export function runStabilityEnsemble(
  parameters: SIRParameters,
  initial: SIRInitial,
  tEnd: number,
  dt: number,
  pathCount: number,
  seed: number,
) {
  const safeCount = Math.max(3, Math.min(20, Math.round(pathCount)));
  const random = seededUniform(seed + 991);
  const paths: SIRSimulation[] = [];
  for (let index = 0; index < safeCount; index += 1) {
    const perturbed = initial.map((value) => Math.max(0, value * (0.88 + 0.24 * random()))) as SIRInitial;
    paths.push(simulateStochasticSIR(parameters, perturbed, tEnd, dt, seed + index * 7919));
  }
  const target = sirEquilibrium(parameters);
  const times = paths[0].times;
  const meanStates = times.map((_, timeIndex) => {
    const sums = paths.reduce((acc, path) => {
      path.states[timeIndex].forEach((value, stateIndex) => { acc[stateIndex] += value; });
      return acc;
    }, [0, 0, 0]);
    return sums.map((sum) => sum / paths.length) as SIRInitial;
  });
  const meanSquareDistance = times.map((_, timeIndex) => (
    paths.reduce((sum, path) => sum + path.states[timeIndex].reduce((distance, value, stateIndex) => distance + (value - target[stateIndex]) ** 2, 0), 0) / paths.length
  ));
  return { paths, times, meanStates, meanSquareDistance, target };
}

export function parseObservationCsv(text: string): Observation[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const observations = lines.map((line, index) => {
    const columns = line.split(/[,，\t]/).map((value) => value.trim());
    if (index === 0 && columns.some((value) => /day|active|recovered|天|感染|康复/i.test(value))) return null;
    const [day, active, recovered] = columns.map(Number);
    if (![day, active, recovered].every(Number.isFinite)) throw new Error(`第 ${index + 1} 行不是有效的 day,active,recovered 数据。`);
    return { day, active, recovered };
  }).filter((row): row is Observation => row !== null);
  if (observations.length < 3) throw new Error("至少需要 3 行观测数据。");
  return observations.sort((a, b) => a.day - b.day);
}

const INDIA_WARM_PARAMETERS: SVIRParameters = {
  Lambda: 5.36290253e5,
  alpha: 0.8393,
  beta1: 0.617238767,
  beta2: 0.116718915,
  beta3: 0.0726693548,
  omega: 0.00998568632,
  mu: 3.84628417e-5,
  xi: 0.0810910608,
  gamma1: 0.123180555,
  gamma2: 0.0913522808,
};

export function quickFitIndia(observations: Observation[]) {
  const population = 1.324e9;
  const first = observations[0];
  const initial: SVIRState = [
    Math.max(0, population - first.active - first.recovered),
    0,
    2,
    Math.max(0, first.active - 2),
    0.1,
    Math.max(0, first.recovered - 0.1),
  ];
  const tEnd = observations.at(-1)?.day ?? 168;
  const incidenceScale = 1.322785895e9;
  const evaluate = (scales: [number, number, number]) => {
    const parameters: SVIRParameters = {
      ...INDIA_WARM_PARAMETERS,
      Lambda: INDIA_WARM_PARAMETERS.Lambda * scales[2],
      beta1: INDIA_WARM_PARAMETERS.beta1 * scales[0],
      beta2: INDIA_WARM_PARAMETERS.beta2 * scales[0],
      beta3: INDIA_WARM_PARAMETERS.beta3 * scales[0],
      gamma1: INDIA_WARM_PARAMETERS.gamma1 * scales[1],
      gamma2: INDIA_WARM_PARAMETERS.gamma2 * scales[1],
    };
    const simulation = simulateSVIR({ parameters, initial, tEnd, dt: 0.5, incidenceScale });
    const activePeak = Math.max(...observations.map((row) => row.active), 1);
    const recoveredPeak = Math.max(...observations.map((row) => row.recovered), 1);
    let squared = 0;
    observations.forEach((row) => {
      const state = simulation.states[Math.min(simulation.steps, Math.round(row.day / (tEnd / simulation.steps)))];
      squared += ((state[2] + state[3] - row.active) / activePeak) ** 2;
      squared += ((state[4] + state[5] - row.recovered) / recoveredPeak) ** 2;
    });
    return { score: Math.sqrt(squared / (observations.length * 2)), parameters, simulation };
  };

  let scales: [number, number, number] = [1, 1, 1];
  let best = evaluate(scales);
  for (const step of [0.24, 0.12, 0.06]) {
    for (let dimension = 0; dimension < 3; dimension += 1) {
      for (const direction of [-1, 1]) {
        const trial = scales.slice() as [number, number, number];
        trial[dimension] = Math.max(0.35, Math.min(1.8, trial[dimension] + step * direction));
        const result = evaluate(trial);
        if (result.score < best.score) {
          best = result;
          scales = trial;
        }
      }
    }
  }
  return { ...best, incidenceScale, observations };
}
