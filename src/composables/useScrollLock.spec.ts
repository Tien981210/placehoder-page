import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, ref } from 'vue';
import { __resetScrollLockForTest, useScrollLock } from './useScrollLock';

/**
 * 覆盖层背景滚动锁测试（Phase 2.2 / P1-15）。
 *
 * 固化三件事：
 *   1. 激活即锁、取消即还原；
 *   2. **引用计数**：两个覆盖层（移动端菜单 + 询价清单抽屉）同时锁定时，
 *      先关闭的那一个不得把 body 解锁 —— 这正是改造前
 *      「各自写 `body.style.overflow`」会踩的坑；
 *   3. 组件卸载时自动释放，不会把锁泄漏到下一次挂载。
 */

function makeHarness(initial = false) {
  const active = ref(initial);
  const Comp = defineComponent({
    name: 'ScrollLockHarness',
    setup() {
      useScrollLock(active);
      return () => null;
    },
  });
  const wrapper = mount(Comp);
  return { active, wrapper };
}

beforeEach(() => {
  __resetScrollLockForTest();
});

describe('useScrollLock（覆盖层背景滚动锁）', () => {
  it('未激活时不改动 body 的内联 overflow', () => {
    makeHarness(false);
    expect(document.body.style.overflow).toBe('');
  });

  it('激活时锁住背景滚动，取消后还原', async () => {
    const { active } = makeHarness(false);

    active.value = true;
    await Promise.resolve();
    expect(document.body.style.overflow).toBe('hidden');

    active.value = false;
    await Promise.resolve();
    expect(document.body.style.overflow).toBe('');
  });

  it('初始即为 true 时（immediate）立即上锁', () => {
    makeHarness(true);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('引用计数：两个覆盖层同时打开时，先关掉一个不得解锁', async () => {
    const menu = makeHarness(false);
    const drawer = makeHarness(false);

    menu.active.value = true;
    drawer.active.value = true;
    await Promise.resolve();
    expect(document.body.style.overflow).toBe('hidden');

    // 先关菜单，抽屉还开着 ⇒ 必须保持锁定
    menu.active.value = false;
    await Promise.resolve();
    expect(document.body.style.overflow).toBe('hidden');

    // 抽屉也关了 ⇒ 才解锁
    drawer.active.value = false;
    await Promise.resolve();
    expect(document.body.style.overflow).toBe('');
  });

  it('卸载时自动释放，不把锁泄漏出去', async () => {
    const { active, wrapper } = makeHarness(true);
    expect(document.body.style.overflow).toBe('hidden');

    wrapper.unmount();
    expect(document.body.style.overflow).toBe('');

    // 卸载后即使再改状态也不应有副作用
    active.value = false;
    await Promise.resolve();
    expect(document.body.style.overflow).toBe('');
  });

  it('还原的是进入锁定前的内联值，而不是无条件清空', async () => {
    document.body.style.overflow = 'clip';

    const { active } = makeHarness(false);
    active.value = true;
    await Promise.resolve();
    expect(document.body.style.overflow).toBe('hidden');

    active.value = false;
    await Promise.resolve();
    expect(document.body.style.overflow).toBe('clip');
  });
});
