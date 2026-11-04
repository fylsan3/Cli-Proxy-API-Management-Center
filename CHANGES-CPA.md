# CPA 面板二开说明

本分支 `feat/oauth-proxy-url` 基于官方 [Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center) `v1.27.2`（`f154fa9`）修改。
以下是全部改动，以及安装时必须做的一步：**关闭面板自动更新**。

---

## 一、改了什么

### 1. 品牌改为 CPA

| 位置 | 原来 | 现在 |
|---|---|---|
| 侧边栏左上角缩写（`title.abbr`，7 个语言） | CPAMC | CPA |
| 侧边栏副标题（`sidebar.subtitle`） | CLI Proxy API 管理控制台 | API 管理控制台（英文 API Console，其余语言同义） |
| 浏览器标签页标题（`index.html`、`src/main.tsx`） | CLI Proxy API Management Center | CPA |
| 侧边栏品牌悬停提示（`MainLayout.tsx` 的 `fullBrandName`） | CLI Proxy API Management Center | CPA |
| 登录页品牌名（`LoginPage.tsx` 的 `LOGIN_BRAND_NAME`） | CLI Proxy API Management Center | CPA |
| 登录页欢迎语（`DotMatrixHero.tsx` 的 `HERO_TITLE`） | Welcome to CLI Proxy API. | Welcome to CPA. |
| logo 图片替代文字 | CPAMC logo | CPA logo |

> 报错提示里的「请升级 CLI Proxy API」等文字说的是后端程序名，没有改。

### 2. 隐藏三个菜单

`src/components/layout/MainLayout.tsx` 中新增开关：

```ts
const HIDE_NAV_ITEMS = { quickStart: true, plugins: true, pluginStore: true } as const;
```

- 侧边栏不再显示「快速开始」「插件管理」「插件商店」。
- **只隐藏菜单，路由还在**。改回 `false` 即可恢复官方菜单。

### 3. 「中心信息」改为「模型信息」

- 菜单名和页面标题改为「模型信息」（繁体「模型資訊」，英文 Model Info）。
- `src/pages/SystemPage.tsx` 只保留「可用模型列表」：按厂商分组，带刷新按钮。
- 移除版本信息、快捷链接、清除登录缓存、请求日志（点版本号 7 次的隐藏入口）。

### 4. OAuth 登录增加会话代理（非必填）

目的：一个账号从**授权、换取 token、调用到刷新**，全程走同一个代理；不填就全程直连，同样一致。避免「授权走直连、调用走代理」这种只配了一半的情况。

| 文件 | 改动 |
|---|---|
| `src/services/api/oauth.ts` | `startAuth(provider, proxyUrl?, signal?)`：请求由 **GET 改为 POST**，代理放在请求正文的 `proxy_url` 里（后端只读正文，放在 URL 参数里会被忽略）。去掉首尾空格后为空就**不发这个字段**（发空串会被后端当成"继承全局配置"） |
| `src/features/oauth/hooks/useOAuthFlows.ts` | 透传代理，并记下本次所用代理，供界面显示 |
| `src/features/oauth/OAuthPage.tsx` | **打开弹窗不再自动开始授权**，先填（或留空）代理再点「开始」；代理按提供商分别暂存，只在页面内存里，不写本地存储；点「再登录一个账号」会清空代理 |
| `src/features/oauth/components/OAuthFlowDialog.tsx` | 初始页和失败页新增「会话代理（可选）」输入框，提示文字 `socks5h://host:port（可留空，留空则全程直连）`；授权过程中顶部显示「本次登录全程走代理：xxx」或「未填代理：全程直连」 |
| `OAuthFlowDialog.module.scss` | 新增 `.proxyField` 样式 |
| 7 个语言文件 | 新增 `auth_login.proxy_label / proxy_placeholder / proxy_hint / proxy_in_use / proxy_direct` |

**没有改：** 提交回调（`submitCallback`）、客户端指纹、请求头、后端 Go 代码。

### 5. 测试

- `managementV8Api`、`kimiOAuth`、`devinOAuthApi`、`metaOAuthProvider` 四个测试由断言 GET 改为断言 POST。
- 新增两条：填了代理 → 正文带 `proxy_url`；只填空格 → 正文没有 `proxy_url`。
- `loginForm` 测试的品牌名断言改为 `CPA`。
- 结果：`type-check` ✅、`lint` ✅、`bun test` 1870 通过 / 0 失败、`build` ✅。

### 6. 代理出口检测（OAuth 登录前 + 编辑代理保存前）

目的：CPA 后端遇到**格式写错**的代理地址时，不报错而是静默退回直连。面板在把代理交给后端之前先测一次，测不过就不让用。

**检测方法**（`src/features/oauth/proxyEgressCheck.ts`）：经 CPA 的 `/v8/management/requests/api-call` 访问 `https://ipinfo.io/json` 两次，都**不带** `auth_index`：

1. 不带代理 → 得到 CPA 服务器本机出口 IP（基准）；
2. 带代理 → 得到代理出口 IP。

以下任一情况都拦截：

| 原因 | 说明 |
|---|---|
| `invalid` | 地址格式不对。只接受 `socks5://` / `socks5h://` + 主机 + 端口(1–65535)，不允许路径/参数，与 New API `ValidateSocksProxyURL` 同口径。不发任何请求 |
| `baseline_failed` | 拿不到本机 IP，无法对比 |
| `unreachable` | 走代理请求失败（含 CPA 返回 502、代理返回 407 等） |
| `bad_response` | 返回内容里没有 IP |
| `same_ip` | 两次 IP 相同 = 代理没生效、实际直连了 |

单次请求超时 20 秒。

**接入点：**

| 文件 | 改动 |
|---|---|
| `src/features/oauth/OAuthPage.tsx` | 点「开始」时：填了代理先检测，通过才 `startAuth`；留空照旧直接开始。改代理会作废上一次的检测结果 |
| `src/features/oauth/components/OAuthFlowDialog.tsx` | 显示「检测中 / 通过（出口 IP + 地区）/ 失败原因」；检测中禁用开始按钮 |
| `src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor.ts` | 保存前若 `proxy_url` 非空先检测，失败提示「代理未保存」并中止；清空代理不拦截 |
| 7 个语言文件 | 新增 `auth_login.proxy_check_*` 共 8 个键 |
| `tests/proxyEgressCheck.test.ts` | 8 个测试覆盖上表全部分支 |

**限制：**

- 依赖 `ipinfo.io` 可访问；它不可用时会误拦（宁可拦错，不放过）。
- 每次检测会让 CPA 服务器本机直连 `ipinfo.io` 一次（拿基准 IP），只暴露给 ipinfo，与 Anthropic 无关。
- 只防面板操作。直接改凭证文件或直接调后端接口改 `proxy_url`，不经过这个检测。
- 结果：`type-check` ✅、`lint` ✅、`bun test` 1878 通过 / 0 失败、`build` ✅。

---

## 二、安装

### 第 1 步：关闭面板自动更新（必须先做）

CPA 默认会定期从 GitHub 下载官方面板，**覆盖** `static/management.html`。不关的话，换上去的二开面板过一阵就会被还原。

编辑 CPA 的 `config.yaml`，在 `management:` 下加上或改成：

```yaml
management:
  disable-auto-update-panel: true   # true = 不再自动下载官方面板
```

> v8 的键名是 `management`；旧版的 `remote-management` 是 v7 写法，不要用。
> `management:` 下已有的其他项（如 `secret-key`、`allow-remote`）保持原样，只加这一行。

改完**重启 CPA** 才生效。确认方法：重启后看日志里不再出现 `management asset downloaded` 之类的下载记录。

### 第 2 步：构建

```bash
git clone git@github.com:fylsan3/Cli-Proxy-API-Management-Center.git cpa-panel
cd cpa-panel
git switch feat/oauth-proxy-url
bun install
bun run build          # 产物：dist/index.html（单文件）
```

### 第 3 步：备份并替换

```bash
cp <CPA目录>/static/management.html <CPA目录>/static/management.html.bak
cp dist/index.html <CPA目录>/static/management.html
```

浏览器强制刷新面板即可，不需要重启 CPA。

### 回滚

```bash
cp <CPA目录>/static/management.html.bak <CPA目录>/static/management.html
```

如果想回到官方面板并恢复自动更新，再把 `disable-auto-update-panel` 改回 `false` 并重启。

### 关掉自动更新的代价

- 面板从此不会自己升级。官方出新版时，按下面同步后重新 build、重新替换。

```bash
git fetch upstream
git switch main && git merge upstream/main
git switch feat/oauth-proxy-url && git rebase main
bun run build
```
