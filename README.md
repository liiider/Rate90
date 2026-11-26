# Rate90

Rate90 帮你在知道比分之前挑一场值得回看的足球比赛。可以按日期、赛事或轮次浏览五大联赛和欧冠，先看观赏分和推荐理由，再打开详情查看阵容。比赛数据、比赛动态和战术分析按场次、按标签分别解锁。[打开 Rate90](https://r90.liderrr.cc)

Rate90 is a spoiler-free football replay guide for the Champions League and Europe's top five leagues. Compare watchability ratings, discover pre-match recommendations and explore each coach's tactical decisions after the match. [English replay guide](https://r90.liderrr.cc/en/).

## 双语内容与搜索指南

- 赛前推荐和战术复盘同步输出中英文，共用推荐结果、评分和节点。已有中文复盘由日常采集任务逐批补齐英文译文。
- 英文搜索指南（`/en/`）提供周末推荐、赛事、球队及五大联赛赛季观赏性榜单。发布器使用当期公开评分快照生成静态页面、`sitemap.xml` 和 `robots.txt`，与数据一同发布。
- 本地可运行 `python3 deploy/seo_pages.py` 预览搜索指南。正式域名使用 Cloudflare Web Analytics 记录访问，离线预览不发送统计。

## v0.2.1 中英文前端 · 2026-11-25

右上角可切换中文和英文，浏览器会记住选择。赛事、球队、阵容、技术统计和比赛动态随之切换。此版本 AI 推荐理由和战术复盘正文为中文。

[GitHub Release](https://github.com/liiider/Rate90/releases/tag/v0.2.1) · [战术复盘出稿对照](docs/tactical-review-evaluation.md)

## v0.2.0 更新 · 2026-11-25

- **赛前选场**。可按北京时间查看某天的对阵，也可在轮次选择器里查看未来两个完整轮次。单项赛事显示实际轮名，全部赛事按联赛分组。
- **AI 推荐**。Linux 采集器调用 OpenAI `gpt-6.2-sol`，结合两队同赛事近六场的射门、机会分布和可用的赛前资料，每组选择零至两场并给出理由。前端从静态快照展示「强烈推荐」「值得一看」，并区分已评估但无推荐和等待评估。
- **赛后回看**。评分规则升级至 `rate90-1.2.0`，增加「值得看集锦」标签。首发和替补按主客队分栏展示。确认展开后可并排比较技术统计，按分钟查看换人和出牌。
- **数据更新**。采集端支持增量归档、从 SQLite 重建展示快照，并将赛前评估随比赛日索引一起发布。
- **战术复盘**。比赛详情可单独展开比赛数据、比赛动态和战术分析。在战术分析中切换主客队，按时间查看各自的教练决策和点评。有可用比赛资料且后端已接通 AI 时生成，完成一方即可展示一方。
- **已有部署升级**。在 Mac 上运行 `./deploy/update-linux.command --code-only user@host`，沿用 Linux 上的数据库、密钥和采集进度。战术复盘从本次启用的轮次开始，手动补录会复用已有结果。

[GitHub Release](https://github.com/liiider/Rate90/releases/tag/v0.2.0)

## 本地预览

下载或克隆仓库，保留 `public/` 的目录结构，直接打开 `public/index.html` 即可离线浏览。页面使用仓库附带的评分快照，无需 API 密钥、数据库或构建步骤。

要通过 HTTP 预览或使用比赛日接口，请安装 Node.js 22.9 或更高版本，然后在仓库根目录启动服务。

```sh
npm start
```

浏览器打开 <http://127.0.0.1:3000>。比赛日接口和可选查询参数见[接口文档](docs/matches-api.md)。

## 部署静态站

将 `public/` 的内容发布到静态托管服务即可。使用 Vercel 时，将自己的仓库关联到自己的 Vercel 项目，项目根目录选择仓库根目录。[vercel.json](vercel.json) 已将输出目录设为 `public/`，安装和构建命令均留空。

需要离线分发时，运行 `python3 scripts/package-static.py`（Windows 可用 `py -3 scripts/package-static.py`），解压生成的 `dist/Rate90-static.zip` 后打开 `index.html`。

## 自行采集和更新

正式站的 Linux 服务器每天北京时间 09:45 增量归档 BSD 数据。采集服务按赛程检查比赛，覆盖范围内的新比赛完赛且资料就绪后，为主客队分别生成战术复盘。已生成的一方会被跳过。发布服务把新快照推送到 GitHub 的 `main` 分支，正式站随之更新。

1. 在项目根目录创建 `.env.local`，写入 `BSD_API_TOKEN=<你的 BSD API 密钥>`，将占位符替换为自己的密钥。也可以通过进程环境提供同名变量。
2. 新安装且没有历史样本时，创建 `data/` 目录和 `data/bsd-sample.json` 文件，文件内容为 `{"matches":[]}`。已有样本的安装直接沿用原文件。
3. 运行 `npm run collect` 执行一轮采集，或运行 `npm run collect:watch` 按赛程持续更新。采集器把队列和比赛记录写入 `data/collector/rate90.sqlite`，重启后从已有进度继续。Linux 的 systemd 配置见[采集器运行说明](docs/matches-api.md#按赛程自动采集)。macOS 用户配置好 `.env.local` 并安装 Python 3 后，可运行 `npm run collect:install` 让采集器随用户登录启动。
4. 要让自托管网站自动跟进，配置自己的发布任务监测 `public/ui/data/collected-index.js`。索引更新后，将新索引及其引用的文件作为同一版本发布到自己的静态站点。使用 Git 自动部署时，提交目标为自己仓库关联的部署分支。

仓库中的 `public/ui/data/` 保存计算后的展示快照。原始比赛资料、SQLite 和 `.env.local` 由采集端保存。公开分发只需 `public/`。

## 开发与复核

| 命令 | 用途与所需数据 |
| --- | --- |
| `npm run test:ui` | 验证页面交互。首次运行可用 `npm install --no-save --package-lock=false jsdom@26` 安装测试依赖 |
| `npm test` | 运行后端和数据回归测试。完整复现需要固定样本和对应轮次的原始归档 |
| `npm run fetch:round` / `npm run verify:round` | 使用 BSD 密钥抓取测试轮次。之后可用归档中的 `manifest.json` 和 `events/` 离线复算 |
| `npm run build:snapshot` | 用固定样本和轮次归档重建静态快照 |
| `npm run collect -- --publish-only` | 从已有 SQLite 记录重新生成采集快照 |
| `npm run collect:season` | 扫描本赛季并回填已完赛比赛，支持中断后继续 |

[前端入口与快照结构](docs/frontend.md) · [比赛接口与评分公式](docs/matches-api.md) · [文档贡献指南](CONTRIBUTING.md)

## 0.2 赛前选场

选择单项赛事时，轮次下拉框显示未来两个整轮的实际轮名。选择「全部赛事」时，「即将开赛」和「后续赛程」分别展示各赛事未来第一个和第二个整轮，日期选择器按北京时间查看当天赛程，包含当前轮剩余比赛。首次离线快照中，五大联赛第二个完整轮次使用 OpenFootball 的 2026–27 赛程，未给开球时间的比赛标记为时间待定。常规采集按 BSD 当季赛程替换离线对阵。

采集器取两队各自在同赛事最近六场的射门、非点球 xG 和分时段机会，统计有多少场双方都制造过威胁、上下半场都有机会、末段仍有攻势。只有两队各有至少一场可用的射门记录，对阵才进入 AI 候选。模型结合主客场、对手、积分形势、首回合、休息时间和伤停，按整轮或所选日期的赛事范围推荐零至两场，并说明值得看全场的具体对位。SQLite 保存实际发送的材料、提示词版本、模型名、生成时间和结果。

模型为 `gpt-6.2-sol`，通过 OpenAI Responses API 调用。启用时，在采集端已有的 `.env.local` 中添加 `RATE90_AI_KEY=<OpenAI 项目密钥>`，保留原有的 `BSD_API_TOKEN`。默认地址为 `https://api.openai.com/v1`，也支持环境变量 `OPENAI_API_KEY`。使用兼容网关时，可用 `RATE90_AI_BASE_URL` 指定包含版本号的 API 根地址。

Linux 上已运行 systemd 用户采集服务时，可在仓库根目录运行 `python3 deploy/configure-openai.py`，按提示输入密钥。工具先验证网络，再向模型发送一次请求，成功后保存配置、重启服务并等候新评估。手动编辑配置时，运行 `systemctl --user restart rate90-collector.service` 载入设置。

如果只有 Docker 桥接网络能访问 OpenAI，可选用独立的 Rate90 容器转发 TLS 流量。将下面的 `existing-container` 替换为已验证能连接 OpenAI 的容器名。工具复用其本地镜像（需包含 Python 3.8+ 和 curl）及桥接网络，密钥仍由宿主机上的 Node 读取。

```sh
socket=$(python3 deploy/openai-network.py existing-container) &&
  python3 deploy/configure-openai.py --socket "$socket"
```

用 `journalctl --user -u rate90-collector.service -f` 查看采集日志。`prematch.picks` 统计已有评估的比赛分组数，每组可以推荐零场。静态站从索引的 `prematchFile` 加载已发布的结果，浏览页面不会触发模型调用。

[离线赛程来源](https://github.com/openfootball/football.json/tree/master/2026-27) · [赛前页面开发说明](docs/frontend-dev-handoff.md)
