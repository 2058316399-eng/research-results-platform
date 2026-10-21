import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(root, "docs");
const routes = ["", "malaria", "svir", "sir", "roasnmf", "masnmf", "siqh"];
for (const route of routes) {
  const html = await readFile(path.join(output, route, "index.html"), "utf8");
  assert(html.includes('<div id="root"></div>'), `${route || "首页"} 缺少 React 入口`);
  const assets = [...html.matchAll(/(?:src|href)="(\/research-results-platform\/[^"#]+)"/g)].map(match => match[1]);
  assert(assets.length >= 2, "脚本或样式路径缺失");
  for (const url of assets) await readFile(path.join(output, url.replace("/research-results-platform/", "")));
  assert(!html.includes('src="/assets/'), "资源路径未适配仓库前缀");
}
const images = await readdir(path.join(output, "siqh"));
assert.equal(images.filter(name => name.endsWith(".png")).length, 9, "基准图片应为 9 张");
await readFile(path.join(output, ".nojekyll"));
await readFile(path.join(output, "404.html"));
const copiedPage = await readFile(path.join(root, "src/app/xu/page.tsx"), "utf8");
for (const phrase of ["完整入参样例", "实际返回数据", "字段与用法说明", "数组不截断"]) assert(copiedPage.includes(phrase));
const allFiles = [];
async function walk(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".git"].includes(item.name)) continue;
    const file = path.join(directory, item.name);
    if (item.isDirectory()) await walk(file);
    else allFiles.push(file);
  }
}
await walk(root);
assert(!allFiles.some(file => /\.(docx?|pdf|zip|pem|key)$/i.test(file) || /(?:^|[\\/])\.env/.test(file)), "发布目录出现非白名单私人材料或密钥文件");
console.log(`发布完整性检查通过：7 个入口，9 张图片，${allFiles.length} 个文件，资源均使用仓库子路径。`);
