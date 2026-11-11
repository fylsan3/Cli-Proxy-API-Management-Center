# CPA 管理面板 二开版

基于官方 [Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center) **v1.27.3** 二次开发，分支 `feat/oauth-proxy-url`。
配套后端：官方 CLIProxyAPI **v8.0.64**（程序原样未改，只换管理面板）。

原则：**只新增、不改原功能**。官方功能和用法不变，官方文档请看上游仓库。

- 最新版本：[v8.0.64-panel.dcc0ed8](https://github.com/fylsan3/Cli-Proxy-API-Management-Center/releases/tag/v8.0.64-panel.dcc0ed8)
- 详细技术说明：[CHANGES-CPA.md](./CHANGES-CPA.md)

---

## 我新增 / 修改了什么

### 1. 品牌改为 CPA

- 侧边栏缩写、浏览器标签页标题、登录页品牌名和欢迎语都改为「CPA」；侧边栏副标题改为「API 管理控制台」。

### 2. 精简菜单

- 隐藏「快速开始」「插件管理」「插件商店」三个菜单（只隐藏菜单，路由还在，可一键改回）。
- 「中心信息」改为「模型信息」，只保留按厂商分组的可用模型列表。

### 3. OAuth 登录可填会话代理（非必填）

- 打开登录弹窗不再自动开始授权，先填（或留空）代理再点「开始」。
- 填了代理：一个账号从授权、换 token、调用到刷新，**全程走同一个代理**；留空则全程直连。避免「授权直连、调用走代理」只配一半。
- 授权过程中顶部显示「本次登录全程走代理：xxx」或「未填代理：全程直连」。

### 4. 代理出口检测（防代理写错静默直连）

CPA 后端遇到格式写错的代理会悄悄改成直连。面板在把代理交给后端前先测一次：

- **检测时机**：OAuth 登录点「开始」前、编辑账号代理点「保存」前。
- **检测方法**：分别不走代理、走代理访问一次 `ipinfo.io`，对比两次出口 IP。
- **拦截情况**：地址格式不对（只接受 `socks5://` / `socks5h://` + 主机 + 端口）、代理连不上、拿不到 IP、两次 IP 相同（代理没生效）。
- 测不过：登录不开始、代理不保存，并显示原因。

### 5. 系统参数页面（新增菜单）

侧边栏「配置面板」下新增「系统参数」，菜单角标显示还有几项没按推荐设置。

- **推荐**（默认勾选）：关闭面板自动更新、会话粘性（1 小时）、用量统计、用量记录保留 1800 秒、冷却状态存盘等。
- **可选**（默认不勾）：TLS 握手超时、Claude 按模型冷却、流式保活、启动重试、日志总大小上限。
- **安全检查**（只检查不修改）：管理密钥不为空、全局代理为空、监听地址、请求日志 / debug / pprof 是否关闭。
- 一键应用勾选项，或每项单独「编辑」（开关 / 下拉 / 数字输入，带范围校验）。
- 应用前自动备份完整 config.yaml，只修改勾选的字段，其他配置一个不碰；可一键还原、可下载备份。CPA 自动热加载，不需要重启。

### 6. 对官方原有代码的改动

其余均为新增文件：

| 位置 | 改动 |
|---|---|
| `index.html`、`src/main.tsx`、`src/pages/LoginPage.tsx`、`src/pages/login/DotMatrixHero.tsx` | 品牌名改为 CPA |
| `src/components/layout/MainLayout.tsx` | 隐藏 3 个菜单、新增「系统参数」菜单 |
| `src/pages/SystemPage.tsx` | 「中心信息」改为「模型信息」 |
| `src/router/MainRoutes.tsx` | 新增系统参数路由 |
| `src/services/api/oauth.ts`、`src/features/oauth/*` | OAuth 会话代理、出口检测 |
| `src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor.ts` | 保存代理前做出口检测 |
| `src/i18n/locales/*` | 追加 7 种语言文案 |
| `tests/*` | OAuth 请求方式由 GET 改为 POST 的断言、品牌名断言 |

---

## 安装

### Mac mini（推荐用发布包）

从 [Releases](https://github.com/fylsan3/Cli-Proxy-API-Management-Center/releases) 下载 `cpa-macmini-<版本>.tar.gz`：

```bash
tar xzf cpa-macmini-<版本>.tar.gz && cd cpa-macmini
./install.sh --panel-only   # 只换面板（推荐，不重启，不影响正在跑的请求）
./install.sh                # 没装过：全新安装；装过：升级程序 + 面板
./install.sh --check        # 检查服务状态和「关闭面板自动更新」是否已设置
./install.sh --rollback     # 回滚到上一次升级前
```

换完面板后浏览器按 **Cmd+Shift+R** 强制刷新。脚本不会修改已有的 config.yaml。

**启动 / 停止 / 重启**（后台运行，关掉终端也不停，崩溃自动拉起，登录后自动启动）：

```bash
./start.sh          # 启动
./stop.sh           # 停止（--all 连终端前台跑的也关掉）
./restart.sh        # 重启
./status.sh         # 状态
```

源码在 [deploy/macos/](./deploy/macos/)，含「终端前台运行换成后台」的步骤。

### 手动安装

**第 1 步：关闭面板自动更新（必须）**。否则 CPA 会定期下载官方面板覆盖二开面板。在 `config.yaml` 的 `management:` 下加：

```yaml
management:
  disable-auto-update-panel: true
```

改完重启 CPA。

**第 2 步：构建并替换**

需要 **Bun 1.4.3**（与 `package.json` 中 `packageManager` 一致）。

```bash
git clone https://github.com/fylsan3/Cli-Proxy-API-Management-Center.git cpa-panel
cd cpa-panel && git switch feat/oauth-proxy-url
bun install && bun run build                   # 产物：dist/index.html
cp <CPA目录>/static/management.html <CPA目录>/static/management.html.bak
cp dist/index.html <CPA目录>/static/management.html
```

回滚：把 `management.html.bak` 复制回去即可。

### 说明

- 关闭自动更新后面板不会自己升级，官方出新版时需同步上游后重新构建。
- 许可证沿用上游 MIT，见 [LICENSE](./LICENSE)。
