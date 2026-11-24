# Rate90

无剧透足球回看评分站。按联赛和轮次挑比赛，查看观赏分、推荐理由和首发阵容。日期按北京时间定位到对应轮次。已完赛比赛可点击「去看」打开咪咕体育主页，并写入当前浏览器的「看过」。可以在「看过」中撤销记录。

## 打开站点

- **直接使用**　保留整个 `public/` 目录，双击 `public/index.html`。球队图标、评分与详情都随站点提供。
- **本地服务**　使用 Node.js 22.9 或更高版本，在项目根目录运行 `npm start`，打开 <http://127.0.0.1:3000>。比赛日接口随服务启动。
- **Vercel 静态部署**　本地采集器将比赛资料写入 SQLite，按 Rate90 规则计算评分，生成 `public/ui/data/` 快照。Vercel 发布 `public/`，入口为 `index.html`。本地更新快照后，重新部署即可更新线上数据。
- **制作交付包**　用 Python 3 运行 `python3 scripts/package-static.py`（Windows 可用 `py -3 scripts/package-static.py`），生成 `dist/Rate90-static.zip`。解压后直接打开 `index.html`。

## 发布到 Vercel

在项目根目录运行 `npx vercel` 创建预览，首次按提示登录并关联 Rate90 项目。项目根目录选当前目录，仓库里的 `vercel.json` 指定静态输出为 `public/`。预览通过后运行 `npx vercel --prod` 发布正式站。

## 在本机部署采集器（macOS）

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
