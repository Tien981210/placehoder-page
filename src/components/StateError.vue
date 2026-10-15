<script setup lang="ts">
import { computed } from 'vue';
import { describeLoadError } from '@/inquiry/apiErrors';

/**
 * 错误状态：把 ApiError 归一化为**面向顾客**的可读文案，并提供「重试」按钮。
 *
 * ⚠️ 这里**不能**直接渲染 `error.message`（Phase 2.2 真实浏览器实测的教训）：
 *    后端 5xx 的 message 是 NestJS 默认英文（`Internal Server Error`），
 *    传输层错误的 message 里也曾带着内部 API 地址与 CORS 指令。
 *    统一走 `describeLoadError()`：中文业务文案原样保留，其余换成顾客文案。
 */
const props = withDefaults(
  defineProps<{
    error: unknown;
    retryLabel?: string;
  }>(),
  { retryLabel: '重试' },
);

const emit = defineEmits<{ retry: [] }>();

const message = computed(() => describeLoadError(props.error));
</script>

<template>
  <div class="state state--error" role="alert">
    <svg class="state__icon" viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.2" stroke="currentColor" stroke-width="1.7" />
      <path d="M12 7.6v5.2" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
      <circle cx="12" cy="16.4" r="1.15" fill="currentColor" />
    </svg>
    <p class="state__title">出错了</p>
    <p class="state__text">{{ message }}</p>
    <button type="button" class="btn btn--ghost" @click="emit('retry')">{{ retryLabel }}</button>
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
  color: var(--danger);
  margin-bottom: 0.25rem;
}

.state__title {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--danger);
}

.state__text {
  margin: 0 0 0.5rem;
  font-size: var(--fs-sm);
  max-width: 32rem;
}
</style>
