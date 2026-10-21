import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(root, "docs");
const html = await readFile(path.join(output, "index.html"), "utf8");
const titles = {
  malaria: "疟疾传播动力学",
  svir: "双毒株 SVIR",
  sir: "随机分数阶 SIR",
  roasnmf: "鲁棒自适应社区检测",
  masnmf: "模块度约束社区检测",
  siqh: "时滞分数阶疫情控制",
};
for (const [route, title] of Object.entries(titles)) {
  const directory = path.join(output, route);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "index.html"), html.replace("<title>基于多元因素影响的病原体跨尺度时空传播控制技术</title>", `<title>${title}｜基于多元因素影响的病原体跨尺度时空传播控制技术</title>`));
}
await writeFile(path.join(output, "404.html"), html);
await writeFile(path.join(output, ".nojekyll"), "");
console.log("静态发布目录已生成：首页 + 六个独立入口 + 404 页面，所有资源使用仓库子路径。");
