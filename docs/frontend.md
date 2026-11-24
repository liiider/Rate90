# Rate90 前端协作

`public/index.html` 支持直接打开，也可通过 `npm run dev` 在本地访问。首页与轮次页读取静态数据，实时比赛日接口单独提供服务。

| 内容 | 入口或文件 | 数据 |
| --- | --- | --- |
| 高分榜 | `/` | 按展示评分排序，可筛选赛事、轮次范围及最低分 |
| 比赛周 | `/?view=round&league=pl` | 欧冠和五大联赛各三个轮次 |
| 原始快照 | `public/ui/data/fixtures.js` | 比赛 ID、轮次、双方球队和 MustWatch90 参考分 |
| 自动采集 | `public/ui/data/collected-index.js` 与 `collected/` | 赛程、已采集评分及按需读取的比赛日详情 |
| 样本过程分 | `public/ui/data/process-ratings.js` | 由后端生成的比赛 ID、看球日、Rate90 评分及算法版本 |
| 队名与队徽 | `public/ui/data/teams.js`、`public/ui/crests/` | 球队 ID、英文名与中文显示名 |
| 揭晓 | `public/ui/catalog.js` | 按需读取比分和对应比赛日的分段数据与推荐依据 |

赛季快照采集于 2026-11-22。榜单合并最新赛程和原始快照，优先使用已采集的 Rate90 过程分，再使用样本过程分或 MustWatch90 参考分。单场详情注明评分来源。初始列表只加载赛程、评分与队名，用户揭晓后加载 `results.js` 和对应比赛日的详情。队徽取自原站使用的 BSD Sports 图片，赛事标识来自原站可见的赛事图片。中国大陆观看入口使用详情列出的平台首页。

更新算法或 BSD 样本后执行 `node scripts/build-offline-sample.mjs`，再执行 `npm test`。实时接口、固定算法和评分明细见 [比赛接口](matches-api.md)。

`public/world-cup-2022.html` 保留世界杯历史样本，可从「关于 Rate90」进入。
