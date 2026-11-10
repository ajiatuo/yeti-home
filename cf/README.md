# cf/ — Cloudflare 部署层（本 fork 自加）

把 yeti-home 部署到 Cloudflare Workers 的全部家当。线上站点：
**https://home.awaker.edu.kg/**（Worker `awaker-home`，自定义域精确绑定）

## 文件

- `worker.js` — 原项目 `gatekeeper/` + `demo/demo-server.py` 的 Worker JS 移植版：
  双身份登录（HMAC 签名 cookie `gk_token`，口令为仓库公开演示口令 `demo`）、
  `/yeti`（admin）与 `/yuki`（user）门禁、生活 API（随手记/纪念日/博客草稿，
  存 Cloudflare KV `awaker-home-data`）、天气快照与硬件状态为虚构演示数据。
  登录页模板在部署时从 `gatekeeper/gatekeeper.py` 的 `LOGIN_HTML` 注入
  （`worker.js` 里的 `/*__LOGIN_HTML__*/""` 是占位符，不要手工填）。
- `deploy_home.py` — 一键部署：建/查 KV → 上传 `site/` 全部静态资源 →
  部署 Worker（Assets + KV + GK_SECRET 绑定）→ 绑定自定义域。
  - **铁律：assets 配置必须带 `run_worker_first: true`**，否则静态资源绕过
    Worker、登录门禁失效（2026-11-10 首版实测）。
  - `GK_SECRET` 每次部署在进程内随机生成、只作为 plain_text 绑定传给 Worker，
    不落盘；代价是每次重新部署后旧登录态失效，需要重新登录一次。
  - 凭据走 Muse 的安全凭据代理（`custom.cloudflare-deploy2`），脚本里没有明文 Token。

## 工作流程（本仓库约定）

1. 改代码 → 先 commit 到本仓库（GitHub 即备份与版本历史）
2. 再部署：`python3 cf/deploy_home.py all`（从已提交的源码树部署）
3. 回滚：`git revert <坏提交>` 或 checkout 旧版本 → 重新跑部署脚本，几分钟回到旧版

## 已知边界

- 硬件采集 `collector/`、定时任务后端未接入 Cloudflare 版本，页面上是演示数据
- 天气坐标是原仓库示例值（上海 31.23,121.47，地点名「云栖」）
- 许可：原项目代码 MIT；像素美术 CC BY-NC 4.0（个人使用，商用需联系原作者）
