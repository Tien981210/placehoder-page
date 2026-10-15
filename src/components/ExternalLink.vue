<script setup lang="ts">
/**
 * 外部链接组件 —— 遵循**独立于**站内开关的链接策略。
 *
 * 外部链接策略（记录在 docs/frontend-architecture.md）：
 *   - 一律 target="_blank"，避免把用户带离本站；
 *   - 一律带 rel="noopener noreferrer"，防止 window.opener 劫持与 Referer 泄漏；
 *   - 显示「↗」角标提示将离开本站；
 *   - **不受**「新页面在新标签页打开」开关影响。
 */
defineProps<{
  href: string;
  ariaLabel?: string;
}>();
</script>

<template>
  <a
    :href="href"
    :aria-label="ariaLabel"
    class="external-link"
    target="_blank"
    rel="noopener noreferrer"
  >
    <slot />
    <span class="external-link__mark" aria-hidden="true">↗</span>
  </a>
</template>

<style scoped>
.external-link {
  color: inherit;
  text-decoration: none;
}

.external-link__mark {
  margin-left: 0.25em;
  font-size: 0.85em;
  opacity: 0.7;
}
</style>
