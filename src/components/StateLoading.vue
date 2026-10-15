<script setup lang="ts">
/** 加载状态。 */
withDefaults(defineProps<{ label?: string }>(), { label: '加载中…' });
</script>

<template>
  <div class="state state--loading" role="status" aria-live="polite">
    <span class="state__spinner" aria-hidden="true"></span>
    <p class="state__text">{{ label }}</p>
  </div>
</template>

<style scoped>
.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  padding: 3rem 1rem;
  color: var(--ink-2);
}

.state__spinner {
  width: 1.75rem;
  height: 1.75rem;
  border: 3px solid var(--line-2);
  border-top-color: var(--brand);
  border-radius: 50%;
  animation: state-spin 0.8s linear infinite;
}

@keyframes state-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .state__spinner {
    animation-duration: 2.4s;
  }
}
</style>
