# Rate90

Rate90 帮你在知道比分之前挑一场值得回看的足球比赛。可以按日期、赛事或轮次浏览五大联赛和欧冠，先看观赏分和推荐理由，再打开详情查看阵容、比赛统计和事件。「去看」打开咪咕体育主页，「看过」记录保存在当前浏览器。[打开 Rate90](https://r90.liderrr.cc)

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
