import { SiteLink as Link } from "../static/navigation";

const RESEARCH_RESULTS = [
  {
    index: "01",
    code: "MALARIA · SEIR",
    title: "疟疾传播动力学",
    description: "十状态媒介—人群耦合模型，展示无病平衡、地方病平衡和周期环境下的基本再生数。",
    outputs: "传播轨迹 · 峰值 · R₀",
    href: "/malaria",
    tone: "teal",
  },
  {
    index: "02",
    code: "FRACTIONAL · SVIR",
    title: "双毒株 SVIR",
    description: "研究疫苗记忆、原始株与新毒株竞争关系，并给出平衡态、敏感性与数据拟合结果。",
    outputs: "六仓室 · 四类平衡态",
    href: "/svir",
    tone: "blue",
  },
  {
    index: "03",
    code: "STOCHASTIC · SIR",
    title: "随机分数阶 SIR",
    description: "结合 Caputo 分数阶与随机扰动，分析感染消亡时间、路径稳定性及噪声强度影响。",
    outputs: "随机路径 · 稳定性",
    href: "/sir",
    tone: "amber",
  },
  {
    index: "04",
    code: "ROBUST · ASNMF",
    title: "鲁棒自适应社区检测",
    description: "利用自适应误差权重降低异常连接干扰，从邻接矩阵识别网络社区及节点归属。",
    outputs: "社区图 · 隶属矩阵",
    href: "/roasnmf",
    tone: "red",
  },
  {
    index: "05",
    code: "MODULARITY · ASNMF",
    title: "模块度约束社区检测",
    description: "将模块度先验加入非负矩阵分解，支持有向网络及 MNNSVD 初始化。",
    outputs: "模块度 · 重构误差",
    href: "/masnmf",
    tone: "violet",
  },
  {
    index: "06",
    code: "DELAYED · SIQH",
    title: "时滞分数阶疫情控制",
    description: "基于日本疫情数据研究潜伏期与保护、检测隔离控制对感染和隔离人群的影响。",
    outputs: "时滞曲线 · 最优控制",
    href: "/siqh",
    tone: "green",
  },
] as const;

export default function ResearchResultsHome() {
  return (
    <main className="portal-page">
      <header className="portal-header">
        <Link href="/" className="portal-brand" aria-label="基于多元因素影响的病原体跨尺度时空传播控制技术首页">
          <span>R</span>
          <strong>基于多元因素影响的病原体跨尺度时空传播控制技术</strong>
        </Link>
        <nav aria-label="成果导航"><a href="#results">研究成果</a><a href="#about">平台说明</a></nav>
      </header>

      <section className="portal-intro" id="about">
        <div>
          <p>RESEARCH OUTPUTS · COMPUTATIONAL MODELS</p>
          <h1>基于多元因素影响的病原体跨尺度时空传播控制技术</h1>
        </div>
        <p>集中呈现传播动力学与复杂网络社区检测研究。六项成果分别进入独立页面，参数、计算结果与方法说明互不混排。</p>
      </section>

      <section className="portal-results" id="results" aria-label="六项研究成果">
        {RESEARCH_RESULTS.map((result) => (
          <Link href={result.href} className={`portal-result-card ${result.tone}`} key={result.href}>
            <div className="portal-result-top"><span>{result.index}</span><small>{result.code}</small></div>
            <h2>{result.title}</h2>
            <p>{result.description}</p>
            <div className="portal-result-bottom"><span>{result.outputs}</span><b aria-hidden="true">进入成果 →</b></div>
          </Link>
        ))}
      </section>

      <footer className="portal-footer"><strong>基于多元因素影响的病原体跨尺度时空传播控制技术</strong><span>传播动力学 · 分数阶系统 · 复杂网络</span></footer>
    </main>
  );
}
