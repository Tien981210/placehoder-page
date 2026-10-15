# 导航行为配置说明：新页面在新标签页打开

> 适用范围：`luxra-beauty-ui`（用户前台）
> 相关代码：`src/composables/useNewTabPreference.ts`、`src/components/SmartLink.vue`、
> `src/components/ExternalLink.vue`
> 相关测试：`src/components/SmartLink.spec.ts`、`src/composables/useNewTabPreference.spec.ts`

---

## 🔴 先说结论（这条曾经出过错）

**`NEW_TAB_PREFERENCE_DEFAULT` 必须是 `false`。**

它曾经是 `true`，后果是：**所有站内链接**（商品卡、顶部导航、页脚）
都被渲染成 `target="_blank"`，用户点一下商品就多开一个标签页 ——
这就是改造前 P1 问题的根因。

现在默认值为 `false`：站内链接在当前标签页通过 Vue Router 切换。
`useNewTabPreference.spec.ts` 与 `SmartLink.spec.ts` 都对此有回归断言。

---

## 1 这是什么

这是本项目的一条**架构级导航规则**，不是某个页面的局部行为。

| 项 | 规定 |
| --- | --- |
| 名称 | 新页面在新标签页打开 |
| **默认值** | **关闭** |
| 开启时 | 站内**导航类**链接在新的浏览器标签页打开（`target="_blank"`） |
| 关闭时 | 走 Vue Router 在**当前标签页**内切换 |
| 开关 UI | 当前界面**不暴露**（见 §2.3） |
| 持久化 | 用户修改后写入 `localStorage`，键名 `luxrabeauty.nav.openInNewTab` |
| 刷新后 | 保持用户上次的选择 |
| 非导航操作 | **不受影响**（见 §3） |
| 外部链接 | 走**独立策略**，不受本开关控制（见 §4） |

## 2 配置项

### 2.1 存储键与默认值

```ts
// src/composables/useNewTabPreference.ts
export const NEW_TAB_PREFERENCE_STORAGE_KEY = 'luxrabeauty.nav.openInNewTab';

/**
 * 🔴 默认关闭。改为 true 会让站内链接全部在新标签页打开（P1 回归）。
 */
export const NEW_TAB_PREFERENCE_DEFAULT = false;
```

- 读取时机：**惰性**。模块导入时不访问 `localStorage`，首次调用 `useNewTabPreference()`
  或 `ensureLoaded()` 时才读取（避免 SSR / 测试环境下访问不存在的 `localStorage`）。
- 取值规则：`'true'` → 开；`'false'` → 关；其它任何值（含 `null`）→ **回退默认值**。
- `localStorage` 不可用（隐私模式、被禁用）→ 使用默认值，**不抛错**；
  写入失败也静默降级（本次会话内仍生效，刷新后回到默认值）。

### 2.2 如何修改默认值

| 目标 | 做法 |
| --- | --- |
| 把默认改成「开启」 | ⚠️ 需要改 `NEW_TAB_PREFERENCE_DEFAULT` 为 `true`，**并同步反转两个 spec 的断言**；否则测试会红。改动前请确认这是真的产品决策 |
| 临时重置某用户的偏好 | 清掉浏览器 `localStorage` 中的 `luxrabeauty.nav.openInNewTab` |
| 恢复默认（代码内） | 调用 `useNewTabPreference().resetOpenInNewTab()` |

### 2.3 关于「开关 UI」

宠物时代的 `NewTabToggle.vue` 已随该期视觉资产一并删除。
原因：询价制站点的核心路径是「列表 → 详情 → 加购 → 提交询价」，
中途跳出新标签页会打断这条路径，而这个开关对转化没有正收益。

`useNewTabPreference()` 的 API 仍然完整保留（含 `setOpenInNewTab` / `toggleOpenInNewTab`），
因此后续若要重新暴露开关，只需新增一个 UI 组件，逻辑层无需改动。

### 2.4 可用 API

```ts
const {
  openInNewTab,          // Readonly<Ref<boolean>> —— 当前状态
  setOpenInNewTab,       // (value: boolean) => void —— 设置并持久化
  toggleOpenInNewTab,    // () => void —— 在开/关之间切换
  resetOpenInNewTab,     // () => void —— 恢复默认（关闭）
} = useNewTabPreference();
```

## 3 生效范围（硬性约束）

### 3.1 必须使用 `SmartLink` 的场景

**导航类**链接一律使用 `SmartLink`：

- 顶部导航、巨型菜单、移动端菜单；
- 面包屑、页脚导航；
- 商品卡片上的「进入详情」、品类卡片；
- 分页的上一页 / 下一页；
- 页面正文里的站内跳转链接。

`SmartLink` 的行为：

| 情形 | 行为 |
| --- | --- |
| 开关开启 | 渲染 `target="_blank"` + `rel="noopener noreferrer"`，由**浏览器原生**打开新标签页 |
| 开关关闭（默认） | `preventDefault()` 后调用 `router.push` / `router.replace` |
| 带修饰键（Ctrl / Cmd / Shift / Alt） | **不拦截**，保留浏览器原生行为 |
| 非左键（中键、右键菜单） | **不拦截**，保留浏览器原生行为 |

> `rel="noopener noreferrer"` 是必需的：防止 `window.opener` 劫持与 Referer 泄漏。

### 3.2 禁止使用 `SmartLink` 的场景

以下**非导航操作**必须使用原生 `<button>` + 事件处理器：

- 表单提交（筛选、搜索、询价提交）；
- 加入询价清单 / 数量增减 / 移除商品；
- 弹窗开关、抽屉开关、缩略图切换；
- 分页以外的所有按钮；
- 任何**不改变路由**的操作。

理由：`SmartLink` 会受全局开关影响。若把「加入询价清单」做成 `SmartLink`，
开关开启时点一下就会多开一个标签页。

> 该约束由测试守护：`src/components/SmartLink.spec.ts` 覆盖开关开 / 关、
> 修饰键点击与非左键点击四种情形。

### 3.3 ⚠️ 一个易踩的样式坑

`SmartLink` 的 `<style scoped>` **刻意不声明 `color`**。

scoped 选择器会带上 `[data-v-*]` 属性，特异性为 `(0,2,0)`，高于调用方传入的
单个类名（如 `.btn`、`.sec-more`）。一旦在 `SmartLink` 内声明 `color`，
就会盖掉调用方的颜色。**「链接不继承浏览器默认蓝色」由全局 `a { color: inherit }` 负责。**

## 4 外部链接策略（独立于本开关）

站外链接统一走 `src/components/ExternalLink.vue`：

- **一律** `target="_blank"`，避免把用户带离本站；
- **一律** `rel="noopener noreferrer"`；
- 显示「↗」角标提示将离开本站；
- **不受**「新页面在新标签页打开」开关影响。

### 4.1 ⚠️ 刻意保留的例外

**询价结果页**的 WhatsApp 兜底链接（「用网页版打开」）**不带** `target="_blank"`。

原因：该页面顶部会提示用户「先保存访问凭证」。
访问凭证只存内存（见 §5），若在新标签页打开 WhatsApp，用户在新标签页里
没有本站的凭证上下文，容易误以为凭证已丢失。

该例外的取舍记录在 `InquiryResultPage.vue` 顶部的注释里。
若要改成新标签页，需要同步修改 `InquiryResultPage.spec.ts` 中
对 `fallback.attributes('target')` 的断言。

## 5 与凭证存储的关系

因为本规则**默认关闭**，站内导航发生在同一标签页内 —— 但**这不改变**凭证存储的约束：

| 数据 | 存储位置 | 理由 |
| --- | --- | --- |
| 询价访问凭证（`accessToken`） | **仅内存**（`src/inquiry/session.ts`） | 它是查询询价单的唯一授权凭据；写进 localStorage / URL 会显著扩大泄露面 |
| 购物车（询价清单） | `localStorage`（`luxrabeauty.guest.cart.v1`） | 跨刷新需要保留，且不含任何凭据 |
| 访客 ID | `localStorage`（`luxrabeauty.visitor.id.v1`） | 匿名 UUID，用于访客统计 |
| 幂等键 | `localStorage`（`luxrabeauty.inquiry.pending-key.v1`） | 需要跨刷新复用，避免重复建单 |

> 若将来把本规则默认改回「开启」，需要重新评估：哪些数据必须跨标签页可见。
> 当前没有任何数据依赖跨标签页共享（凭证只存内存，购物车在 localStorage）。

## 6 验证方式

```bash
cd E:/com.luxra/luxra-beauty-ui

# 单元测试（含默认值回归断言与链接行为）
corepack pnpm vitest run src/components/SmartLink.spec.ts \
                          src/composables/useNewTabPreference.spec.ts

# 类型检查 / 构建
corepack pnpm typecheck
corepack pnpm build
```

手工验证清单：

1. 默认状态下点顶部导航 / 商品卡 → **应在当前标签页切换**（浏览器后退可用）；
2. 打开 DevTools 搜索 `target="_blank"` → 站内链接**不应命中**
   （只有站外链接与配置了 WhatsApp 号码时的 wa.me 链接会命中）；
3. Ctrl/Cmd + 点击导航 → 仍应在新标签页打开（浏览器原生行为）；
4. 中键点击导航 → 应在新标签页打开（与开关无关）；
5. 点「加入询价清单」/ 数量 +/− → **不应**打开新标签页、不应改变路由。
