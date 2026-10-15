# luxra-beauty-ui

美容时尚 B2C 独立站 · 用户前台（Vue 3 单页面应用）。

> **品牌名说明**：仓库/包名里的 `luxra` 是**历史遗留的项目代号**，不是页面上的品牌名。
> 站上显示的品牌信息（名称、标语、主色、联系方式、版权）**全部**来自
> [`src/config/brand.ts`](src/config/brand.ts) 一处，默认值是中性占位符
> `BEAUTY STORE`。改品牌只改这一个文件，不需要全局搜索替换。

## 技术栈

- Vue 3.5.43 · TypeScript 6.0.3 · Vue Router 5.4.0
- Vite 8.3.4 · Vitest 5.0.3
- 样式：原生 CSS + CSS 自定义属性（**不使用** Tailwind / CSS-in-JS）

包管理器 pnpm 9.12.3（Corepack 激活，见 `packageManager` 字段），
Node 固定 22.22.2（`.node-version` + `engines` + `.npmrc` 的 `engine-strict=true`）。

## 快速开始

```bash
corepack pnpm install
corepack pnpm dev        # http://127.0.0.1:5175（端口见 .env）
corepack pnpm typecheck  # vue-tsc --noEmit
corepack pnpm test       # vitest run
corepack pnpm build      # 类型检查 + 生产构建
corepack pnpm preview    # 预览 dist
```

## 环境变量

见 `.env` / `.env.example`：

| 变量 | 说明 |
| --- | --- |
| `VITE_API_BASE_URL` | 后端地址，默认 `http://127.0.0.1:4100` |
| `VITE_USE_MOCK` | `true` 时用演示数据（界面显示「演示数据」角标）；联调请设 `false` |
| `VITE_APP_TITLE` | 仅作构建期兜底；页面标题实际取自 `BRAND.brandName` |
| `VITE_DEV_PORT` | 开发服务器端口，默认 `5175` |

## 页面

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 首页 | 主视觉、品类、精选、更多商品、询价制说明 |
| `/categories` | 商品分类 | ① 目标品类 ② 商品库真实分类（按 `parentId` 组树） |
| `/products` | 商品列表 | 支持 `q` / `category` / `page` 三个 URL 参数 |
| `/products/:slug` | 商品详情 | 图集、描述、加入询价清单、询价流程说明 |
| `/cart` | 询价清单 | 数量 +/− / 输入、移除、清空 |
| `/checkout` | **提交询价（唯一入口）** | 渠道选择、表单校验、幂等提交 |
| `/checkout/result/:inquiryNo?` | 询价提交结果 | 访问凭证展示 + 下载 |
| `/articles` | 文章 | ⚠️ 后端无内容接口，如实展示「内容筹备中」 |
| `/inquiry` · `/inquiry/result/*` | — | ⚠️ **兼容重定向**，不再挂载页面 |
| `/:pathMatch(.*)*` | 404 | |

### 已裁剪的路由（临时站口径）

`/auth`、`/login`、`/register`、`/account*`、`/orders*` **均不存在**，
访问会落到 404 —— 这是预期行为，不是 bug。
`src/router/routes.spec.ts` 对此有断言保护。
保留 `/cart` 与 `/checkout` 的原因：后端 `submit-inquiry.dto.ts` 要求
`lines` 至少 1 行，询价清单（内部实现为游客购物车）是询价单的商品来源。

## 业务模型：询价制，不是电商结算

本站**没有在线支付**。流程是：

```
浏览商品 → 加入询价清单 → 提交询价（留联系方式）→ 客服核实库存/运费 → 回复报价
```

因此：

- 界面**不出现**「立即购买」「去支付」「已支付」等字样或状态；
- 价格语义是「单价，不含运费」，运费由客服按收货地址核算；
- 询价提交成功后展示的是**访问凭证**（一次性），不是订单支付凭证。

## 品牌配置（改品牌只改一处）

`src/config/brand.ts` 是唯一来源，包含：
`brandName` / `brandShortName` / `brandTagline` / `brandLogo` / `brandFavicon` /
`brandPrimaryColor` / `brandAccentColor` / `brandEmail` / `brandWhatsApp` /
`brandSocialLinks` / `brandCopyright`。

- 主色通过 `applyBrandTheme()` 在运行时写成 `<html>` 上的内联 CSS 自定义属性
  （`--brand` / `--brand-600` / `--brand-ink` 等），`main.css` 的 `:root` 只作兜底。
- `brandEmail` / `brandWhatsApp` 为**空串**时，对应的联系方式入口**整块不渲染** ——
  不留「点进去什么也没有」的死入口。
- 站点能力开关在 `src/config/site.ts` 的 `SITE_FEATURES`：
  `articles: false`（后端无内容接口）、`newArrivals: false`（后端无排序参数）、
  `customerAccount: false`、`orderLookup: false`。

## 占位图（示意图）

后端商品目前普遍没有图片（`images: []`）。`public/placeholder/` 下有 22 张
Unsplash 免费占位图（4:5 竖版），由 `src/common/placeholderImage.ts` 按
商品名 / 分类关键词**推断品类**后确定性选用。

- **只在 `images` 为空时启用**；有真实图一律用真实图；
- 推断不出品类时**不使用**任何照片，回落品牌标记（宁可朴素，不可误导）；
- 用到占位图的地方会显示「示意图」标注，真实图接入后自动消失。

详见 [`docs/placeholder-images.md`](docs/placeholder-images.md)。

## 全局导航规则

站内链接**默认在当前标签页打开**（`NEW_TAB_PREFERENCE_DEFAULT = false`），
用户可在页头显式开启新标签页偏好，偏好持久化到 localStorage。
所有站内链接统一走 `components/SmartLink.vue`。

> ⚠️ 该默认值曾错误地为 `true`，导致站内链接被当成外链新开窗口。
> 详见 [`docs/new-tab-navigation.md`](docs/new-tab-navigation.md)。

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/frontend-architecture.md`](docs/frontend-architecture.md) | 目录结构、数据流、状态管理、API 层契约 |
| [`docs/new-tab-navigation.md`](docs/new-tab-navigation.md) | 新标签页导航规则与 `SmartLink` |
| [`docs/placeholder-images.md`](docs/placeholder-images.md) | 占位图来源、匹配规则、替换方式 |

## 仓库状态

美容时尚前台改造已完成：品牌配置集中化、四目标品类导航、
设计令牌体系、全页面响应式（1440 / 1280 / 1024 / 768 / 390 / 360 均无横向滚动）、
P1–P7 问题修复。类型检查 / 单测 / 生产构建 / 多视口浏览器验收均通过。

**后端契约未做任何改动**：API 路径、参数、响应结构、询价与幂等语义全部保持原样。
