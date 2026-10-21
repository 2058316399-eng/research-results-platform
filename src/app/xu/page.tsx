"use client";

import { SiteLink as Link } from "../../static/navigation";
import Image from "next/image";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  matrixToText,
  NETWORK_PRESETS,
  parseAdjacency,
  runCommunityDetection,
  type CommunityAlgorithm,
  type CommunityOptions,
  type CommunityResult,
  type Matrix,
} from "../community-models";
import {
  DEFAULT_SIQH_INITIAL,
  DEFAULT_SIQH_PARAMETERS,
  JAPAN_WEEKLY_DATA,
  peakOf,
  simulateDelayedSIQH,
  type SIQHControls,
  type SIQHInitial,
  type SIQHParameters,
  type SIQHSimulation,
} from "../delayed-siqh-model";
import {
  analyzeSVIR,
  DEFAULT_SIR_PARAMETERS,
  DEFAULT_SVIR_INITIAL,
  extinctionTime,
  INDIA_WEEKLY_DATA,
  parseObservationCsv,
  quickFitIndia,
  runStabilityEnsemble,
  simulateStochasticSIR,
  simulateSVIR,
  sirReproductionNumber,
  SVIR_PRESETS,
  type Observation,
  type SIRInitial,
  type SIRParameters,
  type SIRSimulation,
  type SVIRParameters,
  type SVIRSimulation,
  type SVIRState,
} from "../xu-models";

type ModuleKey = "svir" | "sir" | "roasnmf" | "masnmf" | "siqh";
type FitResult = ReturnType<typeof quickFitIndia>;
type StabilityResult = ReturnType<typeof runStabilityEnsemble>;

type ReferenceData = { input: string; output: string; hasResult: boolean; error: string };
const ReferenceContext = createContext<((data: ReferenceData) => void) | null>(null);

function useReferenceData(input: unknown, output: unknown, hasResult: boolean, error = "") {
  const publish = useContext(ReferenceContext);
  const inputText = JSON.stringify(input, null, 2);
  const outputText = JSON.stringify(output, null, 2);
  useEffect(() => {
    publish?.({ input: inputText, output: outputText, hasResult, error });
  }, [publish, inputText, outputText, hasResult, error]);
}

type ChartSeries = {
  label: string;
  values: number[];
  times?: number[];
  color: string;
  dashed?: boolean;
  points?: boolean;
  width?: number;
};

const STATE_META = [
  { key: "S", label: "易感 S", color: "#1f7a73" },
  { key: "V", label: "接种 V", color: "#4472a8" },
  { key: "I₁", label: "原始株 I₁", color: "#c45b3c" },
  { key: "I₂", label: "新毒株 I₂", color: "#9e3c62" },
  { key: "R₁", label: "康复 R₁", color: "#7a6fb0" },
  { key: "R₂", label: "康复 R₂", color: "#d39a32" },
] as const;

const SVIR_FIELDS: Array<{ key: keyof SVIRParameters; label: string; note: string; step: number }> = [
  { key: "Lambda", label: "Λ 招募率", note: "进入易感仓室的速率", step: 0.01 },
  { key: "alpha", label: "α 分数阶", note: "疫苗保护的记忆阶数", step: 0.01 },
  { key: "beta1", label: "β₁", note: "原始株对易感者传播率", step: 0.01 },
  { key: "beta2", label: "β₂", note: "新株对 S / R₁ 传播率", step: 0.01 },
  { key: "beta3", label: "β₃", note: "新株对接种者传播率", step: 0.01 },
  { key: "omega", label: "ω 失效率", note: "长期疫苗保护衰减系数", step: 0.001 },
  { key: "mu", label: "μ 自然离开率", note: "六个仓室共同离开率", step: 0.01 },
  { key: "xi", label: "ξ 接种率", note: "S → V 的接种速率", step: 0.01 },
  { key: "gamma1", label: "γ₁", note: "原始株康复率", step: 0.01 },
  { key: "gamma2", label: "γ₂", note: "新株康复率", step: 0.01 },
];

const SIR_FIELDS: Array<{ key: keyof SIRParameters; label: string; note: string; step: number }> = [
  { key: "Lambda", label: "Λ 招募率", note: "进入易感仓室的速率", step: 0.1 },
  { key: "alpha", label: "α Caputo 阶数", note: "范围 (0, 1]", step: 0.05 },
  { key: "beta", label: "β 传播率", note: "基础传播强度", step: 0.1 },
  { key: "mu", label: "μ 自然离开率", note: "人群自然离开率", step: 0.1 },
  { key: "gamma", label: "γ 康复率", note: "感染者康复速率", step: 0.1 },
  { key: "sigma", label: "σ 噪声强度", note: "0 表示关闭随机扰动", step: 0.1 },
];

const SIQH_RATE_FIELDS: Array<{ key: keyof SIQHParameters; label: string; note: string; step: number }> = [
  { key: "beta", label: "β 传播率", note: "S 与时滞 I 的接触传播", step: 0.01 },
  { key: "eta", label: "η 保护退出率", note: "H → S 的自然回流", step: 0.00001 },
  { key: "rho", label: "ρ 保护率", note: "S → H 的基础保护", step: 0.001 },
  { key: "delta", label: "δ 隔离率", note: "I → Q 的基础隔离", step: 0.001 },
  { key: "r1", label: "r₁ 康复率", note: "感染者康复并进入 H", step: 0.001 },
  { key: "d1", label: "d₁ 死亡率", note: "感染者疾病死亡率", step: 0.0001 },
  { key: "r2", label: "r₂ 隔离康复率", note: "Q → H / Rc", step: 0.001 },
  { key: "d2", label: "d₂ 隔离死亡率", note: "Q → Dc", step: 0.00001 },
  { key: "mu", label: "μ 自然离开率", note: "默认寿命 85 年", step: 0.000001 },
];

const SIQH_SOURCE_FIGURES = {
  fitting: {
    label: "参数拟合（Fig. 2）",
    note: "JHU 日本累计确诊与当前隔离数据对照",
    images: [
      { src: "/siqh/Fig2a_confirmed.png", alt: "累计确诊拟合图" },
      { src: "/siqh/Fig2b_isolated.png", alt: "当前隔离拟合图" },
    ],
  },
  delay: {
    label: "时滞效应（Fig. 4）",
    note: "τ = 0–5 天时感染者与隔离者轨迹",
    images: [
      { src: "/siqh/Fig4a_I_tau.png", alt: "感染者潜伏期对比图" },
      { src: "/siqh/Fig4b_Q_tau.png", alt: "隔离者潜伏期对比图" },
    ],
  },
  effect: {
    label: "控制效果（Fig. 5）",
    note: "无控制、单一控制与联合控制的状态比较",
    images: [
      { src: "/siqh/Fig5b_I.png", alt: "不同控制策略下感染者曲线" },
      { src: "/siqh/Fig5c_Q.png", alt: "不同控制策略下隔离者曲线" },
    ],
  },
  optimal: {
    label: "最优控制（Fig. 6）",
    note: "原 FBSM 缓存结果；完整重算约需 5–30 分钟",
    images: [
      { src: "/siqh/Fig6a_u1.png", alt: "策略 A 最优保护控制" },
      { src: "/siqh/Fig6b_u2.png", alt: "策略 B 最优检测隔离控制" },
      { src: "/siqh/Fig6c_u1u2.png", alt: "策略 C 联合最优控制" },
    ],
  },
} as const;

function formatNumber(value: number | null, digits = 4) {
  if (value === null || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1e6) return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 2 }).format(value);
  if (Math.abs(value) > 0 && Math.abs(value) < 0.001) return value.toExponential(3);
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(value);
}

function ModelChart({
  title,
  subtitle,
  times,
  series,
  emptyText = "运行模型后显示曲线",
}: {
  title: string;
  subtitle: string;
  times: number[];
  series: ChartSeries[];
  emptyText?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || times.length < 2 || series.length === 0) return;
    const draw = () => {
      const context = canvas.getContext("2d");
      if (!context) return;
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const width = rect.width;
      const height = rect.height;
      const margin = { left: 58, right: 18, top: 18, bottom: 38 };
      const plotWidth = width - margin.left - margin.right;
      const plotHeight = height - margin.top - margin.bottom;
      context.clearRect(0, 0, width, height);
      const allTimes = series.flatMap((item) => item.times ?? times);
      const allValues = series.flatMap((item) => item.values).filter(Number.isFinite);
      if (!allValues.length) return;
      const xMin = Math.min(...allTimes);
      const xMax = Math.max(...allTimes);
      let yMin = Math.min(...allValues);
      let yMax = Math.max(...allValues);
      if (yMin >= 0) yMin = 0;
      if (yMax === yMin) yMax = yMin + 1;
      yMax += (yMax - yMin) * 0.08;
      const x = (value: number) => margin.left + ((value - xMin) / Math.max(xMax - xMin, 1e-12)) * plotWidth;
      const y = (value: number) => margin.top + (1 - (value - yMin) / (yMax - yMin)) * plotHeight;

      context.strokeStyle = "#dfe8e6";
      context.lineWidth = 1;
      context.fillStyle = "#728287";
      context.font = '11px Inter, "Microsoft YaHei", sans-serif';
      for (let tick = 0; tick <= 4; tick += 1) {
        const yValue = yMin + ((yMax - yMin) * tick) / 4;
        const yPosition = y(yValue);
        context.beginPath();
        context.moveTo(margin.left, yPosition);
        context.lineTo(width - margin.right, yPosition);
        context.stroke();
        context.textAlign = "right";
        context.fillText(formatNumber(yValue, 2), margin.left - 8, yPosition + 4);
      }
      for (let tick = 0; tick <= 4; tick += 1) {
        const xValue = xMin + ((xMax - xMin) * tick) / 4;
        context.textAlign = tick === 0 ? "left" : tick === 4 ? "right" : "center";
        context.fillText(formatNumber(xValue, 1), x(xValue), height - 12);
      }

      series.forEach((item) => {
        const itemTimes = item.times ?? times;
        context.strokeStyle = item.color;
        context.fillStyle = item.color;
        context.lineWidth = item.width ?? 2;
        context.setLineDash(item.dashed ? [6, 5] : []);
        if (!item.points) {
          context.beginPath();
          item.values.forEach((value, index) => {
            const xPosition = x(itemTimes[index] ?? times[index] ?? 0);
            const yPosition = y(value);
            if (index === 0) context.moveTo(xPosition, yPosition);
            else context.lineTo(xPosition, yPosition);
          });
          context.stroke();
        }
        if (item.points) {
          item.values.forEach((value, index) => {
            context.beginPath();
            context.arc(x(itemTimes[index] ?? 0), y(value), 2.6, 0, Math.PI * 2);
            context.fill();
          });
        }
      });
      context.setLineDash([]);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [series, times]);

  return (
    <article className="xu-chart-card">
      <div className="xu-chart-heading">
        <div><strong>{title}</strong><span>{subtitle}</span></div>
        <span>t</span>
      </div>
      {times.length >= 2 && series.length ? <canvas ref={canvasRef} /> : <div className="xu-chart-empty">{emptyText}</div>}
      <div className="xu-legend">
        {series.map((item) => <span key={item.label}><i style={{ background: item.color }} />{item.label}</span>)}
      </div>
    </article>
  );
}

function NumericField({ label, note, value, step, onChange }: { label: string; note: string; value: number; step: number; onChange: (value: number) => void }) {
  return (
    <label className="xu-field">
      <span><strong>{label}</strong><small>{note}</small></span>
      <input aria-label={label} type="number" value={value} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function LoadingButton({ busy, children, onClick }: { busy: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" className="run-button xu-run" disabled={busy} onClick={onClick}><span>{busy ? "计算中…" : children}</span><b>→</b></button>;
}

function SVIRModule() {
  const [preset, setPreset] = useState("fig5");
  const [parameters, setParameters] = useState<SVIRParameters>({ ...SVIR_PRESETS.fig5.parameters });
  const [initial, setInitial] = useState<SVIRState>([...DEFAULT_SVIR_INITIAL]);
  const [duration, setDuration] = useState(80);
  const [dt, setDt] = useState(0.2);
  const [simulation, setSimulation] = useState<SVIRSimulation | null>(null);
  const [withoutVaccine, setWithoutVaccine] = useState<SVIRSimulation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fitBusy, setFitBusy] = useState(false);
  const [fitError, setFitError] = useState("");
  const [fitResult, setFitResult] = useState<FitResult | null>(null);
  const [customData, setCustomData] = useState("");
  const analysis = useMemo(() => analyzeSVIR(parameters, 1), [parameters]);
  const completedInput = useRef<unknown>(null);
  const completedAnalysis = useRef<ReturnType<typeof analyzeSVIR> | null>(null);
  useReferenceData(
    { model: "fractional_two_strain_SVIR", preset, parameters, initial, tEnd: duration, dt, incidenceScale: 1, fitting: { columns: ["day", "active", "recovered"], observations: customData.trim() || INDIA_WEEKLY_DATA } },
    { status: simulation || fitResult ? "completed" : "not_run", simulationInput: completedInput.current, stateOrder: ["S", "V", "I1", "I2", "R1", "R2"], simulation, withoutVaccine, analysis: completedAnalysis.current, fitting: fitResult },
    Boolean(simulation || fitResult), error || fitError,
  );

  const applyPreset = (key: string) => {
    setPreset(key);
    setParameters({ ...SVIR_PRESETS[key].parameters });
    completedInput.current = null;
    completedAnalysis.current = null;
    setSimulation(null);
    setWithoutVaccine(null);
  };

  const run = () => {
    setBusy(true);
    setError("");
    window.setTimeout(() => {
      try {
        const result = simulateSVIR({ parameters, initial, tEnd: duration, dt, incidenceScale: 1 });
        const control = simulateSVIR({ parameters: { ...parameters, xi: 0 }, initial: [initial[0] + initial[1], 0, initial[2], initial[3], initial[4], initial[5]], tEnd: duration, dt, incidenceScale: 1 });
        completedInput.current = { parameters: { ...parameters }, initial: [...initial], tEnd: duration, dt, incidenceScale: 1 };
        completedAnalysis.current = analyzeSVIR(parameters, 1);
        setSimulation(result);
        setWithoutVaccine(control);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "计算失败，请检查参数。");
      } finally {
        setBusy(false);
      }
    }, 20);
  };

  const runFit = () => {
    setFitBusy(true);
    setFitError("");
    window.setTimeout(() => {
      try {
        const observations: Observation[] = customData.trim() ? parseObservationCsv(customData) : INDIA_WEEKLY_DATA;
        setFitResult(quickFitIndia(observations));
      } catch (reason) {
        setFitError(reason instanceof Error ? reason.message : "拟合失败，请检查数据格式。");
      } finally {
        setFitBusy(false);
      }
    }, 20);
  };

  const stateSeries = simulation ? STATE_META.map((meta, index) => ({ label: meta.label, color: meta.color, values: simulation.states.map((state) => state[index]) })) : [];
  const vaccineSeries: ChartSeries[] = simulation && withoutVaccine ? [
    { label: "有疫苗 I₁", color: "#c45b3c", values: simulation.states.map((state) => state[2]) },
    { label: "有疫苗 I₂", color: "#9e3c62", values: simulation.states.map((state) => state[3]) },
    { label: "无疫苗 I₁", color: "#d79c86", dashed: true, values: withoutVaccine.states.map((state) => state[2]) },
    { label: "无疫苗 I₂", color: "#b991a4", dashed: true, values: withoutVaccine.states.map((state) => state[3]) },
  ] : [];
  const fitSeries: ChartSeries[] = fitResult ? [
    { label: "模型活动感染", color: "#b7433e", values: fitResult.simulation.states.map((state) => state[2] + state[3]) },
    { label: "报告活动感染", color: "#e08754", points: true, values: fitResult.observations.map((row) => row.active), times: fitResult.observations.map((row) => row.day) },
    { label: "模型累计康复", color: "#337a74", values: fitResult.simulation.states.map((state) => state[4] + state[5]) },
    { label: "报告累计康复", color: "#78a9a4", points: true, values: fitResult.observations.map((row) => row.recovered), times: fitResult.observations.map((row) => row.day) },
  ] : [];

  return (
    <div className="xu-module-body">
      <div className="xu-module-heading">
        <div><span>XU ET AL. · FRACTIONAL SVIR</span><h2>分数阶双毒株 SVIR</h2></div>
        <p>疫苗对原始株完全保护，但接种者仍可感染新株；疫苗失效采用带自然离开率调制的 Riemann–Liouville 记忆项。</p>
      </div>

      <div className="xu-workbench">
        <aside className="xu-parameters">
          <div className="xu-card-head"><div><span>INPUT</span><h3>模型参数</h3></div><small>{Math.round(duration / dt)} 步</small></div>
          <label className="xu-select-label"><span>论文预设</span><select value={preset} onChange={(event) => applyPreset(event.target.value)}>{Object.entries(SVIR_PRESETS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
          <div className="xu-field-grid">
            {SVIR_FIELDS.map((field) => <NumericField key={field.key} label={field.label} note={field.note} step={field.step} value={parameters[field.key]} onChange={(value) => setParameters((current) => ({ ...current, [field.key]: value }))} />)}
          </div>
          <div className="xu-subhead"><strong>初始状态</strong><span>S, V, I₁, I₂, R₁, R₂</span></div>
          <div className="xu-initial-grid">
            {STATE_META.map((meta, index) => <label key={meta.key}><span>{meta.key}</span><input type="number" step="0.01" value={initial[index]} onChange={(event) => setInitial((current) => current.map((value, stateIndex) => stateIndex === index ? Number(event.target.value) : value) as SVIRState)} /></label>)}
          </div>
          <div className="xu-time-grid">
            <NumericField label="终止时间" note="模型时间" step={10} value={duration} onChange={setDuration} />
            <NumericField label="步长 Δt" note="自动修正整步数" step={0.05} value={dt} onChange={setDt} />
          </div>
          <LoadingButton busy={busy} onClick={run}>运行 SVIR 与疫苗对比</LoadingButton>
          {error && <p className="error-message">{error}</p>}
          <p className="xu-method-note">求解器：带温度调制的 Grünwald–Letnikov 卷积 + Heun 两次预测校正；完整保留 V 的历史。</p>
        </aside>

        <section className="xu-results">
          <div className="xu-status-row">
            <article><span>当前情景</span><strong>{analysis.scenario}</strong><small>对应 {analysis.selectedEquilibrium}</small></article>
            <article><span>R₀（总阈值）</span><strong>{formatNumber(analysis.R0)}</strong><small>{analysis.R0 < 1 ? "低于 1" : "高于 1"}</small></article>
            <article><span>数值步数</span><strong>{simulation?.steps ?? "—"}</strong><small>分数阶数值积分</small></article>
            <article><span>质量平衡误差</span><strong>{formatNumber(simulation?.maxMassError ?? null, 3)}</strong><small>绝对最大值</small></article>
          </div>
          <ModelChart title="六仓室时间序列" subtitle="S / V / I₁ / I₂ / R₁ / R₂" times={simulation?.times ?? []} series={stateSeries} />
          <ModelChart title="疫苗差异化保护" subtitle={`有疫苗 ξ=${formatNumber(parameters.xi)}；对照 ξ=0`} times={simulation?.times ?? []} series={vaccineSeries} />
        </section>
      </div>

      <div className="xu-analysis-grid">
        <article className="xu-analysis-card xu-wide-card">
          <div className="xu-card-head"><div><span>4.2</span><h3>四种平衡态与毒株判别</h3></div><small>自动更新</small></div>
          <div className="xu-thresholds">
            {[{ key: "R₀", value: analysis.R0, note: "总传播阈值" }, { key: "R₁", value: analysis.R1, note: "原始株入侵" }, { key: "R₂", value: analysis.R2, note: "新株入侵" }, { key: "R₃", value: analysis.R3, note: "新株侵入 E₁" }].map((item) => <div key={item.key}><span>{item.key}</span><strong>{formatNumber(item.value)}</strong><small>{item.note}</small></div>)}
          </div>
          <div className="xu-table-wrap"><table className="xu-equilibrium-table"><thead><tr><th>平衡态</th>{STATE_META.map((state) => <th key={state.key}>{state.key}</th>)}</tr></thead><tbody>{analysis.equilibria.map((equilibrium) => <tr key={equilibrium.key} className={analysis.selectedEquilibrium === equilibrium.key ? "is-selected" : ""}><th><strong>{equilibrium.key}</strong><span>{equilibrium.name}</span></th>{equilibrium.values.map((value, index) => <td key={STATE_META[index].key}>{formatNumber(value)}</td>)}</tr>)}</tbody></table></div>
          <p className="xu-method-note">E₂ / Eₑ 采用稳态方程区间求根；若当前参数下不存在非负解，以“—”表示。</p>
        </article>

        <article className="xu-analysis-card">
          <div className="xu-card-head"><div><span>4.3</span><h3>R₀ 归一化敏感性</h3></div><small>参数 ±10%</small></div>
          <div className="xu-sensitivity-list">{analysis.sensitivities.map((item) => <div key={item.parameter}><span>{item.parameter}<small>A = {formatNumber(item.index)}</small></span><div><i className={item.index < 0 ? "negative" : "positive"} style={{ width: `${Math.min(100, Math.abs(item.index) * 58)}%` }} /></div><strong>{item.tenPercentEffect > 0 ? "+" : ""}{formatNumber(item.tenPercentEffect, 2)}%</strong></div>)}</div>
          <p className="xu-method-note">采用需求文档给出的解析结果：Aβ=1、AΛ=1、Aγ=−γ/(γ+μ)、Aμ=−1−μ/(γ+μ)。</p>
        </article>

        <article className="xu-analysis-card xu-fit-card">
          <div className="xu-card-head"><div><span>DATA FIT</span><h3>疫情数据快速拟合</h3></div><small>最小二乘</small></div>
          <p>默认使用 2020-09-07 至 2021-02-22 的印度 JHU 周采样数据。也可粘贴自己的三列数据。</p>
          <details><summary>输入自有数据（可选）</summary><textarea value={customData} onChange={(event) => setCustomData(event.target.value)} placeholder={"day,active,recovered\n0,883697,3323950\n7,990061,3859399\n14,975861,4497867"} /></details>
          <LoadingButton busy={fitBusy} onClick={runFit}>{customData.trim() ? "拟合输入数据" : "拟合内置印度样例"}</LoadingButton>
          {fitError && <p className="error-message">{fitError}</p>}
          {fitResult && <div className="xu-fit-summary"><span>归一化 RMSE <strong>{formatNumber(fitResult.score, 5)}</strong></span><span>β 缩放后 <strong>{formatNumber(fitResult.parameters.beta1)}</strong></span><span>γ₁ <strong>{formatNumber(fitResult.parameters.gamma1)}</strong></span></div>}
        </article>
      </div>
      <ModelChart title="印度数据与拟合曲线" subtitle="活动感染 + 累计康复；散点为报告值" times={fitResult?.simulation.times ?? []} series={fitSeries} emptyText="点击“拟合内置印度样例”后显示" />
    </div>
  );
}

function SIRModule() {
  const [parameters, setParameters] = useState<SIRParameters>({ ...DEFAULT_SIR_PARAMETERS });
  const [initial, setInitial] = useState<SIRInitial>([0.65, 0.25, 0.1]);
  const [duration, setDuration] = useState(30);
  const [dt, setDt] = useState(0.05);
  const [seed, setSeed] = useState(2025);
  const [pathCount, setPathCount] = useState(10);
  const [single, setSingle] = useState<SIRSimulation | null>(null);
  const [deterministic, setDeterministic] = useState<SIRSimulation | null>(null);
  const [multiNoise, setMultiNoise] = useState<Array<{ sigma: number; simulation: SIRSimulation; extinction: number | null }>>([]);
  const [stability, setStability] = useState<StabilityResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reproduction = sirReproductionNumber(parameters);
  const completedInput = useRef<unknown>(null);
  useReferenceData(
    { model: "stochastic_fractional_SIR", parameters, initial, tEnd: duration, dt, seed, pathCount, noiseComparison: [0.1, 0.5, 1, 2], ensembleDt: Math.max(dt, duration / 700) },
    { status: single ? "completed" : "not_run", calculationInput: completedInput.current, stateOrder: ["S", "I", "R"], single, deterministic, multiNoise, stability },
    Boolean(single), error,
  );

  const run = () => {
    setBusy(true);
    setError("");
    window.setTimeout(() => {
      try {
        const safeDt = Math.max(dt, duration / 700);
        const onePath = simulateStochasticSIR(parameters, initial, duration, dt, seed);
        const noNoise = simulateStochasticSIR({ ...parameters, sigma: 0 }, initial, duration, dt, seed);
        const comparisons = [0.1, 0.5, 1, 2].map((sigma) => {
          const simulation = simulateStochasticSIR({ ...parameters, sigma }, initial, duration, safeDt, seed);
          return { sigma, simulation, extinction: extinctionTime(simulation) };
        });
        const ensemble = runStabilityEnsemble(parameters, initial, duration, safeDt, pathCount, seed);
        completedInput.current = { parameters: { ...parameters }, initial: [...initial], tEnd: duration, dt, seed, pathCount, ensembleDt: safeDt, R0: sirReproductionNumber(parameters) };
        setSingle(onePath);
        setDeterministic(noNoise);
        setMultiNoise(comparisons);
        setStability(ensemble);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "计算失败，请检查参数。");
      } finally {
        setBusy(false);
      }
    }, 20);
  };

  const singleSeries: ChartSeries[] = single ? [
    { label: "S(t)", color: "#1f7a73", values: single.states.map((state) => state[0]) },
    { label: "I(t)", color: "#b7433e", values: single.states.map((state) => state[1]) },
    { label: "R(t)", color: "#6f64a6", values: single.states.map((state) => state[2]) },
  ] : [];
  const comparisonSeries: ChartSeries[] = single && deterministic ? [
    { label: `随机 σ=${parameters.sigma}`, color: "#b7433e", values: single.states.map((state) => state[1]) },
    { label: "无噪声 σ=0", color: "#1f7a73", dashed: true, values: deterministic.states.map((state) => state[1]) },
  ] : [];
  const noiseColors = ["#2a7a74", "#d08a35", "#b7433e", "#714f83"];
  const multiSeries: ChartSeries[] = multiNoise.map((item, index) => ({ label: `σ=${item.sigma}`, color: noiseColors[index], values: item.simulation.states.map((state) => state[1]), times: item.simulation.times }));
  const stabilitySeries: ChartSeries[] = stability ? [
    ...stability.paths.slice(0, 5).map((path, index) => ({ label: `路径 ${index + 1}`, color: ["#c8d7d5", "#d8cbbd", "#d7c6cc", "#c5cadc", "#d4d1ba"][index], width: 1, values: path.states.map((state) => state[1]) })),
    { label: "路径均值 E[I]", color: "#b7433e", width: 3, values: stability.meanStates.map((state) => state[1]) },
  ] : [];

  return (
    <div className="xu-module-body">
      <div className="xu-module-heading">
        <div><span>XU ET AL. · STOCHASTIC SIR</span><h2>随机扰动分数阶 SIR</h2></div>
        <p>Caputo 分数阶系统在 β 上叠加乘性随机扰动，使用固定种子可复现实验；同时计算多噪声情景和均方收敛。</p>
      </div>

      <div className="xu-workbench">
        <aside className="xu-parameters">
          <div className="xu-card-head"><div><span>INPUT</span><h3>模型参数</h3></div><small>{Math.round(duration / dt)} 步</small></div>
          <div className="xu-field-grid">{SIR_FIELDS.map((field) => <NumericField key={field.key} label={field.label} note={field.note} step={field.step} value={parameters[field.key]} onChange={(value) => setParameters((current) => ({ ...current, [field.key]: value }))} />)}</div>
          <div className="xu-subhead"><strong>初始状态与实验控制</strong><span>同一随机种子可复现</span></div>
          <div className="xu-initial-grid sir-initial-grid">{["S₀", "I₀", "R₀"].map((label, index) => <label key={label}><span>{label}</span><input type="number" step="0.05" value={initial[index]} onChange={(event) => setInitial((current) => current.map((value, stateIndex) => stateIndex === index ? Number(event.target.value) : value) as SIRInitial)} /></label>)}</div>
          <div className="xu-time-grid">
            <NumericField label="终止时间" note="模型时间" step={5} value={duration} onChange={setDuration} />
            <NumericField label="步长 Δt" note="建议 0.02–0.1" step={0.01} value={dt} onChange={setDt} />
            <NumericField label="随机种子" note="结果可重复" step={1} value={seed} onChange={setSeed} />
            <NumericField label="路径数" note="3–20 条" step={1} value={pathCount} onChange={setPathCount} />
          </div>
          <LoadingButton busy={busy} onClick={run}>运行随机模拟与稳定性验证</LoadingButton>
          {error && <p className="error-message">{error}</p>}
          <p className="xu-method-note">与随附 MATLAB 程序一致：先生成标准化高斯序列，再代入分数阶预测—校正格式；网页增加了非负保护。</p>
        </aside>

        <section className="xu-results">
          <div className="xu-status-row">
            <article><span>结构阈值 R₀</span><strong>{formatNumber(reproduction)}</strong><small>{reproduction < 1 ? "预测趋向无病平衡" : "预测趋向地方病平衡"}</small></article>
            <article><span>噪声状态</span><strong>{parameters.sigma === 0 ? "关闭" : "开启"}</strong><small>σ = {formatNumber(parameters.sigma)}</small></article>
            <article><span>随机种子</span><strong>{single?.seed ?? seed}</strong><small>复现实验标识</small></article>
            <article><span>均方末值</span><strong>{formatNumber(stability?.meanSquareDistance.at(-1) ?? null)}</strong><small>距目标平衡态</small></article>
          </div>
          <ModelChart title="单次随机路径" subtitle="S(t) / I(t) / R(t)" times={single?.times ?? []} series={singleSeries} />
          <ModelChart title="有 / 无噪声感染曲线" subtitle="保持其余参数和随机种子一致" times={single?.times ?? []} series={comparisonSeries} />
        </section>
      </div>

      <div className="xu-analysis-grid sir-analysis-grid">
        <article className="xu-analysis-card xu-wide-card">
          <div className="xu-card-head"><div><span>5.2</span><h3>多噪声强度与消亡时间</h3></div><small>σ = 0.1 / 0.5 / 1 / 2</small></div>
          <ModelChart title="感染仓室 I(t) 叠加" subtitle="相同初值、时间和随机种子" times={multiNoise[0]?.simulation.times ?? []} series={multiSeries} />
          <div className="xu-table-wrap"><table className="xu-simple-table"><thead><tr><th>噪声 σ</th><th>峰值 I</th><th>末值 I</th><th>消亡时间</th></tr></thead><tbody>{multiNoise.length ? multiNoise.map((item) => <tr key={item.sigma}><td>{item.sigma}</td><td>{formatNumber(Math.max(...item.simulation.states.map((state) => state[1])))}</td><td>{formatNumber(item.simulation.states.at(-1)?.[1] ?? null)}</td><td>{item.extinction === null ? "未消亡" : `t=${formatNumber(item.extinction, 2)}`}</td></tr>) : <tr><td colSpan={4}>运行后生成对比表</td></tr>}</tbody></table></div>
          <p className="xu-method-note">“消亡”定义为 I 连续 10 个计算步低于 10⁻³；它是本演示的数值判据，不等同于临床判定。</p>
        </article>

        <article className="xu-analysis-card">
          <div className="xu-card-head"><div><span>5.3</span><h3>均方稳定性验证</h3></div><small>{Math.max(3, Math.min(20, Math.round(pathCount)))} 条路径</small></div>
          <div className={`xu-verdict ${reproduction < 1 ? "safe" : "endemic"}`}><span>{reproduction < 1 ? "R₀ < 1" : "R₀ > 1"}</span><strong>{reproduction < 1 ? "验证无病平衡收敛" : "验证地方病平衡收敛"}</strong><p>目标：{stability ? `(${stability.target.map((value) => formatNumber(value)).join(", ")})` : "运行后计算"}</p></div>
          <ModelChart title="多路径感染均值" subtitle="浅色为样本路径，红色为 E[I]" times={stability?.times ?? []} series={stabilitySeries} />
          {stability && <div className="xu-ms-result"><span>初始均方距离 <strong>{formatNumber(stability.meanSquareDistance[0])}</strong></span><span>末端均方距离 <strong>{formatNumber(stability.meanSquareDistance.at(-1) ?? null)}</strong></span></div>}
        </article>
      </div>
    </div>
  );
}

const COMMUNITY_COLORS = ["#137b75", "#c45b3c", "#6f64a6", "#d39a32", "#3976a8", "#8b5e3c", "#4f8b5d", "#ad4e78", "#65747b", "#9b7c2f"];

function CommunityGraph({ adjacency, result }: { adjacency: Matrix; result: CommunityResult }) {
  const [selectedNode, setSelectedNode] = useState(0);
  const width = 760;
  const height = 430;
  const communities = Array.from({ length: result.communitySizes.length }, (_, community) => result.labels.map((label, node) => label === community ? node : -1).filter((node) => node >= 0));
  const positions = new Array<{ x: number; y: number }>(adjacency.length);
  communities.forEach((nodes, community) => {
    const centerAngle = (Math.PI * 2 * community) / Math.max(communities.length, 1) - Math.PI / 2;
    const centerRadius = communities.length <= 2 ? 145 : 132;
    const centerX = width / 2 + Math.cos(centerAngle) * centerRadius;
    const centerY = height / 2 + Math.sin(centerAngle) * centerRadius * 0.72;
    nodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(nodes.length, 1) - Math.PI / 2;
      const radius = Math.min(58, 20 + nodes.length * 4);
      positions[node] = { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius };
    });
  });
  const edges: Array<{ source: number; target: number; weight: number }> = [];
  adjacency.forEach((row, source) => row.forEach((weight, target) => {
    if (source !== target && weight > 0 && (result.directed || source < target)) edges.push({ source, target, weight });
  }));
  const displayedEdges = edges.sort((a, b) => b.weight - a.weight).slice(0, 600);
  const selectedMembership = result.membership[selectedNode];

  return (
    <div className="community-graph-wrap">
      <svg className="community-graph" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`网络社区图，共 ${adjacency.length} 个节点、${result.communitySizes.length} 个社区`}>
        <title>社区检测网络图</title>
        <desc>节点颜色表示所属社区，连线表示邻接关系。点击节点可查看归属置信度。</desc>
        {result.directed && <defs><marker id={`arrow-${result.algorithm}`} markerWidth="8" markerHeight="8" refX="16" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="#9aa9a7" /></marker></defs>}
        <g className="community-edges">{displayedEdges.map((edge, index) => <line key={`${edge.source}-${edge.target}-${index}`} x1={positions[edge.source].x} y1={positions[edge.source].y} x2={positions[edge.target].x} y2={positions[edge.target].y} strokeWidth={Math.min(3, 0.7 + edge.weight)} markerEnd={result.directed ? `url(#arrow-${result.algorithm})` : undefined} />)}</g>
        <g className="community-nodes">{positions.map((position, node) => {
          const community = result.labels[node];
          return <g key={node} className={selectedNode === node ? "is-selected" : ""} role="button" aria-label={`节点 ${node + 1}，社区 ${community + 1}`} onClick={() => setSelectedNode(node)}>
            <circle cx={position.x} cy={position.y} r={selectedNode === node ? 15 : 12} fill={COMMUNITY_COLORS[community % COMMUNITY_COLORS.length]} />
            {adjacency.length <= 30 && <text x={position.x} y={position.y + 4}>{node + 1}</text>}
          </g>;
        })}</g>
      </svg>
      <div className="community-node-detail" aria-live="polite"><span>节点 {selectedNode + 1}</span><strong>社区 {result.labels[selectedNode] + 1}</strong><small>归属置信度 {formatNumber(result.confidence[selectedNode] * 100, 1)}% · W = [{selectedMembership.map((value) => formatNumber(value, 3)).join(", ")}]</small></div>
    </div>
  );
}

function CommunityModule({ algorithm }: { algorithm: CommunityAlgorithm }) {
  const defaultPresetKey = algorithm === "roasnmf" ? "threeBlocks" : "directed";
  const defaultPreset = NETWORK_PRESETS[defaultPresetKey];
  const initialOptions: CommunityOptions = {
    algorithm,
    components: defaultPreset.recommendedK,
    iterations: 300,
    lambda: 0.1,
    alpha: 1,
    randomState: 42,
    init: algorithm === "masnmf" ? "svdInit" : "random",
  };
  const [presetKey, setPresetKey] = useState(defaultPresetKey);
  const [matrixText, setMatrixText] = useState(matrixToText(defaultPreset.matrix));
  const [adjacency, setAdjacency] = useState<Matrix>(defaultPreset.matrix);
  const [options, setOptions] = useState<CommunityOptions>(initialOptions);
  const [result, setResult] = useState<CommunityResult>(() => runCommunityDetection(defaultPreset.matrix, initialOptions));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const completedInput = useRef({ adjacency: defaultPreset.matrix, options: initialOptions });
  const currentAdjacency = useMemo(() => { try { return parseAdjacency(matrixText); } catch { return null; } }, [matrixText]);
  useReferenceData(
    { model: algorithm, preset: presetKey, adjacency: currentAdjacency, adjacencyText: matrixText, options: { ...options, algorithm } },
    { status: "completed", calculationInput: completedInput.current, labelBase: 0, displayLabelBase: 1, ...result },
    true, error,
  );

  const selectPreset = (key: string) => {
    const preset = NETWORK_PRESETS[key];
    const nextOptions = { ...options, components: preset.recommendedK };
    setPresetKey(key);
    setMatrixText(matrixToText(preset.matrix));
    setAdjacency(preset.matrix);
    setOptions(nextOptions);
    completedInput.current = { adjacency: preset.matrix, options: nextOptions };
    setResult(runCommunityDetection(preset.matrix, nextOptions));
    setError("");
  };

  const run = () => {
    setBusy(true);
    setError("");
    window.setTimeout(() => {
      try {
        const parsed = parseAdjacency(matrixText);
        const nextResult = runCommunityDetection(parsed, { ...options, algorithm });
        completedInput.current = { adjacency: parsed, options: { ...options, algorithm } };
        setAdjacency(parsed);
        setResult(nextResult);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "社区检测失败，请检查输入。");
      } finally {
        setBusy(false);
      }
    }, 20);
  };

  const download = () => {
    const payload = { algorithm, options, labels: result.labels.map((label) => label + 1), membership: result.membership, modularity: result.modularity, relativeLoss: result.loss };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${algorithm}-community-result.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const convergenceSeries: ChartSeries[] = [
    { label: "相对重构误差", color: "#b7433e", values: result.history.map((point) => point.loss) },
    { label: "模块度 Q", color: "#137b75", values: result.history.map((point) => point.modularity) },
  ];
  const communityRows = result.communitySizes.map((size, community) => {
    const nodes = result.labels.map((label, node) => label === community ? node + 1 : -1).filter((node) => node > 0);
    const meanConfidence = nodes.reduce((sum, node) => sum + result.confidence[node - 1], 0) / Math.max(nodes.length, 1);
    return { community, size, nodes, meanConfidence };
  });
  const meanConfidence = result.confidence.reduce((sum, value) => sum + value, 0) / result.confidence.length;
  const algorithmName = algorithm === "roasnmf" ? "鲁棒自适应对称 NMF" : "模块度约束非对称 NMF";

  return (
    <div className="xu-module-body community-module">
      <div className="xu-module-heading">
        <div><span>{algorithm === "roasnmf" ? "ROASNMF · MODEL.PY" : "MASNMF · MNNSVD"}</span><h2>{algorithmName}</h2></div>
        <p>{algorithm === "roasnmf" ? "通过辅助矩阵 U 与自适应误差权重 Q 降低异常连接的影响，再由 W 的最大分量给出社区标签。" : "将网络模块度先验写入 hatW 约束，支持随机或 MNNSVD 初始化，并适配非对称有向网络。"}</p>
      </div>

      <div className="community-workbench">
        <aside className="community-controls">
          <div className="xu-card-head"><div><span>INPUT</span><h3>网络与算法参数</h3></div><small>{adjacency.length} 个节点</small></div>
          <label className="xu-select-label"><span>示例网络</span><select value={presetKey} onChange={(event) => selectPreset(event.target.value)}>{Object.entries(NETWORK_PRESETS).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}</select><small>{NETWORK_PRESETS[presetKey].description}</small></label>
          <label className="community-matrix-input"><span>邻接矩阵</span><textarea value={matrixText} onChange={(event) => setMatrixText(event.target.value)} spellCheck={false} aria-label="邻接矩阵输入" /></label>
          <p className="xu-method-note">每行一个节点，使用逗号或空格分隔；支持 3–80 阶非负方阵。</p>
          <div className="community-option-grid">
            <NumericField label="社区数 k" note="2–10" step={1} value={options.components} onChange={(value) => setOptions((current) => ({ ...current, components: Math.round(value) }))} />
            <NumericField label="迭代次数" note="1–1,000" step={50} value={options.iterations} onChange={(value) => setOptions((current) => ({ ...current, iterations: Math.round(value) }))} />
            <NumericField label="λ 约束强度" note="非负数" step={0.05} value={options.lambda} onChange={(value) => setOptions((current) => ({ ...current, lambda: value }))} />
            <NumericField label="α 数据权重" note="大于 0" step={0.1} value={options.alpha} onChange={(value) => setOptions((current) => ({ ...current, alpha: value }))} />
            <NumericField label="随机种子" note="默认 42" step={1} value={options.randomState} onChange={(value) => setOptions((current) => ({ ...current, randomState: Math.round(value) }))} />
            {algorithm === "masnmf" && <label className="xu-select-label compact-select"><span>初始化方法</span><select value={options.init} onChange={(event) => setOptions((current) => ({ ...current, init: event.target.value as CommunityOptions["init"] }))}><option value="random">随机初始化</option><option value="svdInit">MNNSVD 初始化</option></select></label>}
          </div>
          <LoadingButton busy={busy} onClick={run}>运行社区检测</LoadingButton>
          {error && <p className="error-message" role="alert">{error}</p>}
          <button type="button" className="community-download" onClick={download}>下载当前结果 JSON</button>
        </aside>

        <section className="community-results" aria-live="polite">
          <div className="community-metrics">
            <article><span>模块度 Q</span><strong>{formatNumber(result.modularity)}</strong><small>越高表示社区内连接越集中</small></article>
            <article><span>相对重构误差</span><strong>{formatNumber(result.loss)}</strong><small>‖A−WHWᵀ‖F / ‖A‖F</small></article>
            <article><span>网络规模</span><strong>{adjacency.length} / {formatNumber(result.edgeCount, 0)}</strong><small>节点 / {result.directed ? "有向边" : "无向边"}</small></article>
            <article><span>平均归属置信度</span><strong>{formatNumber(meanConfidence * 100, 1)}%</strong><small>按 W 行归一化计算</small></article>
          </div>
          <article className="community-visual-panel">
            <div className="xu-chart-heading"><div><strong>社区网络图</strong><span>颜色代表社区；点击节点查看 W 向量</span></div><span>{result.directed ? "有向" : "无向"}</span></div>
            <CommunityGraph key={`${result.algorithm}-${result.loss}-${result.labels.join("-")}`} adjacency={adjacency} result={result} />
            <div className="community-legend">{communityRows.map((row) => <span key={row.community}><i style={{ background: COMMUNITY_COLORS[row.community % COMMUNITY_COLORS.length] }} />社区 {row.community + 1}（{row.size}）</span>)}</div>
          </article>
        </section>
      </div>

      <div className="community-detail-grid">
        <ModelChart title="迭代收敛轨迹" subtitle="相对重构误差与最终标签对应的模块度" times={result.history.map((point) => point.iteration)} series={convergenceSeries} />
        <article className="xu-analysis-card">
          <div className="xu-card-head"><div><span>OUTPUT</span><h3>社区成员</h3></div><small>{result.communitySizes.length} 个社区</small></div>
          <div className="xu-table-wrap"><table className="xu-simple-table community-table"><thead><tr><th>社区</th><th>节点数</th><th>平均置信度</th><th>成员节点</th></tr></thead><tbody>{communityRows.map((row) => <tr key={row.community}><td><i style={{ background: COMMUNITY_COLORS[row.community % COMMUNITY_COLORS.length] }} />社区 {row.community + 1}</td><td>{row.size}</td><td>{formatNumber(row.meanConfidence * 100, 1)}%</td><td>{row.nodes.join(", ") || "—"}</td></tr>)}</tbody></table></div>
          <p className="xu-method-note">标签由每个节点在 W 中的最大分量确定；节点编号与邻接矩阵的行列顺序一致。</p>
        </article>
      </div>
    </div>
  );
}

function SIQHModule() {
  const [parameters, setParameters] = useState<SIQHParameters>({ ...DEFAULT_SIQH_PARAMETERS });
  const [initial, setInitial] = useState<SIQHInitial>({ ...DEFAULT_SIQH_INITIAL });
  const [controls, setControls] = useState<SIQHControls>({ u1: 0.15, u2: 0.15 });
  const [duration, setDuration] = useState(90);
  const [dt, setDt] = useState(0.5);
  const [result, setResult] = useState<SIQHSimulation>(() => simulateDelayedSIQH({ parameters: DEFAULT_SIQH_PARAMETERS, initial: DEFAULT_SIQH_INITIAL, controls: { u1: 0.15, u2: 0.15 }, tEnd: 90, dt: 0.5 }));
  const [baseline, setBaseline] = useState<SIQHSimulation>(() => simulateDelayedSIQH({ parameters: DEFAULT_SIQH_PARAMETERS, initial: DEFAULT_SIQH_INITIAL, tEnd: 90, dt: 0.5 }));
  const [figureGroup, setFigureGroup] = useState<keyof typeof SIQH_SOURCE_FIGURES>("fitting");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const completedInput = useRef({ parameters: { ...DEFAULT_SIQH_PARAMETERS }, initial: { ...DEFAULT_SIQH_INITIAL }, controls: { u1: 0.15, u2: 0.15 }, tEnd: 90, dt: 0.5 });
  useReferenceData(
    { model: "delayed_fractional_SIQH", parameters, initial, controls, tEnd: duration, dt },
    { status: "completed", calculationInput: completedInput.current, controlled: result, baseline, summary: { infectionPeak: peakOf(result.I, result.times), baselineInfectionPeak: peakOf(baseline.I, baseline.times), finalState: Object.fromEntries((["S", "I", "Q", "H", "Rc", "Dc"] as const).map(key => [key, result[key][result.times.length - 1]])) } },
    true, error,
  );

  const run = () => {
    setBusy(true);
    setError("");
    window.setTimeout(() => {
      try {
        const nextBaseline = simulateDelayedSIQH({ parameters, initial, tEnd: duration, dt });
        const nextResult = simulateDelayedSIQH({ parameters, initial, controls, tEnd: duration, dt });
        completedInput.current = { parameters: { ...parameters }, initial: { ...initial }, controls: { ...controls }, tEnd: duration, dt };
        setBaseline(nextBaseline);
        setResult(nextResult);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "SIQH 计算失败，请检查参数。");
      } finally {
        setBusy(false);
      }
    }, 20);
  };

  const download = () => {
    const payload = {
      model: "delayed_fractional_SIQH",
      parameters,
      initial,
      controls,
      times: result.times,
      states: { S: result.S, I: result.I, Q: result.Q, H: result.H, Rc: result.Rc, Dc: result.Dc },
      confirmed: result.confirmed,
      threshold: result.threshold,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "delayed-fractional-siqh-result.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const peakI = peakOf(result.I, result.times);
  const baselinePeakI = peakOf(baseline.I, baseline.times);
  const reduction = 100 * (1 - peakI.value / Math.max(baselinePeakI.value, 1));
  const finalIndex = result.times.length - 1;
  const sourceFigures = SIQH_SOURCE_FIGURES[figureGroup];

  return (
    <div className="xu-module-body siqh-module">
      <div className="xu-module-heading">
        <div><span>DELAYED FRACTIONAL SIQH · MATLAB</span><h2>时滞分数阶疫情与控制</h2></div>
        <p>复现日本 COVID-19 的 S–I–Q–H–Rc–Dc 模型，并以原程序的 FBSM 最优控制缓存作为结果核对基准。</p>
      </div>

      <div className="xu-workbench siqh-workbench">
        <aside className="xu-parameters">
          <div className="xu-card-head"><div><span>INPUT</span><h3>日本 Table 2 参数</h3></div><small>2022-06-23</small></div>
          <div className="xu-field-grid">
            <NumericField label="α 分数阶" note="Caputo 阶数 (0, 1]" value={parameters.alpha} step={0.01} onChange={(value) => setParameters((current) => ({ ...current, alpha: value }))} />
            <NumericField label="τ 潜伏期" note="时滞天数" value={parameters.tau} step={0.5} onChange={(value) => setParameters((current) => ({ ...current, tau: value }))} />
            <NumericField label="u₁ 保护控制" note="S → H，范围 0–1" value={controls.u1} step={0.05} onChange={(value) => setControls((current) => ({ ...current, u1: value }))} />
            <NumericField label="u₂ 检测隔离" note="I → Q，范围 0–1" value={controls.u2} step={0.05} onChange={(value) => setControls((current) => ({ ...current, u2: value }))} />
          </div>
          <details className="siqh-details">
            <summary>传播与转归速率（9 项）</summary>
            <div className="xu-field-grid">{SIQH_RATE_FIELDS.map((field) => <NumericField key={field.key} label={field.label} note={field.note} step={field.step} value={parameters[field.key]} onChange={(value) => setParameters((current) => ({ ...current, [field.key]: value }))} />)}</div>
          </details>
          <details className="siqh-details">
            <summary>初始仓室与人口规模</summary>
            <div className="xu-initial-grid siqh-initial-grid">{(Object.keys(initial) as Array<keyof SIQHInitial>).map((key) => <label key={key}><span>{key}</span><input type="number" value={initial[key]} min={0} step={1} onChange={(event) => setInitial((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}</div>
            <div className="siqh-population-field"><NumericField label="N 总人口" note="日本默认人口" value={parameters.population} step={1000} onChange={(value) => setParameters((current) => ({ ...current, population: value }))} /></div>
          </details>
          <div className="xu-time-grid">
            <NumericField label="演示时长" note="1–180 天" value={duration} step={10} onChange={setDuration} />
            <NumericField label="时间步长" note="0.1–2 天" value={dt} step={0.1} onChange={setDt} />
          </div>
          <LoadingButton busy={busy} onClick={run}>运行 SIQH 仿真</LoadingButton>
          {error && <p className="error-message" role="alert">{error}</p>}
          <button type="button" className="community-download" onClick={download}>下载当前结果 JSON</button>
          <p className="xu-method-note">数值求解采用 Diethelm–Ford–Freed 预估—校正法。步长越小越接近 MATLAB 的 0.1 天设置，但计算量按时间点平方增长。</p>
        </aside>

        <section className="xu-results" aria-live="polite">
          <div className="xu-status-row">
            <article><span>感染峰值 I</span><strong>{formatNumber(peakI.value)}</strong><small>第 {formatNumber(peakI.day, 1)} 天</small></article>
            <article><span>峰值降幅</span><strong>{formatNumber(reduction, 1)}%</strong><small>相对同参数无控制情景</small></article>
            <article><span>期末隔离 Q</span><strong>{formatNumber(result.Q[finalIndex])}</strong><small>第 {formatNumber(result.times[finalIndex], 0)} 天</small></article>
            <article><span>阈值估计 R</span><strong>{formatNumber(result.threshold)}</strong><small>按无病平衡易感比例计算</small></article>
          </div>
          <ModelChart title="感染与隔离轨迹" subtitle="实线为当前控制；虚线为无控制对照" times={result.times} series={[
            { label: "I 当前控制", color: "#b7433e", values: result.I },
            { label: "Q 当前控制", color: "#d39a32", values: result.Q },
            { label: "I 无控制", color: "#b7433e", values: baseline.I, dashed: true, width: 1.4 },
            { label: "Q 无控制", color: "#d39a32", values: baseline.Q, dashed: true, width: 1.4 },
          ]} />
          <ModelChart title="易感与保护仓室" subtitle="控制 u₁ 直接影响 S → H 的转移" times={result.times} series={[
            { label: "S 易感", color: "#1f7a73", values: result.S },
            { label: "H 被保护", color: "#4472a8", values: result.H },
          ]} />
        </section>
      </div>

      <div className="siqh-secondary-grid">
        <ModelChart title="累计确诊拟合核对" subtitle="红线为当前参数的无控制模型；圆点为 JHU 日本周样本" times={baseline.times} series={[
          { label: "模型 Q+Rc+Dc", color: "#b7433e", values: baseline.confirmed },
          { label: "JHU 周样本", color: "#d8892d", values: JAPAN_WEEKLY_DATA.map((point) => point.confirmed), times: JAPAN_WEEKLY_DATA.map((point) => point.day), points: true },
        ]} />
        <article className="xu-analysis-card siqh-parameter-card">
          <div className="xu-card-head"><div><span>MODEL MAP</span><h3>仓室与控制含义</h3></div><small>6 个状态</small></div>
          <div className="siqh-flow"><span>S 易感</span><b>β · I(t−τ)</b><span>I 感染</span><b>δ + u₂</b><span>Q 隔离</span><b>r₂ / d₂</b><span>Rc / Dc</span></div>
          <ul><li><strong>u₁</strong>：加强易感者保护，同时降低 H 返回 S 的比例。</li><li><strong>u₂</strong>：加强检测与隔离，使感染者更快进入 Q。</li><li><strong>τ</strong>：感染力项读取 I(t−τ)，用于观察潜伏期延长对峰值时间的影响。</li></ul>
        </article>
      </div>

      <section className="siqh-source-panel">
        <div className="xu-card-head"><div><span>SOURCE BASELINE</span><h3>原 MATLAB 程序基准结果</h3></div><label className="siqh-figure-select"><span>图组</span><select value={figureGroup} onChange={(event) => setFigureGroup(event.target.value as keyof typeof SIQH_SOURCE_FIGURES)}>{Object.entries(SIQH_SOURCE_FIGURES).map(([key, group]) => <option key={key} value={key}>{group.label}</option>)}</select></label></div>
        <p>{sourceFigures.note}</p>
        <div className={`siqh-source-images ${sourceFigures.images.length === 3 ? "has-three" : ""}`}>{sourceFigures.images.map((item) => <figure key={item.src}><Image src={item.src} alt={item.alt} width={1528} height={1250} loading="lazy" sizes="(max-width: 620px) 100vw, (max-width: 1180px) 50vw, 33vw" /><figcaption>{item.alt}</figcaption></figure>)}</div>
      </section>
    </div>
  );
}

const STANDALONE_META: Record<ModuleKey, { index: string; title: string; input: string; output: string; note: string }> = {
  svir: {
    index: "02",
    title: "双毒株 SVIR",
    input: `{\n  "preset": "fig5",\n  "alpha": 0.8,\n  "beta1": 0.7,\n  "beta2": 0.7,\n  "beta3": 0.7,\n  "xi": 0.1,\n  "omega": 0.003\n}`,
    output: "times、六仓室 states、R₀/R₁/R₂/R₃、四种平衡态、敏感性指数与拟合指标。",
    note: "β₁、β₂、β₃分别表示原始株、易感者新株和接种者新株传播率；印度样例为 JHU 累计数据的周采样。",
  },
  sir: {
    index: "03",
    title: "随机分数阶 SIR",
    input: `{\n  "Lambda": 0.6,\n  "alpha": 0.9,\n  "beta": 0.4,\n  "mu": 0.4,\n  "gamma": 0.5,\n  "sigma": 0.5,\n  "seed": 2025\n}`,
    output: "S/I/R 随机路径、确定性对照、消亡时间、路径均值、均方距离与稳定性统计。",
    note: "σ=0 表示关闭随机扰动；使用相同随机种子 seed 可复现同一条噪声路径。",
  },
  roasnmf: {
    index: "04",
    title: "鲁棒自适应社区检测",
    input: `{\n  "adjacency": [[0,1,0],[1,0,1],[0,1,0]],\n  "components": 2,\n  "iterations": 300,\n  "lambda": 0.1,\n  "alpha": 1,\n  "randomState": 42\n}`,
    output: "社区标签 labels、隶属矩阵 W、交互矩阵 H、模块度、重构误差、节点置信度与收敛历史。",
    note: "输入为 3–80 阶非负邻接矩阵；算法保留辅助矩阵 U 与自适应误差权重 Q 的迭代更新。",
  },
  masnmf: {
    index: "05",
    title: "模块度约束社区检测",
    input: `{\n  "adjacency": [[0,1,0],[0,0,1],[1,0,0]],\n  "components": 2,\n  "iterations": 300,\n  "lambda": 0.1,\n  "init": "svdInit",\n  "randomState": 42\n}`,
    output: "社区标签 labels、隶属矩阵 W、交互矩阵 H、模块度、重构误差、节点置信度与收敛历史。",
    note: "支持有向非对称邻接矩阵，可选择随机初始化或 MNNSVD 初始化；λ 控制模块度先验强度。",
  },
  siqh: {
    index: "06",
    title: "时滞分数阶疫情控制",
    input: `{\n  "beta": 0.5549,\n  "alpha": 0.9959,\n  "tau": 2,\n  "u1": 0.15,\n  "u2": 0.15,\n  "duration": 90,\n  "dt": 0.5\n}`,
    output: "times、S/I/Q/H/Rc/Dc、累计确诊、感染峰值、峰值时间、阈值估计与无控制对照。",
    note: "常规仿真使用可调常量控制；Fig. 5–6 保留原 MATLAB 前向—后向扫描法的缓存结果供核对。",
  },
};

function StandaloneModuleBody({ module }: { module: ModuleKey }) {
  if (module === "svir") return <SVIRModule />;
  if (module === "sir") return <SIRModule />;
  if (module === "roasnmf") return <CommunityModule algorithm="roasnmf" />;
  if (module === "masnmf") return <CommunityModule algorithm="masnmf" />;
  return <SIQHModule />;
}

function ReferenceFields({ module }: { module: ModuleKey }) {
  const fields: Array<[string, string]> = module === "svir" ? [
    ...SVIR_FIELDS.map(field => [`parameters.${field.key}`, `${field.label}：${field.note}`] as [string, string]),
    ["initial", "初值顺序为 [S,V,I1,I2,R1,R2]，各值非负。"],
    ["tEnd / dt", "仿真终止时间与请求步长；求解器可能调整步长，实际时间取 times。"],
    ["incidenceScale", "传播项的归一化尺度；常规仿真为 1，拟合人口数据时由拟合结果给出。"],
    ["fitting.observations", "拟合观测数据：day 为相对天数，active 为活动感染数，recovered 为累计康复数；也可粘贴这三列 CSV。"],
    ["simulation / withoutVaccine", "有疫苗与无疫苗对照。times 为时间，states 为六仓室序列，memory 为疫苗记忆项，steps 为实际步数，maxMassError 为最大质量平衡误差。无疫苗对照将初始 V 合并至 S，并设 xi=0。"],
    ["analysis", "R0/R1/R2/R3 为传播阈值；scenario 为当前情景；equilibria 给出平衡态及 available 标记；sensitivities 为归一化敏感性与 +10% 参数扰动效应。不可用的平衡态坐标为 null。"],
    ["fitting", "未拟合时为 null；成功后包含 parameters、simulation、score（感染与康复观测的联合均方根误差）、incidenceScale 和 observations；与常规仿真结果分开。"],
  ] : module === "sir" ? [
    ...SIR_FIELDS.map(field => [`parameters.${field.key}`, `${field.label}：${field.note}`] as [string, string]),
    ["initial", "非负初值，顺序为 [S,I,R]。"],
    ["tEnd / dt", "终止时间与单路径请求步长；输出 times 给出实际时间点。"],
    ["seed / pathCount", "随机种子与集合路径数；实际集合路径数会四舍五入并限制到 3–20 条，以 stability.paths.length 为准。"],
    ["ensembleDt", "多噪声和集合分析使用 max(dt,tEnd/700) 控制计算量，各组实际时间分别取各自 times。"],
    ["single / deterministic", "当前噪声强度的随机路径与 sigma=0 的确定性对照；各自包含 times、states 和 seed，states 每行顺序为 [S,I,R]。"],
    ["multiNoise", "sigma=0.1/0.5/1/2 各组的完整 simulation 与 extinction；感染数连续 10 步低于 10^-3 时记为消亡，未满足则为 null。"],
    ["stability", "paths 为全部随机路径；meanStates 为各时刻仓室均值；meanSquareDistance 为距 target 的平均平方距离；target 为理论平衡态。"],
    ["calculationInput.R0", "本次计算入参对应的基本再生数；数值轨迹用于检验，不直接替代理论稳定性证明。"],
  ] : module === "siqh" ? [
    ...SIQH_RATE_FIELDS.map(field => [`parameters.${field.key}`, `${field.label}：${field.note}`] as [string, string]),
    ["parameters.alpha / tau / population", "Caputo 阶数 (0,1]、非负感染时滞（天）及传播归一化人口规模（正数）。"],
    ["initial", "S 易感、I 感染、Q 隔离、H 被保护、Rc 累计隔离康复、Dc 累计隔离死亡；均为非负人数。"],
    ["controls.u1 / u2", "常量保护控制与检测隔离控制，范围 [0,1]；两者为 0 时表示无额外控制。"],
    ["tEnd / dt", "仿真天数与请求步长；实际使用时间点见输出 times。"],
    ["controlled / baseline", "有控制与无控制完整结果，各自包含 times、S/I/Q/H/Rc/Dc 时间序列、controls、confirmed（Q+Rc+Dc）和 threshold（阈值估计）。"],
    ["summary", "infectionPeak 与 baselineInfectionPeak 分别给出感染峰值及其时间；finalState 给出有控制情景的六个终点仓室值。"],
    ["控制图组", "本页可重算的是常量控制仿真；原 MATLAB 最优控制图为缓存基准，不冒充本次重算结果。"],
  ] : [
    ["adjacency / adjacencyText", "非负邻接方阵与当前文本；支持 3–80 节点，逗号或空格分隔。格式无效时 adjacency 为 null，运行时显示错误。"],
    ["options.algorithm", module === "roasnmf" ? "roasnmf：鲁棒自适应对称分解。" : "masnmf：模块度约束非对称分解，支持有向网络。"],
    ["options.components / iterations", "社区数为 2–min(10,节点数) 的整数；迭代次数为 1–1000 的整数。"],
    ["options.lambda / alpha", "非负约束权重 lambda 与正数自适应参数 alpha；具体作用依算法而定。"],
    ["options.randomState / init", "随机种子与初始化：random 或 svdInit（MNNSVD）。固定输入和种子可复现结果。"],
    ["labels / labelBase", "labels 与邻接矩阵行顺序一致，从 0 编号；网页表格与原下载文件从 1 编号，等于 labels+1。"],
    ["membership / interaction", "非负隶属矩阵（节点数×社区数）与交互矩阵（社区数×社区数），对应算法中的 W/H。"],
    ["modularity / loss", "模块度 Q 与相对重构误差；值来自本次算法结果，不是百分比准确率。"],
    ["confidence / communitySizes", "各节点的成员置信度（0–1）及各社区节点数，与 labels 的编号对应。"],
    ["history", "逐次迭代记录：iteration、loss、modularity。"],
    ["directed / edgeCount / density", "是否有向、边数与网络密度；默认样例进入页面时已完成一次计算。"],
  ];
  return <dl>{fields.map(([name, description]) => <div key={name} style={{ marginTop: 12, fontSize: 12, lineHeight: 1.7 }}><dt><strong>{name}</strong></dt><dd style={{ marginLeft: 0 }}>{description}</dd></div>)}</dl>;
}

function defaultReferenceInput(module: ModuleKey) {
  if (module === "svir") return { model: "fractional_two_strain_SVIR", preset: "fig5", parameters: SVIR_PRESETS.fig5.parameters, initial: DEFAULT_SVIR_INITIAL, tEnd: 80, dt: 0.2, incidenceScale: 1, fitting: { columns: ["day", "active", "recovered"], observations: INDIA_WEEKLY_DATA } };
  if (module === "sir") return { model: "stochastic_fractional_SIR", parameters: DEFAULT_SIR_PARAMETERS, initial: [0.65, 0.25, 0.1], tEnd: 30, dt: 0.05, seed: 2025, pathCount: 10, noiseComparison: [0.1, 0.5, 1, 2], ensembleDt: 0.05 };
  if (module === "siqh") return { model: "delayed_fractional_SIQH", parameters: DEFAULT_SIQH_PARAMETERS, initial: DEFAULT_SIQH_INITIAL, controls: { u1: 0.15, u2: 0.15 }, tEnd: 90, dt: 0.5 };
  const preset = module === "roasnmf" ? "threeBlocks" : "directed";
  return { model: module, preset, adjacency: NETWORK_PRESETS[preset].matrix, adjacencyText: matrixToText(NETWORK_PRESETS[preset].matrix), options: { algorithm: module, components: NETWORK_PRESETS[preset].recommendedK, iterations: 300, lambda: 0.1, alpha: 1, randomState: 42, init: module === "roasnmf" ? "random" : "svdInit" } };
}

export function StandaloneResearchModule({ module }: { module: ModuleKey }) {
  const meta = STANDALONE_META[module];
  const [data, setData] = useState<ReferenceData | null>(null);
  return (
    <main className="xu-page research-detail-page">
      <header className="topbar detail-topbar">
        <Link href="/" className="brand" aria-label="返回研究成果展示平台首页"><span className="brand-mark">R</span><span><strong>研究成果展示平台</strong><small>Research Outputs</small></span></Link>
        <nav aria-label="页面导航"><Link href="/">成果首页</Link><a href="#calculation">计算与结果</a><a href="#reference">参数说明</a></nav>
      </header>

      <section className="xu-model-section standalone-module-section" id="calculation">
        <div className="standalone-result-index"><span>{meta.index}</span><p>{meta.title}</p></div>
        <ReferenceContext.Provider value={setData}><StandaloneModuleBody module={module} /></ReferenceContext.Provider>
      </section>

      <section className="xu-reference standalone-reference" id="reference">
        <div className="xu-module-heading"><div><span>REFERENCE</span><h2>入参样例与返回数据</h2></div><p>入参随当前设置更新；返回数据对应最近一次成功计算，修改参数后需重新运行。</p></div>
        <div className="xu-reference-grid standalone-reference-grid">
          <article><span>完整入参样例</span><pre style={{ maxHeight: 520, overflow: "auto" }} aria-label="完整入参 JSON">{data?.input ?? JSON.stringify(defaultReferenceInput(module), null, 2)}</pre></article>
          <article><span>实际返回数据</span><p>{data?.hasResult ? "最近一次成功计算的完整结果；calculationInput / simulationInput 记录该结果使用的入参。" : "尚未运行，不显示虚构计算值。点击上方运行按钮生成实际返回数据。"}</p>{data?.error && <p role="alert">最近一次操作失败：{data.error}；已有结果仍为上次成功计算结果。</p>}<pre style={{ maxHeight: 520, overflow: "auto" }} aria-label="实际返回 JSON">{data?.output ?? '{"status":"not_run"}'}</pre></article>
          <article><span>字段与用法说明</span><p>{meta.note}</p><ReferenceFields module={module} /><p>数组不截断；times 与各状态数组按相同索引对应。当前页面中的 JSON 用于说明计算数据结构，不表示已部署 HTTP 接口。</p></article>
        </div>
      </section>

      <footer><div><strong>研究成果展示平台</strong><span>{meta.title}</span></div><p>数值结果应结合原论文和数据质量解释</p></footer>
    </main>
  );
}

export default function XuModelsPage() {
  return <StandaloneResearchModule module="svir" />;
}
