import { beforeEach, describe, expect, it } from 'vitest';
import {
  NEW_TAB_PREFERENCE_DEFAULT,
  NEW_TAB_PREFERENCE_STORAGE_KEY,
  __resetNewTabPreferenceForTest,
  useNewTabPreference,
} from './useNewTabPreference';

/**
 * 「站内导航是否在新标签页打开」偏好。
 *
 * 🔴 回归护栏（原 P1 缺陷）：
 *   默认值曾经是 `true`，导致站内每一个链接都带 `target="_blank"`，
 *   用户点一下就在后台堆一个新标签页。下面的「默认关闭」用例就是防止它被改回去。
 */
describe('useNewTabPreference（站内导航是否在新标签页打开）', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetNewTabPreferenceForTest();
  });

  it('默认关闭（站内链接在当前标签页切换）', () => {
    const { openInNewTab } = useNewTabPreference();
    expect(NEW_TAB_PREFERENCE_DEFAULT).toBe(false);
    expect(openInNewTab.value).toBe(false);
  });

  it('用户修改后持久化到 localStorage', () => {
    const { setOpenInNewTab } = useNewTabPreference();
    setOpenInNewTab(true);
    expect(localStorage.getItem(NEW_TAB_PREFERENCE_STORAGE_KEY)).toBe('true');
  });

  it('刷新后（重新读取）保持用户选择', () => {
    localStorage.setItem(NEW_TAB_PREFERENCE_STORAGE_KEY, 'true');
    __resetNewTabPreferenceForTest();
    const { openInNewTab } = useNewTabPreference();
    expect(openInNewTab.value).toBe(true);
  });

  it('toggle 在开 / 关之间切换并写回存储', () => {
    const { openInNewTab, toggleOpenInNewTab } = useNewTabPreference();
    toggleOpenInNewTab();
    expect(openInNewTab.value).toBe(true);
    expect(localStorage.getItem(NEW_TAB_PREFERENCE_STORAGE_KEY)).toBe('true');
    toggleOpenInNewTab();
    expect(openInNewTab.value).toBe(false);
    expect(localStorage.getItem(NEW_TAB_PREFERENCE_STORAGE_KEY)).toBe('false');
  });

  it('reset 恢复默认值（关闭）', () => {
    const { openInNewTab, setOpenInNewTab, resetOpenInNewTab } = useNewTabPreference();
    setOpenInNewTab(true);
    resetOpenInNewTab();
    expect(openInNewTab.value).toBe(false);
  });

  it('存储值非法时回退到默认值', () => {
    localStorage.setItem(NEW_TAB_PREFERENCE_STORAGE_KEY, 'not-a-boolean');
    __resetNewTabPreferenceForTest();
    const { openInNewTab } = useNewTabPreference();
    expect(openInNewTab.value).toBe(false);
  });

  it('状态在多个组件之间共享（单例）', () => {
    const a = useNewTabPreference();
    const b = useNewTabPreference();
    a.setOpenInNewTab(true);
    expect(b.openInNewTab.value).toBe(true);
  });
});
