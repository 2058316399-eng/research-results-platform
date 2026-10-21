# 研究成果展示平台

六项研究成果独立展示：疟疾传播动力学、双毒株 SVIR、随机分数阶 SIR、鲁棒自适应社区检测、模块度约束社区检测和时滞分数阶疫情控制。

这是原网页的 GitHub Pages 静态发布版本，保留页面设计、参数说明、完整入参/返回数据和实际数值计算。计算在访问者浏览器中执行，无需登录，不依赖私有后台或 MATLAB 服务；模型求解实现见 `src/app/*model*.ts`。页面和数据仅用于研究演示，不作为临床或公共卫生决策依据。

## 发布配置

- 仓库名：`research-results-platform`（公开仓库）。
- GitHub 仓库 Settings → Pages → Build and deployment → Source 选择 **Deploy from a branch**。
- Branch 选择 **main**，目录选择 **/docs**，保存。
- 网站入口：`https://<GitHub账号>.github.io/research-results-platform/`。
- 六个模块有独立 `index.html`，路径为 `/malaria/`、`/svir/`、`/sir/`、`/roasnmf/`、`/masnmf/`、`/siqh/`，支持直接访问和刷新。

不需要额外服务器或付费套餐。GitHub Pages 的大陆访问速度及可用性受网络环境影响，不能保证所有网络随时可达。大规模参数计算会占用访问设备资源，移动设备请先使用默认参数。

## 后续更新

安装 Node.js 22.13 或更高版本后，在仓库目录执行：

```sh
npm ci
npm run build
npm run check
```

修改 `src/` 后重新构建，构建命令会自动更新 `docs/` 下的首页、六个静态入口和图片资源。将修改后的源码和 `docs/` 一起提交并推送至 `main`，GitHub Pages 会自动发布，无需在 GitHub 修改发布源。

```sh
git add src scripts public index.html vite.config.ts tsconfig.json package.json package-lock.json README.md docs
git commit -m "Update research results platform"
git push origin main
```

可选本地预览：`npm run dev`，或构建后执行 `npm run preview`，使用终端输出的 `/research-results-platform/` 入口。请勿仅双击 HTML 文件，ES 模块需通过 HTTP 服务打开。

如仓库名改变，请同时修改 `vite.config.ts` 的 `base` 为 `/<新仓库名>/` 并重新构建。如改为用户主页仓库或绑定独立域名，请改为 `base: "/"` 后重新构建；域名注册及 DNS 配置单独处理。

## 文件范围与隐私

本仓库仅包含网页必要源码、依赖锁文件、发布脚本、9 张模型基准图及静态构建产物。不含密码、验证码、访问令牌、用户证件、委托书、测试报告、软著申请材料、聊天文件、服务端鉴权代码或本机路径。浏览器中的参数和计算结果不会上传服务器；下载 JSON 由浏览器直接生成。请勿在未来提交中加入 `.env`、私钥或私人文档。

## 第三方依赖

运行时使用 React/React DOM；构建使用 Vite、TypeScript 和 Tailwind CSS 等。各依赖版权和许可见对应 npm 包。仓库公开不等于对模型代码另行授予开源许可；未经权利人许可，不应擅自改变授权方式或添加开源许可证。
