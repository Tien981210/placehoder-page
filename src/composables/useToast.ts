import { readonly, ref } from 'vue';

/**
 * 全局轻提示（Toast）。
 *
 * 模块级单例：任意组件调用 `useToast().show('...')` 即可，
 * 由挂在 App 根部的 `ToastHost` 负责渲染。
 */

const message = ref('');
const visible = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;

export function useToast() {
  function show(text: string, duration = 2400): void {
    message.value = text;
    visible.value = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      visible.value = false;
      timer = null;
    }, duration);
  }

  return {
    message: readonly(message),
    visible: readonly(visible),
    show,
  };
}

/** 仅供测试使用。 */
export function __resetToastForTest(): void {
  message.value = '';
  visible.value = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
