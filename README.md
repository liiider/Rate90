# Rate90

无剧透足球回看评分站。按联赛和轮次挑比赛，查看观赏分、推荐理由和首发阵容。日期按北京时间定位到对应轮次。已完赛比赛可点击「去看」打开咪咕体育主页，并写入当前浏览器的「看过」。可以在「看过」中撤销记录。

后端使用的 `data/` 和 `.env.local` 保存在本地与 Linux。新检出的工作目录要运行采集、重建或数据回归测试时，请先从自己的备份恢复 `data/`，并单独配置 BSD 密钥。正式前端读取 `public/ui/data/` 下的发布快照。

## 打开站点

- **直接使用**　保留整个 `public/` 目录，双击 `public/index.html`。球队图标、评分与详情都随站点提供。
- **本地服务**　使用 Node.js 22.9 或更高版本，在项目根目录运行 `npm start`，打开 <http://127.0.0.1:3000>。比赛日接口随服务启动。
- **Vercel 静态部署**　本地采集器将比赛资料写入 SQLite，按 Rate90 规则计算评分，生成 `public/ui/data/` 快照。Vercel 发布 `public/`，入口为 `index.html`。家用采集器生成新快照后，发布服务会推送到 GitHub 的 `main`，由 Vercel 更新正式站。
- **制作交付包**　用 Python 3 运行 `python3 scripts/package-static.py`（Windows 可用 `py -3 scripts/package-static.py`），生成 `dist/Rate90-static.zip`。解压后直接打开 `index.html`。

## 发布到 Vercel

在项目根目录运行 `npx vercel` 创建预览，首次按提示登录并关联 Rate90 项目。项目根目录选当前目录，仓库里的 `vercel.json` 指定静态输出为 `public/`。预览通过后运行 `npx vercel --prod` 发布正式站。

## 家用 Linux 自动采集与发布

在 Mac 项目目录双击 `dist/deploy-home-collector.command`。从仓库检出的同一入口在 `deploy/deploy-home-collector.command`。首次安装使用项目的 BSD 密钥与已有赛季数据库，自动检查 Linux 架构、Node.js 和后台运行方式。服务器生成本仓库专用的 SSH 发布密钥。Mac 上已授权的 GitHub CLI 会登记公钥，也可以按窗口提示在仓库的 Deploy keys 页面勾选 **Allow write access**。成功时显示 `RATE90_PUBLISHER_ACTIVE`。

每次采集完成，发布服务读取新索引，将它与引用的比赛日详情、预览作为一次提交推送。后台每 5 秒检查一次文件变化；推送失败后 1 分钟重试。正式域名返回相同索引后记录 `RATE90_LIVE`。如 Vercel 持续返回旧索引，20 分钟后重新触发部署并逐步延长重试间隔。

Linux 使用 systemd 用户服务时，运行 `journalctl --user -u rate90-publish -n 30 --no-pager` 查看发布记录。使用 cron 时，日志位于 `~/.local/share/rate90-publish/publish.log`。

## 单独在 macOS 运行采集器

在项目根目录的 `.env.local` 配置 `BSD_API_TOKEN`，运行 `npm run collect:install`。采集器随后在当前 Mac 用户登录时自动运行，复用 `data/collector/rate90.sqlite`，更新 `public/ui/data/`。将新数据发布到线上时，在项目根目录重新运行 `npx vercel --prod`。

用 `launchctl print gui/$(id -u)/com.rate90.collector` 查看运行状态，日志在 `~/Library/Logs/Rate90/`。卸载时先运行 `launchctl bootout gui/$(id -u)/com.rate90.collector`，再删除 `~/Library/LaunchAgents/com.rate90.collector.plist`。

## 当前数据

截至北京时间 2026 年 11 月 23 日，六项赛事本赛季有 707 场已完赛，617 场已有 Rate90 观赏分。90 场欧冠资格赛和附加赛缺少完整逐脚数据，评分显示「—」。

首页默认展示全部赛事，按赛事和轮次分组，轮内按分数排序。日期跳转展开当天涉及的所有整轮，休赛日取此前最近的比赛日。轮次跳转可跨赛事查看同一轮，也可先选一项赛事。列表用图标标出推荐理由，详情说明每个理由。

## 维护与复核

| 命令 | 用途 |
| --- | --- |
| `npm test` | 检查评分、采集、发布、离线数据与本地服务入口 |
| `npm run test:ui` | 运行页面交互回归。首次可用 `npm install --no-save --package-lock=false jsdom@26` 安装测试所用的 DOM 环境 |
| `npm run verify:round` | 从本轮 66 份 BSD 原始响应复算完赛覆盖和评分 |
| `npm run build:snapshot` / `npm run collect -- --publish-only` | 依次用本地归档和 SQLite 重算两份静态快照 |
| `npm run fetch:round` | 使用 `BSD_API_TOKEN` 刷新本轮原始响应 |
| `npm run collect:season` | 本地逐项扫描本赛季至北京时间今天的赛程并回填已完赛详情，支持中断后续跑 |
| `npm run collect` / `npm run collect:watch` | 执行一轮采集 / 启动持续采集 |

离线重建读取 `data/round-tests/pl11-ll13-sa12-bl10-l111-cl4/` 中的 `manifest.json` 与 `events/`。随项目交接的 `Rate90-20261122-195044.zip` 可以解压到该目录。在线采集从进程环境或本机 `.env.local` 读取凭据，队列存放在 `data/collector/`。

[比赛接口和评分公式](docs/matches-api.md) · [前端入口与数据结构](docs/frontend.md)

## 0.2 赛前选场

轮次下拉框中的「下一轮」「下下轮」展示所选赛事的完整对阵。选择「全部赛事」可同时看各赛事的对应轮次，日期选择器按北京时间查看当天赛程，包含当前轮剩余比赛。首次离线快照中，五大联赛第二个完整轮次使用 OpenFootball 的 2026–27 赛程，未给开球时间的比赛标记为时间待定。常规采集按 BSD 当季赛程替换离线对阵。

采集器保存同赛事近六场双方射门、非点球 xG、分时段机会，以及可获得的积分形势、首回合比分、跨赛事赛程和伤停观察。伤缺名单保留供应商的状态和预计回归日期。SQLite 中保存实际发送的赛前材料、模型名、生成时间和推荐结果。网站按日期或整轮展示首选和次选。

模型为 `gpt-6.2-sol`，使用 OpenAI Responses API。采集服务器的 `.env.local` 读取 `OPENAI_API_KEY` 或 `RATE90_AI_KEY`。如使用兼容网关，将 `RATE90_AI_BASE_URL` 配置到包含版本号的 API 根地址。仅配置 BSD 时，未来赛程照常更新。预览文件通过现有发布器随索引更新。

[离线赛程来源](https://github.com/openfootball/football.json/tree/master/2026-27)
