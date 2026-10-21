import { createRoot } from "react-dom/client";
import Home from "./app/page";
import Malaria from "./app/malaria/page";
import { StandaloneResearchModule } from "./app/xu/page";
import { SiteLink, siteBase } from "./static/navigation";
import "./app/globals.css";

const modules = {
  svir: "双毒株 SVIR",
  sir: "随机分数阶 SIR",
  roasnmf: "鲁棒自适应社区检测",
  masnmf: "模块度约束社区检测",
  siqh: "时滞分数阶疫情控制",
} as const;

const pathname = decodeURI(window.location.pathname);
const relativePath = pathname.startsWith(siteBase) ? pathname.slice(siteBase.length) : pathname.replace(/^\//, "");
const route = relativePath.replace(/(?:\/index\.html|index\.html)$/, "").replace(/^\/+|\/+$/g, "");

function CurrentPage() {
  if (!route) return <Home />;
  if (route === "malaria") return <Malaria />;
  if (route in modules) return <StandaloneResearchModule module={route as keyof typeof modules} />;
  return <main className="portal-page"><h1>未找到页面</h1><p><SiteLink href="/">返回基于多元因素影响的病原体跨尺度时空传播控制技术首页</SiteLink></p></main>;
}

const title = route === "malaria" ? "疟疾传播动力学" : modules[route as keyof typeof modules];
document.title = title ? `${title}｜基于多元因素影响的病原体跨尺度时空传播控制技术` : "基于多元因素影响的病原体跨尺度时空传播控制技术";
const root = document.getElementById("root");
if (!root) throw new Error("页面缺少应用入口");
createRoot(root).render(<CurrentPage />);
