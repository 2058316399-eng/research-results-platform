export const STATE_KEYS = [
  "Smi",
  "Smf",
  "Emi",
  "Emf",
  "Imi",
  "Imf",
  "Sh",
  "Eh",
  "Ih",
  "Rh",
] as const;

export type StateKey = (typeof STATE_KEYS)[number];
export type Scenario = "DFE" | "EE";

export type SimulationInput = {
  scenario: Scenario;
  duration: number;
  step: number;
  initial: number[];
};

export type SeriesPoint = { t: number } & Record<StateKey, number>;

export type SimulationResult = {
  model: "malaria_seir_10_state";
  scenario: Scenario;
  solver: "fixed_step_rk4";
  duration: number;
  step: number;
  computedSteps: number;
  sampledPoints: number;
  summary: {
    peakInfectiousHumans: number;
    peakTime: number;
    finalInfectiousHumans: number;
    finalRecoveredHumans: number;
    finalMosquitoPopulation: number;
    finalHumanPopulation: number;
  };
  finalState: Record<StateKey, number>;
  series: SeriesPoint[];
};

export type R0Input = {
  scenario: Scenario;
  period: number;
  carryingCapacity: number;
  humanRecruitment: number;
  naturalHumanMortality: number;
  infectiousMaleFactor: number;
  recoveryRate: number;
  diseaseMortality: number;
  integrationStep: number;
  tolerance: number;
  maxPeriods: number;
};

export type R0Result = {
  model: "periodic_next_generation_operator";
  scenario: Scenario;
  R0: number;
  threshold: "below_one" | "equal_one" | "above_one";
  converged: boolean;
  rootIterations: number;
  periodicMosquitoIterations: number;
  periodicMosquitoConverged: boolean;
  periodicEndpointError: number;
  susceptibleMaleRange: [number, number];
  susceptibleFemaleRange: [number, number];
  parameters: R0Input;
};

export const DEFAULT_INITIALS: Record<Scenario, number[]> = {
  DFE: [
    300000, 600000, 150000, 200000, 80000, 100000, 15000000, 10000,
    50000, 1000000,
  ],
  EE: [600000, 300000, 200000, 1, 1, 1, 5000000, 100000, 500000, 1000000],
};

export const DEFAULT_DURATION: Record<Scenario, number> = {
  DFE: 2000,
  EE: 1200,
};

export const DEFAULT_R0_INPUTS: Record<Scenario, R0Input> = {
  DFE: {
    scenario: "DFE",
    period: 12,
    carryingCapacity: 8e6,
    humanRecruitment: 178340,
    naturalHumanMortality: 0.00148,
    infectiousMaleFactor: 0.1,
    recoveryRate: 0.5,
    diseaseMortality: 0.005,
    integrationStep: 0.02,
    tolerance: 1e-6,
    maxPeriods: 1000,
  },
  EE: {
    scenario: "EE",
    period: 12,
    carryingCapacity: 8e6,
    humanRecruitment: 17000,
    naturalHumanMortality: 0.00148,
    infectiousMaleFactor: 0.9,
    recoveryRate: 0.0833,
    diseaseMortality: 0.0028,
    integrationStep: 0.02,
    tolerance: 1e-6,
    maxPeriods: 1000,
  },
};

const MAX_STEPS = 500000;
const DISPLAY_POINTS = 720;

function baseBeta(t: number) {
  return (
    10.01 -
    2.421 * Math.sin((Math.PI * t) / 6) -
    4.185 * Math.cos((Math.PI * t) / 6) -
    1.625 * Math.sin((2 * Math.PI * t) / 6) -
    1.006 * Math.cos((2 * Math.PI * t) / 6) -
    0.03432 * Math.sin((3 * Math.PI * t) / 6) +
    0.2236 * Math.cos((3 * Math.PI * t) / 6)
  );
}

function dmfAt(t: number) {
  return (
    3.043 +
    0.03798 * Math.sin((Math.PI * t) / 6) +
    0.066 * Math.cos((Math.PI * t) / 6) +
    0.04835 * Math.sin((2 * Math.PI * t) / 6) +
    0.02775 * Math.cos((2 * Math.PI * t) / 6) +
    0.03432 * Math.sin((3 * Math.PI * t) / 6) +
    0.00008352 * Math.cos((3 * Math.PI * t) / 6)
  );
}

function dmiAt(t: number) {
  return 1.05 * dmfAt(t);
}

function dfeBetaM(t: number) {
  return (
    0.48 *
    (10.01 -
      2.421 * Math.sin((Math.PI * t) / 6) -
      1.652 * Math.cos((Math.PI * t) / 6) -
      0.06434 * Math.sin((2 * Math.PI * t) / 6) -
      4.185 * Math.cos((2 * Math.PI * t) / 6) -
      1.006 * Math.sin((3 * Math.PI * t) / 6) +
      0.2236 * Math.cos((3 * Math.PI * t) / 6))
  );
}

function derivative(
  t: number,
  y: Float64Array,
  scenario: Scenario,
  out: Float64Array,
) {
  const Km = 8e6;
  const beta = baseBeta(t);
  const betaM = scenario === "DFE" ? dfeBetaM(t) : 0.48 * beta;
  const bm = 2.5 * beta;
  const dmf = dmfAt(t);
  const dmi = 1.05 * dmf;
  const betaHf = (0.022 / 0.48) * betaM;
  const betaHi = (scenario === "DFE" ? 0.1 : 0.9) * betaHf;
  const ebmi = 2.523;
  const ebmf = 0.9 * ebmi;
  const theta = 3.04;
  const recovery = scenario === "DFE" ? 0.5 : 0.0833;
  const diseaseMortality = scenario === "DFE" ? 0.005 : 0.0028;
  const immunityLoss = 0.0146;
  const humanMortality = scenario === "DFE" ? 0.003 : 0.00148;
  const recruitment = scenario === "DFE" ? 178340 : 17000;

  const [Smi, Smf, Emi, Emf, Imi, Imf, Sh, Eh, Ih, Rh] = y;
  const humans = Math.max(Sh + Eh + Ih + Rh, 1e-12);
  const mosquitoes = Math.max(Smi + Smf + Emi + Emf + Imi + Imf, 1e-12);
  const maleMosquitoes = Smi + Emi + Imi;
  const femaleMosquitoes = Smf + Emf + Imf;

  out[0] =
    bm * (1 - maleMosquitoes / Km) * maleMosquitoes -
    dmi * Smi -
    (betaM * Smi * Ih) / humans;
  out[1] =
    bm * (1 - maleMosquitoes / mosquitoes - femaleMosquitoes / Km) *
      femaleMosquitoes -
    dmf * Smf -
    (betaM * Smf * Ih) / humans;
  out[2] = (betaM * Smi * Ih) / humans - (dmi + ebmi) * Emi;
  out[3] = (betaM * Smf * Ih) / humans - (dmf + ebmf) * Emf;
  out[4] = ebmi * Emi - dmi * Imi;
  out[5] = ebmf * Emf - dmf * Imf;
  out[6] =
    recruitment -
    (betaHi * Sh * Imi + betaHf * Sh * Imf) / humans +
    immunityLoss * Rh -
    humanMortality * Sh;
  // This intentionally preserves the beta_m terms in both source .m files.
  out[7] =
    (betaM * Sh * Imi + betaM * Sh * Imf) / humans -
    theta * Eh -
    humanMortality * Eh;
  out[8] =
    theta * Eh -
    humanMortality * Ih -
    recovery * Ih -
    diseaseMortality * Ih;
  out[9] = recovery * Ih - immunityLoss * Rh - humanMortality * Rh;
}

function pointFromState(t: number, state: Float64Array): SeriesPoint {
  const point = { t } as SeriesPoint;
  STATE_KEYS.forEach((key, index) => {
    point[key] = state[index];
  });
  return point;
}

function stateRecord(state: Float64Array) {
  const record = {} as Record<StateKey, number>;
  STATE_KEYS.forEach((key, index) => {
    record[key] = state[index];
  });
  return record;
}

export function simulateMalaria(input: SimulationInput): SimulationResult {
  const { scenario, duration, step } = input;
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("模拟时长必须大于 0。");
  }
  if (!Number.isFinite(step) || step <= 0) {
    throw new Error("步长必须大于 0。");
  }
  if (input.initial.length !== STATE_KEYS.length) {
    throw new Error("初始状态必须包含 10 个数值。");
  }
  if (input.initial.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("初始状态必须是非负有限数值。");
  }

  const totalSteps = Math.ceil(duration / step);
  if (totalSteps > MAX_STEPS) {
    throw new Error(`计算步数不能超过 ${MAX_STEPS.toLocaleString("zh-CN")}。`);
  }

  const sampleEvery = Math.max(1, Math.ceil(totalSteps / DISPLAY_POINTS));
  const y = Float64Array.from(input.initial);
  const temp = new Float64Array(10);
  const k1 = new Float64Array(10);
  const k2 = new Float64Array(10);
  const k3 = new Float64Array(10);
  const k4 = new Float64Array(10);
  const series: SeriesPoint[] = [pointFromState(0, y)];
  let peakInfectiousHumans = y[8];
  let peakTime = 0;
  let t = 0;

  for (let i = 1; i <= totalSteps; i += 1) {
    const h = Math.min(step, duration - t);
    derivative(t, y, scenario, k1);
    for (let j = 0; j < 10; j += 1) temp[j] = y[j] + (h * k1[j]) / 2;
    derivative(t + h / 2, temp, scenario, k2);
    for (let j = 0; j < 10; j += 1) temp[j] = y[j] + (h * k2[j]) / 2;
    derivative(t + h / 2, temp, scenario, k3);
    for (let j = 0; j < 10; j += 1) temp[j] = y[j] + h * k3[j];
    derivative(t + h, temp, scenario, k4);
    for (let j = 0; j < 10; j += 1) {
      y[j] += (h * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j])) / 6;
      if (!Number.isFinite(y[j])) {
        throw new Error("数值计算发散，请减小步长后重试。");
      }
    }
    t += h;
    if (y[8] > peakInfectiousHumans) {
      peakInfectiousHumans = y[8];
      peakTime = t;
    }
    if (i % sampleEvery === 0 || i === totalSteps) {
      series.push(pointFromState(t, y));
    }
  }

  return {
    model: "malaria_seir_10_state",
    scenario,
    solver: "fixed_step_rk4",
    duration,
    step,
    computedSteps: totalSteps,
    sampledPoints: series.length,
    summary: {
      peakInfectiousHumans,
      peakTime,
      finalInfectiousHumans: y[8],
      finalRecoveredHumans: y[9],
      finalMosquitoPopulation: y.slice(0, 6).reduce((sum, value) => sum + value, 0),
      finalHumanPopulation: y.slice(6, 10).reduce((sum, value) => sum + value, 0),
    },
    finalState: stateRecord(y),
    series,
  };
}

function rk4Scalar(
  y: number,
  t: number,
  h: number,
  fn: (time: number, value: number) => number,
) {
  const k1 = fn(t, y);
  const k2 = fn(t + h / 2, y + (h * k1) / 2);
  const k3 = fn(t + h / 2, y + (h * k2) / 2);
  const k4 = fn(t + h, y + h * k3);
  return y + (h * (k1 + 2 * k2 + 2 * k3 + k4)) / 6;
}

function range(values: Float64Array): [number, number] {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return [min, max];
}

function profileValue(profile: Float64Array, t: number, period: number) {
  const segments = profile.length - 1;
  const wrapped = t >= period ? period : Math.max(0, t);
  const position = (wrapped / period) * segments;
  const index = Math.min(segments - 1, Math.floor(position));
  const fraction = position - index;
  return profile[index] * (1 - fraction) + profile[index + 1] * fraction;
}

function buildPeriodicProfiles(input: R0Input) {
  const segments = Math.max(60, Math.ceil(input.period / input.integrationStep));
  const h = input.period / segments;
  const r = new Float64Array(segments + 1);
  const a = new Float64Array(segments + 1);
  const cumulativeR = new Float64Array(segments + 1);

  for (let i = 0; i <= segments; i += 1) {
    const t = i * h;
    const bm = 2.5 * baseBeta(t);
    r[i] = bm - dmiAt(t);
    a[i] = bm / input.carryingCapacity;
    if (i > 0) cumulativeR[i] = cumulativeR[i - 1] + (h * (r[i - 1] + r[i])) / 2;
  }

  let integral = 0;
  for (let i = 1; i <= segments; i += 1) {
    const left = a[i - 1] * Math.exp(cumulativeR[i - 1]);
    const right = a[i] * Math.exp(cumulativeR[i]);
    integral += (h * (left + right)) / 2;
  }
  const reciprocalS0 = integral / Math.expm1(cumulativeR[segments]);
  let smi = 1 / reciprocalS0;
  const smiProfile = new Float64Array(segments + 1);
  smiProfile[0] = smi;
  const smiEquation = (time: number, value: number) => {
    const bm = 2.5 * baseBeta(time);
    return bm * (1 - value / input.carryingCapacity) * value - dmiAt(time) * value;
  };
  for (let i = 0; i < segments; i += 1) {
    smi = rk4Scalar(smi, i * h, h, smiEquation);
    smiProfile[i + 1] = smi;
  }

  const integrateFemalePeriod = (start: number) => {
    const profile = new Float64Array(segments + 1);
    profile[0] = start;
    let value = start;
    const equation = (time: number, female: number) => {
      const male = profileValue(smiProfile, time, input.period);
      const total = Math.max(male + female, 1e-12);
      return (
        2.5 *
          baseBeta(time) *
          (1 - male / total - female / input.carryingCapacity) *
          female -
        dmfAt(time) * female
      );
    };
    for (let i = 0; i < segments; i += 1) {
      value = rk4Scalar(value, i * h, h, equation);
      if (!Number.isFinite(value)) {
        throw new Error("周期媒介平衡计算发散，请减小积分步长。");
      }
      profile[i + 1] = value;
    }
    return profile;
  };

  let start = 1e6;
  let previous: Float64Array | null = null;
  let femaleProfile = integrateFemalePeriod(start);
  let endpointError = Number.POSITIVE_INFINITY;
  let profileError = Number.POSITIVE_INFINITY;
  let periodicIterations = 0;
  let periodicConverged = false;

  for (let n = 1; n <= input.maxPeriods; n += 1) {
    femaleProfile = integrateFemalePeriod(start);
    const end = femaleProfile[segments];
    endpointError = Math.abs(end - start) / Math.max(1, Math.abs(start));
    if (previous) {
      let maxDifference = 0;
      let maxCurrent = 1;
      for (let i = 0; i <= segments; i += 1) {
        maxDifference = Math.max(maxDifference, Math.abs(femaleProfile[i] - previous[i]));
        maxCurrent = Math.max(maxCurrent, Math.abs(femaleProfile[i]));
      }
      profileError = maxDifference / maxCurrent;
    }
    periodicIterations = n;
    if (endpointError < input.tolerance && profileError < input.tolerance) {
      periodicConverged = true;
      break;
    }
    previous = femaleProfile;
    start = end;
  }

  return {
    smiProfile,
    smfProfile: femaleProfile,
    segments,
    h,
    endpointError,
    periodicIterations,
    periodicConverged,
  };
}

function fillSystemMatrix(
  out: Float64Array,
  t: number,
  lambda: number,
  profiles: ReturnType<typeof buildPeriodicProfiles>,
  input: R0Input,
) {
  out.fill(0);
  const betaM = 0.48 * baseBeta(t);
  const betaHf = (0.022 / 0.48) * betaM;
  const betaHi = input.infectiousMaleFactor * betaHf;
  const eBmi = 2.523;
  const eBmf = 0.9 * eBmi;
  const theta = 3.04;
  const humanSusceptible = input.humanRecruitment / input.naturalHumanMortality;
  const smi = profileValue(profiles.smiProfile, t, input.period);
  const smf = profileValue(profiles.smfProfile, t, input.period);

  out[0] = -(dmiAt(t) + eBmi);
  out[5] = (betaM * smi) / (humanSusceptible * lambda);
  out[7] = -(dmfAt(t) + eBmf);
  out[11] = (betaM * smf) / (humanSusceptible * lambda);
  out[12] = eBmi;
  out[14] = -dmiAt(t);
  out[19] = eBmf;
  out[21] = -dmfAt(t);
  out[26] = betaHi / lambda;
  out[27] = betaHf / lambda;
  out[28] = -(theta + input.naturalHumanMortality);
  out[34] = theta;
  out[35] = -(
    input.naturalHumanMortality +
    input.recoveryRate +
    input.diseaseMortality
  );
}

function multiply6x6(a: Float64Array, b: Float64Array, out: Float64Array) {
  for (let row = 0; row < 6; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      let sum = 0;
      for (let k = 0; k < 6; k += 1) sum += a[row * 6 + k] * b[k * 6 + col];
      out[row * 6 + col] = sum;
    }
  }
}

function spectralRadius(
  lambda: number,
  profiles: ReturnType<typeof buildPeriodicProfiles>,
  input: R0Input,
) {
  if (!(lambda > 0)) return Number.POSITIVE_INFINITY;
  const W = new Float64Array(36);
  for (let i = 0; i < 6; i += 1) W[i * 6 + i] = 1;
  const temp = new Float64Array(36);
  const a = new Float64Array(36);
  const k1 = new Float64Array(36);
  const k2 = new Float64Array(36);
  const k3 = new Float64Array(36);
  const k4 = new Float64Array(36);
  const steps = profiles.segments;
  const h = input.period / steps;

  for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
    const t = stepIndex * h;
    fillSystemMatrix(a, t, lambda, profiles, input);
    multiply6x6(a, W, k1);
    for (let i = 0; i < 36; i += 1) temp[i] = W[i] + (h * k1[i]) / 2;
    fillSystemMatrix(a, t + h / 2, lambda, profiles, input);
    multiply6x6(a, temp, k2);
    for (let i = 0; i < 36; i += 1) temp[i] = W[i] + (h * k2[i]) / 2;
    multiply6x6(a, temp, k3);
    for (let i = 0; i < 36; i += 1) temp[i] = W[i] + h * k3[i];
    fillSystemMatrix(a, t + h, lambda, profiles, input);
    multiply6x6(a, temp, k4);
    for (let i = 0; i < 36; i += 1) {
      W[i] += (h * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i])) / 6;
      if (!Number.isFinite(W[i])) return Number.POSITIVE_INFINITY;
    }
  }

  let vector = new Float64Array(6).fill(1 / 6);
  let eigenvalue = 0;
  for (let iteration = 0; iteration < 250; iteration += 1) {
    const next = new Float64Array(6);
    for (let row = 0; row < 6; row += 1) {
      for (let col = 0; col < 6; col += 1) next[row] += W[row * 6 + col] * vector[col];
    }
    const norm = Math.max(...Array.from(next, (value) => Math.abs(value)));
    if (!Number.isFinite(norm)) return Number.POSITIVE_INFINITY;
    if (norm === 0) return 0;
    for (let i = 0; i < 6; i += 1) next[i] /= norm;
    if (Math.abs(norm - eigenvalue) < 1e-10 * Math.max(1, norm)) {
      eigenvalue = norm;
      break;
    }
    eigenvalue = norm;
    vector = next;
  }
  return eigenvalue;
}

export function computeR0(input: R0Input): R0Result {
  if (
    input.period <= 0 ||
    input.carryingCapacity <= 0 ||
    input.humanRecruitment <= 0 ||
    input.naturalHumanMortality <= 0 ||
    input.integrationStep <= 0 ||
    input.tolerance <= 0 ||
    input.maxPeriods < 2
  ) {
    throw new Error("R₀ 参数必须为有效正数。");
  }

  const profiles = buildPeriodicProfiles(input);
  let low = 0.025;
  let high = 4;
  let rhoLow = spectralRadius(low, profiles, input);
  let rhoHigh = spectralRadius(high, profiles, input);
  while (rhoLow < 1 && low > 1e-5) {
    low /= 2;
    rhoLow = spectralRadius(low, profiles, input);
  }
  while (rhoHigh > 1 && high < 256) {
    high *= 2;
    rhoHigh = spectralRadius(high, profiles, input);
  }
  if (!(rhoLow >= 1 && rhoHigh <= 1)) {
    throw new Error("未能找到 R₀ 根区间，请检查参数或减小积分步长。");
  }

  let midpoint = (low + high) / 2;
  let rhoMidpoint = spectralRadius(midpoint, profiles, input);
  let iterations = 0;
  let converged = false;
  for (let i = 1; i <= 60; i += 1) {
    iterations = i;
    midpoint = (low + high) / 2;
    rhoMidpoint = spectralRadius(midpoint, profiles, input);
    if (
      Math.abs(rhoMidpoint - 1) < input.tolerance ||
      (high - low) / Math.max(1, midpoint) < input.tolerance
    ) {
      converged = true;
      break;
    }
    if (rhoMidpoint > 1) low = midpoint;
    else high = midpoint;
  }

  return {
    model: "periodic_next_generation_operator",
    scenario: input.scenario,
    R0: midpoint,
    threshold:
      Math.abs(midpoint - 1) < 1e-4
        ? "equal_one"
        : midpoint > 1
          ? "above_one"
          : "below_one",
    converged,
    rootIterations: iterations,
    periodicMosquitoIterations: profiles.periodicIterations,
    periodicMosquitoConverged: profiles.periodicConverged,
    periodicEndpointError: profiles.endpointError,
    susceptibleMaleRange: range(profiles.smiProfile),
    susceptibleFemaleRange: range(profiles.smfProfile),
    parameters: input,
  };
}
