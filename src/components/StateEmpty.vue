<script setup lang="ts">
/**
 * 空状态。
 *
 * ⚠️ 图标刻意使用**中性品牌标记**（刻面宝石线稿）而不是 emoji：
 *    原实现用的是爪印 emoji，与美容品类完全无关；
 *    统一线稿图标也能保证跨平台渲染一致（emoji 各系统画风差异极大）。
 */
withDefaults(defineProps<{ title?: string; description?: string }>(), {
  title: '暂无内容',
  description: '',
});
</script>

<template>
  <div class="state state--empty" role="status">
    <svg class="state__icon" viewBox="0 0 64 64" width="38" height="38" fill="none" aria-hidden="true">
      <path
        d="M20 15h24l12 13-24 23L8 28z"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linejoin="round"
      />
      <path
        d="M20 15l6 13h12l6-13M8 28h48M26 28l6 23 6-23"
        stroke="currentColor"
        stroke-width="2"
        stroke-linejoin="round"
        opacity="0.5"
      />
    </svg>
    <p class="state__title">{{ title }}</p>
    <p v-if="description" class="state__text">{{ description }}</p>
    <div v-if="$slots.default" class="state__actions">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 3rem 1rem;
  text-align: center;
  color: var(--ink-2);
}

.state__icon {
  color: var(--ink-3);
  margin-bottom: 0.25rem;
}

.state__title {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--ink);
}

.state__text {
  margin: 0;
  font-size: var(--fs-sm);
  max-width: 34rem;
}

.state__actions {
  margin-top: 0.75rem;
}
</style>
