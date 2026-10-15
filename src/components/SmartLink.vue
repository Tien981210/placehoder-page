<script setup lang="ts">
import { computed } from 'vue';
import { useRouter, type RouteLocationRaw } from 'vue-router';
import { useNewTabPreference } from '@/composables/useNewTabPreference';

/**
 * 站内**导航类**链接组件 —— 全局「新页面在新标签页打开」开关的唯一落点。
 *
 * 行为：
 *   - 开关开启（默认）：渲染 target="_blank" rel="noopener noreferrer"，
 *     由浏览器原生在新标签页打开（保留中键 / 右键「在新标签页打开」等原生行为）；
 *   - 开关关闭：阻止默认跳转，改用 Vue Router 在当前标签页切换（push / replace）；
 *   - 带修饰键（Ctrl/Cmd/Shift/Alt）或非左键点击：一律交给浏览器默认行为；
 *
 * 使用范围（重要）：
 *   本组件【只】用于导航链接（导航栏、面包屑、商品卡片、页脚导航等）。
 *   表单提交、加入询价清单、弹窗开关、普通按钮等**非导航操作**
 *   一律使用原生 <button> + 事件处理器，绝不复用本组件，
 *   以免被全局开关误触发为「打开新标签页」。
 */
const props = withDefaults(
  defineProps<{
    to: RouteLocationRaw;
    /** 开关关闭时使用 replace 而非 push */
    replace?: boolean;
    /** 无障碍标签；缺省时由链接文本决定 */
    ariaLabel?: string;
  }>(),
  { replace: false },
);

const router = useRouter();
const { openInNewTab } = useNewTabPreference();

const href = computed(() => router.resolve(props.to).href);
const target = computed(() => (openInNewTab.value ? '_blank' : undefined));
const rel = computed(() => (openInNewTab.value ? 'noopener noreferrer' : undefined));

function onClick(event: MouseEvent): void {
  if (event.defaultPrevented) return;

  // 非左键 / 带修饰键 → 浏览器原生行为（新标签页、新窗口、下载等）
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  // 开关开启 → 由 target="_blank" 原生打开，这里不拦截
  if (openInNewTab.value) return;

  // 开关关闭 → 当前标签页内用 Vue Router 切换
  event.preventDefault();
  if (props.replace) {
    void router.replace(props.to);
  } else {
    void router.push(props.to);
  }
}
</script>

<template>
  <a
    :href="href"
    :target="target"
    :rel="rel"
    :aria-label="ariaLabel"
    class="smart-link"
    @click="onClick"
  >
    <slot />
  </a>
</template>

<style scoped>
/*
 * 这里刻意【不】写 color：
 * scoped 选择器带 [data-v-*] 属性，特异性高于单类名，
 * 一旦声明 color 就会盖掉调用方传入的 .btn-primary / .sec-more 等颜色。
 * 「链接不继承浏览器默认蓝色」由全局 `a { color: inherit }` 负责。
 */
.smart-link {
  text-decoration: none;
}
</style>
