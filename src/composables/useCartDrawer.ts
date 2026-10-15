import { ref } from 'vue';

/**
 * 购物车抽屉的开关状态（模块级单例）。
 *
 * 顶部导航、购物车悬浮球都只是「打开抽屉」的入口，
 * 真正的抽屉内容由 `CartDrawer.vue` 渲染。
 */
const open = ref(false);

export function useCartDrawer() {
  function openDrawer(): void {
    open.value = true;
  }

  function closeDrawer(): void {
    open.value = false;
  }

  function toggleDrawer(): void {
    open.value = !open.value;
  }

  return { open, openDrawer, closeDrawer, toggleDrawer };
}

/** 仅供测试使用。 */
export function __resetCartDrawerForTest(): void {
  open.value = false;
}
