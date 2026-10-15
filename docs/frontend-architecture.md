# 美容时尚前台架构（`luxra-beauty-ui`）

> 适用范围：`luxra-beauty-ui`（用户前台）。
> 本文档记录**已确定的技术路线**与**全局规则**，修改前需经确认。
>
> ⚠️ **仓库代号 vs 品牌名**：`luxra` 是历史项目代号，**不是**页面上的品牌名。
> 品牌信息全部来自 `src/config/brand.ts`，默认值为中性占位符 `BEAUTY STORE`。

## 1. 技术栈（已确认，不得替换）

| 项 | 选择 | 说明 |
| --- | --- | --- |
| 框架 | **Vue 3.5.43** | 单页面应用（SPA） |
| 语言 | TypeScript 6.0.3 | `strict` + `verbatimModuleSyntax` |
| 路由 | **Vue Router 5.4.0** | `createWebHistory`（HTML5 history 模式） |
| 构建 | **Vite 8.3.4** | `@vitejs/plugin-vue` 6.0.10 |
| 测试 | Vitest 5.0.3 + @vue/test-utils 2.5.1 + jsdom | |
| 包管理 | pnpm 9.12.3（Corepack） | `packageManager` 字段锁定 |
| Node | 22.22.2（`engines: >=22.12 <23`） | `.npmrc` 中 `engine-strict=true` |
| 样式 | 原生 CSS + CSS 自定义属性 | 不引入 Tailwind，保持依赖精简 |

**明确不做**：Next.js、React、SSR / 服务端渲染。
本仓库是**纯客户端单页应用**，所有页面在浏览器内由 Vue Router 渲染。

## 2. 目录结构

```
src/
  api/            统一 API 调用层（页面不直接 fetch）
    http.ts         请求封装、URL 拼接、错误归一化（ApiError）
    client.ts       业务接口（按域划分），含 USE_MOCK 开关
    mock.ts         明确标记的演示数据
    types.ts        与后端视图模型逐字段对齐的类型
  cart/
    useCart.ts          游客询价清单（localStorage 持久化）
    cartLineImage.ts    行缩略图解析（抽屉与购物车页共用，保证同图）
  common/
    money.ts            金额按「分」做整数运算
    categories.ts       品类 → 后端真实分类的解析（候选 slug + 运行时解析）
    placeholderImage.ts 商品示意占位图解析（见 docs/placeholder-images.md）
    pastel.ts           商品/品类底色色板
    brandMark.ts        品牌标记的内联 SVG 片段
  config/         品牌与站点配置（唯一来源）
    brand.ts        品牌名/标语/logo/主色/联系方式/版权 + 主题令牌派生
    site.ts         四目标品类、首屏与区块文案、站点能力开关
    color.ts        颜色计算（mix/shade/tint/对比度）
  components/     共享组件（SmartLink / 状态组件 / 页头页脚 / 商品卡 / 购物车抽屉）
  composables/
    useAsyncData.ts        加载状态机（idle→loading→success|error，含请求序号丢弃过期响应）
    useCategoryCatalog.ts  分类目录**进程内共享加载器**（并发去重）
    useNewTabPreference.ts 全局导航偏好
    useCartDrawer.ts       抽屉开关
    useToast.ts            轻提示
  inquiry/        询价域（幂等键、渠道、凭证、错误文案）
  visitor/        访客 ID（localStorage UUID，按路由上报）
  pages/          页面级组件，全部惰性加载
  router/         路由表与路由实例
  styles/main.css 全局设计系统（设计令牌 + 组件类 + 响应式）
```

## 3. 全局导航规则：站内链接**默认当前标签页打开**

### 3.1 规则定义

| 项 | 规定 |
| --- | --- |
| 名称 | 新页面在新标签页打开 |
| **默认值** | **关闭** |
| 开启时 | 站内**导航类**链接渲染 `target="_blank"`，由浏览器新开标签页 |
| 关闭时 | `preventDefault()` 后走 **Vue Router** 在当前标签页切换 |
| 持久化 | 用户修改后写入 `localStorage`，键名 `luxrabeauty.nav.openInNewTab` |
| 刷新后 | 保持用户上次的选择 |
| 非导航操作 | **不受影响**（见 3.3） |
| 外部链接 | 走**独立策略**（见 3.4） |

> ### 🔴 回归警示：默认值必须是 `false`
>
> 该默认值曾为 `true`，导致**所有站内链接**（商品卡、导航、页脚）都被当成外链
> 在新标签页打开 —— 这是「P1 站内链接误用 `target="_blank"`」问题的根因。
> 现在默认值为 `false`，且 `useNewTabPreference.spec.ts` 与 `SmartLink.spec.ts`
> 都有针对该默认值的回归断言。**不要把它改回 `true`。**

### 3.2 实现落点

- 偏好状态：`src/composables/useNewTabPreference.ts`（模块级单例，惰性读取存储）。
- 唯一生效点：`src/components/SmartLink.vue`。
  - 开启：渲染 `target="_blank"` + `rel="noopener noreferrer"`；
  - 关闭：`preventDefault()` 后调用 `router.push` / `router.replace`；
  - 带修饰键（Ctrl/Cmd/Shift/Alt）或非左键点击：**一律不拦截**，保留浏览器原生行为
    （中键新标签页、右键菜单、下载等）。
- 开关 UI 已随「宠物时代」的 `NewTabToggle` 组件一并移除；偏好仍可通过
  `useNewTabPreference()` 读写，但当前界面**不再暴露**这个开关 ——
  询价制站点的核心路径是「列表 → 详情 → 加购 → 提交询价」，
  中途跳出新标签页会打断这条路径。

### 3.3 不被误触发的范围（硬性约束）

以下**非导航操作**必须使用原生 `<button>` + 事件处理器，**禁止**复用 `SmartLink`：

- 表单提交（筛选、询价提交）；
- 加入询价清单 / 数量增减 / 移除商品；
- 弹窗开关、缩略图切换、抽屉开关；
- 任何不改变路由的操作。

> 由 `src/components/SmartLink.spec.ts` 覆盖开关开 / 关、修饰键点击与非左键点击。

### 3.4 外部链接策略（独立于上述开关）

`src/components/ExternalLink.vue` 统一处理站外链接：

- **一律** `target="_blank"`，避免把用户带离本站；
- **一律** `rel="noopener noreferrer"`，防止 `window.opener` 劫持与 Referer 泄漏；
- **不受**「新页面在新标签页打开」开关影响。

⚠️ 例外（刻意为之）：询价结果页的 WhatsApp 兜底链接
（「用网页版打开」）**不带** `target="_blank"` —— 该页会提示用户先保存访问凭证，
带新标签页跳转容易让用户丢失凭证上下文。详见该组件顶部的注释。

### 3.5 浏览器行为

- **刷新**：URL 即状态（列表页的 `q` / `category` / `page` 全部反映在 query 上），刷新可还原。
- **后退 / 前进**：关闭开关时使用 `router.push`，历史栈正常。
- **滚动**：`scrollBehavior` 在前进/后退时恢复原位置，普通跳转回到顶部。

## 4. API 调用层

- 所有页面**只**通过 `src/api/client.ts` 访问后端，页面内不出现 `fetch` 与 URL 拼接。
- 基址来自 `VITE_API_BASE_URL`，统一拼接 `/api/v1` 前缀
  （与后端 `src/app.setup.ts` 的 `API_PREFIX` 一致）。
- 错误归一化：后端 NestJS 默认错误信封 `{ statusCode, message, error }`
  → `ApiError { status, code, message, details }`；超时 → `TIMEOUT`；网络失败 → `NETWORK_ERROR`。
- 加载状态统一由 `useAsyncData` 提供（`idle / loading / success / error`），
  页面据此渲染 `StateLoading` / `StateEmpty` / `StateError`。

### 4.1 请求去重（P7）

分类目录（`GET /categories`）在页头、首页、分类页、列表页都要用。
若各处各写一个 `useAsyncData(() => fetchCategories())`，同一页面会出现多次完全相同的请求。

因此统一走 `src/composables/useCategoryCatalog.ts`：

- 并发调用复用**同一个 Promise**（同帧内多个组件只发一次请求）；
- 成功结果在一次会话内长期复用；
- **失败时清空缓存** —— 否则一次网络抖动会被永久固化，后续导航再也拿不到分类。

首页另有 P7 修复：原先「精选」与「新品」各发一次商品请求，
现在只发一次 `pageSize=8`，前 4 件做精选、其余做「更多商品」。

## 5. 演示（Mock）数据政策

- `VITE_USE_MOCK=true` 时使用 `src/api/mock.ts` 的数据，界面**常驻**
  「演示数据（Mock）」角标（`DemoDataBadge.vue`）。
- **严禁**把模拟数据伪装成后端真实数据；未实现的能力一律抛出
  `NotImplementedError` 并在界面如实提示。
- 当前 `.env` 为 `VITE_USE_MOCK="false"`（真实后端模式），因此**线上不显示** Mock 角标。
- Mock 商品的图片与真实后端「无图商品」走**同一套**占位图规则，
  两种模式的观感一致（见 `docs/placeholder-images.md`）。

## 6. 数据来源的「如实呈现」原则

这是本项目的核心约束，贯穿所有页面：

| 情形 | 界面行为 |
| --- | --- |
| 后端分类里没有四大目标品类 | 分类卡如实标注「筹备中」，点击退化为「全部商品」，**绝不**把不相干分类改名冒充 |
| 后端有分类但不在四大目标内 | **必须**展示（首页分类网格 + 分类页「商品库现有分类」），不隐藏真实数据 |
| 商品没有图片 | 按商品名推断品类取示意占位图，并标注「示意图」；推断不出则回落品牌标记 |
| 后端没有文章接口 | `/articles` 路由保留但如实说明「内容筹备中」，**不造假文章列表** |
| 后端没有排序参数 | 列表页**不提供**排序控件（不做无效果的假交互） |
| 邮件传输未配置 | 询价结果页如实说明「未发出任何邮件」，不显示成「已发送」 |
| 品牌事实未提供 | 首页/页脚**不写**成立年份、产地、认证、销量、供应链能力 |

## 7. 与后端的联调约定

### 7.1 已接入的真实接口

| 用途 | 方法与路径 | 认证 |
| --- | --- | --- |
| 商品分类（扁平列表） | `GET /api/v1/categories` | 无 |
| 商品列表 | `GET /api/v1/products?page&pageSize&q&category` | 无 |
| 商品详情（按 slug） | `GET /api/v1/products/:slug` | 无 |
| 渠道与业务类型目录 | `GET /api/v1/contacts/business-types` | 无 |
| 提交游客询价 | `POST /api/v1/inquiries` | 无 |
| 询价单查询（单号 + 凭证） | `POST /api/v1/inquiries/access` | 无 |
| 访客上报 | 按路由触发（失败静默） | 无 |

- `pageSize` 上限 **50**，超出返回 400（不做静默截断）。
- 前台接口在 SQL 层只返回 `status=ACTIVE` 的商品与 `visibility=PUBLIC` 的图片；
  非 ACTIVE 商品的详情返回 **404**（不用 403 泄露存在性）。
- 错误信封：校验错误 `message` 是**数组**，业务异常是**字符串** ——
  `extractMessage` 两种都兼容。
- 后端**不支持**排序参数，因此列表页没有排序控件。

### 7.2 询价提交的幂等契约（不得改动）

- 幂等键存于 `localStorage` 键 `luxrabeauty.inquiry.pending-key.v1`，
  绑定到**完整载荷指纹**（`submitFingerprint`）。
- 只有**明确成功**或收到 **409** 时才释放该键；网络超时 / 5xx 一律**保留**，
  以便用户重试时复用同一个键，避免服务端重复建单。
- `InquiryLineInput` **只允许** `{ productId, quantity }` ——
  多传任何字段都会被后端 `forbidNonWhitelisted` 拒绝（400）。

### 7.3 访问凭证（`accessToken`）的存储约束

- **只存内存**（`inquiry/session.ts` 的 `lastSubmitResult`），
  **绝不**写 localStorage / sessionStorage / URL。
- 结果页提供下载 `.txt` 凭证文件的能力；文件名取自
  `brandFileSlug()` + 单号，因此换品牌后文件名自动跟随。

### 7.4 本地联调

- `.env`：`VITE_API_BASE_URL="http://127.0.0.1:4100"`、`VITE_USE_MOCK="false"`、
  `VITE_DEV_PORT=5175`。
  > 4100 / 5175 是因为本机 4000 / 5173 被另一个项目占用，属于**本机环境事实**，
  > 不是项目约定。
- 改端口后必须把新来源加入后端 `CORS_ALLOWED_ORIGINS`，否则接口被 CORS 拦截。

### 7.5 ⚠️ 尚未就绪的能力（不得伪装成功）

| 能力 | 现状 | 界面行为 |
| --- | --- | --- |
| 真实商品图片 | 后端商品 `images: []` | 用示意图占位并标注；有真实图时自动改用真实图 |
| 真实图片上传 | 后端驱动为 `none`，上传接口返回 **503** | 前台不涉及（属后台职责） |
| 真实邮件投递 | 后端传输驱动为 `none` | 询价结果页如实说明「未发出任何邮件」 |
| 在线支付 | **不存在**，且不在本站业务模型内 | 界面不出现任何支付字样或状态 |
| 内容 / 文章接口 | 后端**没有** `GET /articles` | `/articles` 如实说明「内容筹备中」 |
| 商品排序 | 后端**不支持**排序参数 | 列表页不提供排序控件 |
| 顾客账户 / 订单查询 | 路由已裁剪 | `/auth`、`/account*`、`/orders*` 一律 404 |

### 7.6 已知问题（发现时未修改后端）

- 后端 `pnpm start`（`node dist/main.js`）**不会自动加载 `.env`**；
  本地运行需 `node --env-file=.env dist/main.js`。属既有行为，前台未改动。
- 后端演示分类 `serum` 的 `description` 字段仍是旧品牌文案
  （「Luxra Beauty 演示分类」）。**这是数据库里的数据**，前台无权修改；
  分类描述会在分类页原样展示，需由后台运营改掉（见改造报告的后续待办）。

## 术语约定：界面文案 vs 内部标识符

本站是**询价制**（无在线支付），因此界面上不存在「购物车 / 结算 / 支付」语义：

| 层 | 用语 | 示例 |
| --- | --- | --- |
| 用户可见文案 | 询价清单 / 提交询价 / 加入询价清单 / 继续挑选 | `加入询价清单`、`提交询价`、`查看询价清单` |
| 内部标识符（**刻意不改**） | `cart` | 路由 `name: 'cart'`、`useCart()`、`CartDrawer.vue`、事件 `addToCart` |
| 持久化 | `luxrabeauty.guest.cart.v1` | **键名不可变更**，否则老访客的清单会丢失 |

为什么两套用语并存：内部标识符已与既有测试、既有书签、`localStorage` 中的数据绑定，
改名只会制造回归风险而不带来任何用户价值。因此**只改用户看得见的字**。

> 例外：`/cart` 路由路径保留为 `/cart`（不改为 `/inquiry-list`），
> 因为该路径已出现在历史链接与浏览器记录中。
