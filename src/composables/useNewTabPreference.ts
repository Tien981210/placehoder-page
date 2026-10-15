import { readonly, ref } from 'vue';

/**
 * 全局导航偏好：**站内导航链接是否在新标签页打开**。
 *
 * 规则（同时记录在 docs/frontend-architecture.md）：
 *   - 默认 **关闭** —— 站内链接在当前标签页内用 Vue Router 切换；
 *   - 开启时：站内「导航类」链接在新的浏览器标签页打开；
 *   - 用户手动修改后持久化到 localStorage，刷新后仍然生效；
 *   - 该开关【只】影响导航类链接（见 SmartLink.vue），
 *     表单提交、加入询价清单、弹窗、普通按钮等非导航操作一律不受影响；
 *   - 外部链接走独立策略（见 ExternalLink.vue），不受本开关控制。
 *
 * 🔴 2026-10-15 修正（原 P1 缺陷）：
 *   默认值原为 `true`，导致**每一个站内链接**（导航、商品卡、面包屑、
 *   页脚）都带 `target="_blank"` —— 用户点一下就在后台堆出一个新标签页，
 *   返回键失效、会话状态被割裂。消费者站点不应有此行为，
 *   因此默认值改为 `false`（同标签页 SPA 跳转）。
 *   偏好机制本身保留：需要新标签页的用户仍可通过
 *   `setOpenInNewTab(true)` 开启（写入同一个 localStorage 键）。
 */

export const NEW_TAB_PREFERENCE_STORAGE_KEY = 'luxrabeauty.nav.openInNewTab';

/** 默认值：**关闭**（站内链接在当前标签页切换）。 */
export const NEW_TAB_PREFERENCE_DEFAULT = false;

/** 跨组件共享的单例状态。 */
const openInNewTab = ref<boolean>(NEW_TAB_PREFERENCE_DEFAULT);

/** 是否已经从存储中读取过（惰性初始化，避免模块导入时访问 localStorage）。 */
let loadedFromStorage = false;

function readStoredPreference(): boolean {
  try {
    const raw = globalThis.localStorage?.getItem(NEW_TAB_PREFERENCE_STORAGE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    // 未设置 / 值非法 → 回退默认值
    return NEW_TAB_PREFERENCE_DEFAULT;
  } catch {
    // localStorage 不可用（隐私模式、被禁用）→ 使用默认值，不抛错
    return NEW_TAB_PREFERENCE_DEFAULT;
  }
}

function persistPreference(value: boolean): void {
  try {
    globalThis.localStorage?.setItem(NEW_TAB_PREFERENCE_STORAGE_KEY, String(value));
  } catch {
    // 持久化失败时静默降级：偏好仅在本次会话内有效，不影响导航功能
  }
}

function ensureLoaded(): void {
  if (loadedFromStorage) return;
  openInNewTab.value = readStoredPreference();
  loadedFromStorage = true;
}

export interface NewTabPreferenceApi {
  /** 只读状态：当前是否在新标签页打开导航链接。 */
  readonly openInNewTab: Readonly<typeof openInNewTab>;
  /** 设置并持久化偏好。 */
  readonly setOpenInNewTab: (value: boolean) => void;
  /** 在开/关之间切换。 */
  readonly toggleOpenInNewTab: () => void;
  /** 恢复默认值（关闭）。 */
  readonly resetOpenInNewTab: () => void;
}

export function useNewTabPreference(): NewTabPreferenceApi {
  ensureLoaded();

  function setOpenInNewTab(value: boolean): void {
    openInNewTab.value = value;
    persistPreference(value);
  }

  function toggleOpenInNewTab(): void {
    setOpenInNewTab(!openInNewTab.value);
  }

  function resetOpenInNewTab(): void {
    setOpenInNewTab(NEW_TAB_PREFERENCE_DEFAULT);
  }

  return {
    openInNewTab: readonly(openInNewTab),
    setOpenInNewTab,
    toggleOpenInNewTab,
    resetOpenInNewTab,
  };
}

/**
 * 仅供测试使用：重置模块内单例状态，让每个用例从干净状态开始。
 * 生产代码不要调用。
 */
export function __resetNewTabPreferenceForTest(): void {
  openInNewTab.value = NEW_TAB_PREFERENCE_DEFAULT;
  loadedFromStorage = false;
}
