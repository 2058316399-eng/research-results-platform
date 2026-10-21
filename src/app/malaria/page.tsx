"use client";

import { SiteLink as Link } from "../../static/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  computeR0,
  DEFAULT_DURATION,
  DEFAULT_INITIALS,
  DEFAULT_R0_INPUTS,
  simulateMalaria,
  STATE_KEYS,
  type R0Input,
  type R0Result,
  type Scenario,
  type SeriesPoint,
  type SimulationResult,
  type StateKey,
} from "../malaria-model";

type ActiveTool = "simulation" | "r0";
type NumericR0Key = Exclude<keyof R0Input, "scenario">;

const STATE_META: Record<
  StateKey,
  { name: string; description: string; group: "媒介" | "人群"; color: string }
> = {
  Smi: { name: "易感雄蚊", description: "尚未感染的雄性媒介", group: "媒介", color: "#147d78" },
  Smf: { name: "易感雌蚊", description: "尚未感染的雌性媒介", group: "媒介", color: "#3ca7a2" },
  Emi: { name: "暴露雄蚊", description: "已暴露、尚未进入感染期", group: "媒介", color: "#d97728" },
  Emf: { name: "暴露雌蚊", description: "已暴露、尚未进入感染期", group: "媒介", color: "#eaaa35" },
  Imi: { name: "感染雄蚊", description: "处于感染状态的雄性媒介", group: "媒介", color: "#a63d40" },
  Imf: { name: "感染雌蚊", description: "处于感染状态的雌性媒介", group: "媒介", color: "#d4535f" },
  Sh: { name: "易感人群", description: "可能被感染的人群", group: "人群", color: "#27527a" },
  Eh: { name: "暴露人群", description: "已暴露、尚未进入感染期", group: "人群", color: "#6c63b8" },
  Ih: { name: "感染人群", description: "当前具有感染状态的人群", group: "人群", color: "#bd2d3a" },
  Rh: { name: "康复人群", description: "康复并暂时获得免疫的人群", group: "人群", color: "#2d8f62" },
};

const MOSQUITO_KEYS = STATE_KEYS.filter((key) => STATE_META[key].group === "媒介");
const HUMAN_KEYS = STATE_KEYS.filter((key) => STATE_META[key].group === "人群");

const R0_FIELDS: Array<{
  key: NumericR0Key;
  label: string;
  description: string;
  step: number;
  integer?: boolean;
}> = [
  { key: "period", label: "周期 T", description: "季节性参数的重复周期", step: 1 },
  { key: "carryingCapacity", label: "媒介承载量 Kₘ", description: "环境可承载的最大媒介数量", step: 100000 },
  { key: "humanRecruitment", label: "人群输入率 Π", description: "单位时间进入易感人群的数量", step: 1000 },
  { key: "naturalHumanMortality", label: "自然死亡率 dₕ", description: "人群自然死亡率", step: 0.00001 },
  { key: "infectiousMaleFactor", label: "雄蚊传染倍率", description: "雄蚊相对传播系数", step: 0.1 },
  { key: "recoveryRate", label: "康复率 rₕ", description: "感染人群进入康复状态的速率", step: 0.0001 },
  { key: "diseaseMortality", label: "疾病死亡率 dₕᵢ", description: "感染相关附加死亡率", step: 0.0001 },
  { key: "integrationStep", label: "积分步长", description: "周期算子的数值积分精度", step: 0.01 },
  { key: "tolerance", label: "收敛容差", description: "迭代停止判据", step: 0.000001 },
  { key: "maxPeriods", label: "最大周期数", description: "周期平衡迭代上限", step: 1, integer: true },
];

function formatNumber(value: number, compact = false) {
  if (!Number.isFinite(value)) return "—";
  if (compact && Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("zh-CN", {
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (Math.abs(value) > 0 && Math.abs(value) < 0.001) return value.toExponential(3);
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value);
}

function ScenarioSwitch({
  value,
  onChange,
}: {
  value: Scenario;
  onChange: (value: Scenario) => void;
}) {
  return (
    <div className="scenario-switch" aria-label="模型情景">
      <button
        type="button"
        className={value === "DFE" ? "is-active" : ""}
        onClick={() => onChange("DFE")}
        aria-pressed={value === "DFE"}
      >
        <strong>DFE</strong>
        <span>无病平衡情景</span>
      </button>
      <button
        type="button"
        className={value === "EE" ? "is-active" : ""}
        onClick={() => onChange("EE")}
        aria-pressed={value === "EE"}
      >
        <strong>EE</strong>
        <span>地方病平衡情景</span>
      </button>
    </div>
  );
}

function CanvasChart({
  title,
  subtitle,
  data,
  keys,
}: {
  title: string;
  subtitle: string;
  data: SeriesPoint[];
  keys: readonly StateKey[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState<StateKey[]>([...keys]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length === 0) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(300, rect.width);
      const height = 300;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const margin = { top: 14, right: 14, bottom: 40, left: 58 };
      const plotWidth = width - margin.left - margin.right;
      const plotHeight = height - margin.top - margin.bottom;
      const active = visible.length > 0 ? visible : keys;
      let maximum = 1;
      for (const point of data) {
        for (const key of active) maximum = Math.max(maximum, point[key]);
      }
      maximum *= 1.08;
      const firstTime = data[0].t;
      const lastTime = data.at(-1)?.t || 1;

      context.strokeStyle = "rgba(30, 55, 64, 0.1)";
      context.fillStyle = "#718087";
      context.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.lineWidth = 1;
      for (let index = 0; index <= 4; index += 1) {
        const y = margin.top + (plotHeight * index) / 4;
        context.beginPath();
        context.moveTo(margin.left, y);
        context.lineTo(width - margin.right, y);
        context.stroke();
        context.textAlign = "right";
        context.textBaseline = "middle";
        context.fillText(formatNumber(maximum * (1 - index / 4), true), margin.left - 8, y);
      }
      for (let index = 0; index <= 5; index += 1) {
        const x = margin.left + (plotWidth * index) / 5;
        context.beginPath();
        context.moveTo(x, margin.top);
        context.lineTo(x, margin.top + plotHeight);
        context.stroke();
        context.textAlign = "center";
        context.textBaseline = "top";
        context.fillText(
          formatNumber(firstTime + ((lastTime - firstTime) * index) / 5, true),
          x,
          margin.top + plotHeight + 10,
        );
      }

      for (const key of active) {
        context.strokeStyle = STATE_META[key].color;
        context.lineWidth = key === "Ih" || key === "Imf" ? 2.4 : 1.7;
        context.lineJoin = "round";
        context.beginPath();
        data.forEach((point, index) => {
          const x = margin.left + ((point.t - firstTime) / (lastTime - firstTime || 1)) * plotWidth;
          const y = margin.top + plotHeight - (point[key] / maximum) * plotHeight;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        context.stroke();
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [data, keys, visible]);

  return (
    <article className="chart-card">
      <div className="chart-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span>横轴：模型时间</span>
      </div>
      <canvas ref={canvasRef} role="img" aria-label={`${title}时序图`} />
      <div className="legend" aria-label="曲线显示开关">
        {keys.map((key) => {
          const isVisible = visible.includes(key);
          return (
            <button
              type="button"
              key={key}
              className={isVisible ? "legend-item" : "legend-item is-muted"}
              onClick={() =>
                setVisible((current) =>
                  current.includes(key)
                    ? current.filter((item) => item !== key)
                    : [...current, key],
                )
              }
              aria-pressed={isVisible}
            >
              <i style={{ background: STATE_META[key].color }} />
              {key}
            </button>
          );
        })}
      </div>
    </article>
  );
}

export default function Home() {
  const [activeTool, setActiveTool] = useState<ActiveTool>("simulation");
  const [scenario, setScenario] = useState<Scenario>("DFE");
  const [duration, setDuration] = useState(DEFAULT_DURATION.DFE);
  const [step, setStep] = useState(0.01);
  const [initial, setInitial] = useState([...DEFAULT_INITIALS.DFE]);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [simulationStatus, setSimulationStatus] = useState<"idle" | "running" | "done">("idle");
  const [simulationError, setSimulationError] = useState("");
  const [r0Input, setR0Input] = useState<R0Input>({ ...DEFAULT_R0_INPUTS.DFE });
  const [r0Result, setR0Result] = useState<R0Result | null>(null);
  const [r0Status, setR0Status] = useState<"idle" | "running" | "done">("idle");
  const [r0Error, setR0Error] = useState("");
  const [copied, setCopied] = useState<"input" | "output" | null>(null);

  const runSimulation = (payload = { scenario, duration, step, initial }) => {
    setSimulationStatus("running");
    setSimulationError("");
    window.setTimeout(() => {
      try {
        setSimulation(simulateMalaria(payload));
        setSimulationStatus("done");
      } catch (error) {
        setSimulationError(error instanceof Error ? error.message : "计算失败，请检查输入参数。");
        setSimulationStatus("idle");
      }
    }, 40);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => runSimulation({
        scenario: "DFE",
        duration: DEFAULT_DURATION.DFE,
        step: 0.01,
        initial: [...DEFAULT_INITIALS.DFE],
      }), 0);
    return () => window.clearTimeout(timer);
    // 首次打开时运行一遍原始 DFE 样例，便于直接查看结果。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeScenario = (nextScenario: Scenario) => {
    setScenario(nextScenario);
    setDuration(DEFAULT_DURATION[nextScenario]);
    setStep(0.01);
    setInitial([...DEFAULT_INITIALS[nextScenario]]);
    setSimulation(null);
    setSimulationStatus("idle");
    setSimulationError("");
  };

  const resetSimulation = () => changeScenario(scenario);

  const selectR0Scenario = (nextScenario: Scenario) => {
    setR0Input({ ...DEFAULT_R0_INPUTS[nextScenario] });
    setR0Result(null);
    setR0Status("idle");
    setR0Error("");
  };

  const runR0 = () => {
    setR0Status("running");
    setR0Error("");
    window.setTimeout(() => {
      try {
        setR0Result(computeR0(r0Input));
        setR0Status("done");
      } catch (error) {
        setR0Error(error instanceof Error ? error.message : "R₀ 计算失败，请检查输入参数。");
        setR0Status("idle");
      }
    }, 40);
  };

  const simulationInput = useMemo(
    () => ({
      scenario,
      duration,
      step,
      initial: Object.fromEntries(STATE_KEYS.map((key, index) => [key, initial[index]])),
    }),
    [duration, initial, scenario, step],
  );

  const inputPreview = useMemo(
    () => JSON.stringify(activeTool === "simulation" ? simulationInput : r0Input, null, 2),
    [activeTool, r0Input, simulationInput],
  );

  const outputObject = useMemo(() => {
    if (activeTool === "r0") {
      if (!r0Result) return { status: "等待运行", message: "设置参数并点击“计算 R₀”" };
      return r0Result;
    }
    if (!simulation) return { status: "等待运行", message: "设置参数并点击“运行传播模型”" };
    return {
      model: simulation.model,
      scenario: simulation.scenario,
      solver: simulation.solver,
      duration: simulation.duration,
      step: simulation.step,
      computedSteps: simulation.computedSteps,
      summary: simulation.summary,
      finalState: simulation.finalState,
      seriesPreview: [simulation.series[0], simulation.series.at(-1)],
    };
  }, [activeTool, r0Result, simulation]);

  const outputPreview = useMemo(() => JSON.stringify(outputObject, null, 2), [outputObject]);

  const copyText = async (kind: "input" | "output", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1400);
  };

  const downloadResult = () => {
    const result = activeTool === "simulation" ? simulation : r0Result;
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = activeTool === "simulation"
      ? `malaria-${simulation?.scenario.toLowerCase()}-result.json`
      : `malaria-r0-${r0Result?.scenario.toLowerCase()}-result.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="research-detail-page malaria-page">
      <header className="topbar detail-topbar">
        <Link href="/" className="brand" aria-label="返回基于多元因素影响的病原体跨尺度时空传播控制技术首页">
          <span className="brand-mark">R</span>
          <span>
            <strong>基于多元因素影响的病原体跨尺度时空传播控制技术</strong>
            <small>Research Outputs</small>
          </span>
        </Link>
        <nav aria-label="页面导航">
          <Link href="/">成果首页</Link>
          <a href="#overview">基本信息</a>
          <a href="#calculator">在线计算</a>
          <a href="#data-format">入参与返回</a>
        </nav>
      </header>

      <section className="intro" id="top">
        <div>
          <p className="kicker">10-STATE SEIR · DFE / EE · PERIODIC R₀</p>
          <h1>疟疾传播动力学<br />研究成果</h1>
          <p className="intro-text">
            将原 MATLAB 模型整合为可交互页面。输入基础参数后，可运行无病平衡与地方病平衡情景，
            查看媒介和人群的状态变化，并计算周期环境下的基本再生数 R₀。
          </p>
          <Link className="intro-link" href="/">查看其他研究成果 →</Link>
        </div>
        <aside className="intro-note">
          <span>模型摘要</span>
          <strong>十状态耦合系统</strong>
          <p>同时刻画雄蚊、雌蚊与人群之间的暴露、感染和康复过程。</p>
          <div>
            <span>求解方法：RK4</span>
            <span>状态变量：10</span>
          </div>
        </aside>
      </section>

      <section className="overview" id="overview">
        <div className="section-title compact-title">
          <div>
            <span>01</span>
            <div><p>OVERVIEW</p><h2>基本信息</h2></div>
          </div>
        </div>
        <div className="overview-grid">
          <article>
            <span>模型范围</span>
            <strong>媒介—人群耦合模型</strong>
            <p>包含6个蚊媒状态和4个人群状态，用于观察传播过程的时间演化。</p>
          </article>
          <article>
            <span>情景设置</span>
            <strong>DFE 与 EE</strong>
            <p>DFE表示趋向无病平衡；EE表示地方病持续存在的平衡情景。</p>
          </article>
          <article>
            <span>主要输出</span>
            <strong>轨迹、峰值与 R₀</strong>
            <p>返回完整时序数据、终点状态、感染峰值以及基本再生数估计。</p>
          </article>
          <article>
            <span>使用说明</span>
            <strong>科研与教学演示</strong>
            <p>结果用于模型验证和研究展示，不构成临床判断或医疗建议。</p>
          </article>
        </div>
      </section>

      <section className="calculator" id="calculator">
        <div className="section-title">
          <div>
            <span>02</span>
            <div><p>CALCULATOR</p><h2>在线计算</h2></div>
          </div>
          <p>选择计算类型，修改参数后运行。默认值来自原始 MATLAB 文件。</p>
        </div>

        <div className="tool-tabs" role="tablist" aria-label="计算类型">
          <button
            type="button"
            role="tab"
            aria-selected={activeTool === "simulation"}
            className={activeTool === "simulation" ? "is-active" : ""}
            onClick={() => setActiveTool("simulation")}
          >
            传播轨迹模拟
            <span>DFE / EE 十状态模型</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTool === "r0"}
            className={activeTool === "r0" ? "is-active" : ""}
            onClick={() => setActiveTool("r0")}
          >
            基本再生数 R₀
            <span>周期下一代算子</span>
          </button>
        </div>

        {activeTool === "simulation" ? (
          <div className="workbench">
            <aside className="parameter-card">
              <div className="card-heading">
                <div><span>INPUT</span><h3>模拟参数</h3></div>
                <button type="button" className="text-button" onClick={resetSimulation}>恢复默认</button>
              </div>

              <p className="field-label">模型情景</p>
              <ScenarioSwitch value={scenario} onChange={changeScenario} />

              <div className="basic-fields">
                <label className="field">
                  <span>模拟时长</span>
                  <input
                    type="number"
                    min="0.01"
                    value={duration}
                    onChange={(event) => setDuration(Number(event.target.value))}
                  />
                  <small>模型时间终点</small>
                </label>
                <label className="field">
                  <span>积分步长</span>
                  <input
                    type="number"
                    min="0.001"
                    step="0.01"
                    value={step}
                    onChange={(event) => setStep(Number(event.target.value))}
                  />
                  <small>默认0.01；越小越精细</small>
                </label>
              </div>

              <div className="subheading">
                <strong>初始状态</strong>
                <span>数量均须为非负数</span>
              </div>
              <div className="state-table" role="group" aria-label="十个初始状态参数">
                {STATE_KEYS.map((key, index) => (
                  <label className="state-row" key={key}>
                    <i style={{ background: STATE_META[key].color }} />
                    <span className="state-code">{key}</span>
                    <span className="state-name">
                      <strong>{STATE_META[key].name}</strong>
                      <small>{STATE_META[key].description}</small>
                    </span>
                    <input
                      aria-label={`${STATE_META[key].name}初始值`}
                      type="number"
                      min="0"
                      value={initial[index]}
                      onChange={(event) => {
                        const next = [...initial];
                        next[index] = Number(event.target.value);
                        setInitial(next);
                      }}
                    />
                  </label>
                ))}
              </div>

              {simulationError && <p className="error-message">{simulationError}</p>}
              <button
                type="button"
                className="run-button"
                onClick={() => runSimulation()}
                disabled={simulationStatus === "running"}
              >
                {simulationStatus === "running" ? "正在计算…" : "运行传播模型"}
                <span>→</span>
              </button>
              <p className="limit-note">单次计算上限500,000步。</p>
            </aside>

            <div className="result-card">
              <div className="result-header">
                <div>
                  <span className={`status-light ${simulationStatus}`} />
                  <strong>
                    {simulationStatus === "running"
                      ? "正在计算"
                      : simulation
                        ? `${simulation.scenario} 情景计算完成`
                        : "等待运行"}
                  </strong>
                </div>
                {simulation && <span>{simulation.computedSteps.toLocaleString("zh-CN")} 个积分步</span>}
              </div>

              {simulation ? (
                <>
                  <div className="metric-grid">
                    <article className="metric emphasis">
                      <span>感染人群峰值</span>
                      <strong>{formatNumber(simulation.summary.peakInfectiousHumans, true)}</strong>
                      <small>出现于 t = {formatNumber(simulation.summary.peakTime)}</small>
                    </article>
                    <article className="metric">
                      <span>终点感染人群</span>
                      <strong>{formatNumber(simulation.summary.finalInfectiousHumans, true)}</strong>
                      <small>Ih(t_end)</small>
                    </article>
                    <article className="metric">
                      <span>终点人群总量</span>
                      <strong>{formatNumber(simulation.summary.finalHumanPopulation, true)}</strong>
                      <small>Sh + Eh + Ih + Rh</small>
                    </article>
                    <article className="metric">
                      <span>终点媒介总量</span>
                      <strong>{formatNumber(simulation.summary.finalMosquitoPopulation, true)}</strong>
                      <small>六个媒介状态之和</small>
                    </article>
                  </div>
                  <div className="charts">
                    <CanvasChart
                      title="媒介种群变化"
                      subtitle="雄蚊与雌蚊的易感、暴露和感染状态"
                      data={simulation.series}
                      keys={MOSQUITO_KEYS}
                    />
                    <CanvasChart
                      title="人群状态变化"
                      subtitle="易感、暴露、感染和康复状态"
                      data={simulation.series}
                      keys={HUMAN_KEYS}
                    />
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <span>∿</span>
                  <strong>尚未生成结果</strong>
                  <p>确认左侧参数后，点击“运行传播模型”。</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="workbench r0-workbench">
            <aside className="parameter-card">
              <div className="card-heading">
                <div><span>INPUT</span><h3>R₀ 参数</h3></div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => selectR0Scenario(r0Input.scenario)}
                >恢复默认</button>
              </div>
              <p className="field-label">参数预设</p>
              <ScenarioSwitch value={r0Input.scenario} onChange={selectR0Scenario} />

              <div className="r0-fields">
                {R0_FIELDS.map((field) => (
                  <label className="r0-field" key={field.key}>
                    <span>
                      <strong>{field.label}</strong>
                      <small>{field.description}</small>
                    </span>
                    <input
                      aria-label={field.label}
                      type="number"
                      min="0"
                      step={field.step}
                      value={r0Input[field.key]}
                      onChange={(event) =>
                        setR0Input((current) => ({
                          ...current,
                          [field.key]: field.integer
                            ? Math.round(Number(event.target.value))
                            : Number(event.target.value),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>

              {r0Error && <p className="error-message">{r0Error}</p>}
              <button
                type="button"
                className="run-button"
                onClick={runR0}
                disabled={r0Status === "running"}
              >
                {r0Status === "running" ? "正在计算…" : "计算 R₀"}
                <span>→</span>
              </button>
            </aside>

            <div className="result-card r0-result-card">
              <div className="result-header">
                <div>
                  <span className={`status-light ${r0Status}`} />
                  <strong>{r0Status === "running" ? "正在迭代" : r0Result ? "R₀ 计算完成" : "等待运行"}</strong>
                </div>
                <span>周期下一代算子</span>
              </div>
              {r0Result ? (
                <div className="r0-result">
                  <div className="r0-number">
                    <span>基本再生数</span>
                    <strong>{formatNumber(r0Result.R0)}</strong>
                    <p className={r0Result.R0 > 1 ? "above" : "below"}>
                      {r0Result.R0 > 1
                        ? "R₀ > 1：感染具有扩张条件"
                        : "R₀ < 1：感染趋于衰减"}
                    </p>
                  </div>
                  <div className="r0-detail-grid">
                    <article><span>根迭代次数</span><strong>{r0Result.rootIterations}</strong></article>
                    <article><span>周期迭代次数</span><strong>{r0Result.periodicMosquitoIterations}</strong></article>
                    <article><span>数值根收敛</span><strong>{r0Result.converged ? "是" : "否"}</strong></article>
                    <article><span>周期解收敛</span><strong>{r0Result.periodicMosquitoConverged ? "是" : "否"}</strong></article>
                    <article><span>周期端点误差</span><strong>{formatNumber(r0Result.periodicEndpointError)}</strong></article>
                    <article><span>情景</span><strong>{r0Result.scenario}</strong></article>
                  </div>
                  <div className="threshold-note">
                    <strong>阈值说明</strong>
                    <p>R₀表示一个感染者在完全易感环境中平均引起的继发感染规模，1是常用传播阈值。</p>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <span>R₀</span>
                  <strong>尚未生成结果</strong>
                  <p>确认左侧参数后，点击“计算 R₀”。</p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="data-format" id="data-format">
        <div className="section-title">
          <div>
            <span>03</span>
            <div><p>DATA FORMAT</p><h2>入参样例与返回数据</h2></div>
          </div>
          <p>内容会随上方当前参数和计算结果同步更新。</p>
        </div>

        <div className="code-grid">
          <article className="code-card">
            <div className="code-heading">
              <div><span>REQUEST</span><strong>当前入参</strong></div>
              <button type="button" onClick={() => copyText("input", inputPreview)}>
                {copied === "input" ? "已复制" : "复制"}
              </button>
            </div>
            <pre><code>{inputPreview}</code></pre>
          </article>
          <article className="code-card">
            <div className="code-heading">
              <div><span>RESPONSE</span><strong>当前返回</strong></div>
              <div className="code-actions">
                <button type="button" onClick={() => copyText("output", outputPreview)}>
                  {copied === "output" ? "已复制" : "复制"}
                </button>
                {(simulation || r0Result) && <button type="button" onClick={downloadResult}>下载JSON</button>}
              </div>
            </div>
            <pre><code>{outputPreview}</code></pre>
          </article>
        </div>
        <div className="format-notes">
          <p><strong>输入约束：</strong>时间与速率参数须为正数，10个初始状态须为非负数。</p>
          <p><strong>返回说明：</strong>summary为汇总指标，finalState为终点状态，series为完整时序数组。</p>
        </div>
      </section>

      <footer>
        <div>
          <strong>基于多元因素影响的病原体跨尺度时空传播控制技术</strong>
          <span>疟疾传播动力学</span>
        </div>
        <p>计算结果不构成医疗建议</p>
      </footer>
    </main>
  );
}
