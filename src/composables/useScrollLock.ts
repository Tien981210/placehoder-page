import { onBeforeUnmount, watch, type Ref } from 'vue';

/**
 * 覆盖层打开时锁定背景滚动。
 *
 * 为什么必须是**共享的引用计数**，而不是各自 `body.style.overflow = 'hidden' / ''`：
 *   页面上同时存在两个覆盖层 —— 移动端菜单（`AppHeader`）与询价清单抽屉
 *   （`CartDrawer`）。若两者各自独立地写 / 清同一个内联样式，会出现
 *   「先开 A、再开 B，然后关闭 A」→ A 的清理把 body 解锁，而 B 还开着，
 *   背景页面又能滚动了。计数归零才解锁即可避免这种互相踩踏。
 *
 * 退出时**精确还原**进入锁定前的内联值，而不是无条件清空 ——
 * 否则会覆盖掉调用方自己设置的 `body.style.overflow`。
 *
 * ⚠️ 与 `styles/main.css` 里 `body { overflow-x: hidden }` 的关系：
 *    这里写的是内联样式，优先级高于样式表，因此解锁时会还原成空串、
 *    由样式表重新接管横向裁切 —— 行为与改造前一致。
 */

let lockCount = 0;
let savedInlineOverflow: string | null = null;

function acquire(): void {
  if (typeof document === 'undefined') return;
  if (lockCount === 0) {
    savedInlineOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
}

function release(): void {
  if (typeof document === 'undefined') return;
  if (lockCount === 0) return;
  lockCount -= 1;
  if (lockCount === 0) {
    document.body.style.overflow = savedInlineOverflow ?? '';
    savedInlineOverflow = null;
  }
}

/**
 * 把 `active` 的布尔状态绑定到「背景滚动锁」上。
 *
 * 必须在组件 `setup()` 内调用（内部使用了 `onBeforeUnmount`）。
 */
export function useScrollLock(active: Ref<boolean>): void {
  let held = false;

  watch(
    active,
    (value) => {
      if (value && !held) {
        acquire();
        held = true;
        return;
      }
      if (!value && held) {
        release();
        held = false;
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    if (!held) return;
    release();
    held = false;
  });
}

/** 仅供测试使用：清掉模块级计数，避免用例之间互相影响。 */
export function __resetScrollLockForTest(): void {
  lockCount = 0;
  savedInlineOverflow = null;
  if (typeof document !== 'undefined') {
    document.body.style.overflow = '';
  }
}
