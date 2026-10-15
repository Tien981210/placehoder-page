<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useCart } from '@/cart/useCart';
import { useCartDrawer } from '@/composables/useCartDrawer';

const { totalQuantity } = useCart();
const { openDrawer } = useCartDrawer();
const route = useRoute();

/**
 * 悬浮球在「询价清单」与「提交询价」两页隐藏。
 *
 * 理由（Phase 2.2 真实浏览器实测，`audit/phase22/probe_fab.py`）：
 * 它固定在右下角且 `z-index: 45`，点击只做一件事 —— 打开询价清单抽屉。
 * 而这两页的**正文本身就是询价清单**（`/checkout` 也把清单摘要完整列在页面上），
 * 于是同一个业务动作在同一屏出现了两套入口（规范 2.1 禁止的重复入口），
 * 且悬浮球还会盖住正文右下角的可点内容。
 *
 * 只按路由名隐藏，不改组件契约；`/cart` 与 `/checkout` 之外保持原样。
 */
const HIDDEN_ON = new Set(['cart', 'checkout']);
const hidden = computed(() => HIDDEN_ON.has(String(route.name ?? '')));

/** 加购后让悬浮球「跳一下」，给一个即时的视觉反馈。 */
const bump = ref(false);

watch(totalQuantity, (next, previous) => {
  if (next > previous) {
    bump.value = false;
    // 强制重排以便重复触发同一动画
    void document.body.offsetWidth;
    bump.value = true;
    setTimeout(() => {
      bump.value = false;
    }, 420);
  }
});
</script>

<template>
  <button
    v-if="!hidden"
    type="button"
    class="cart-fab"
    :class="{ bump }"
    aria-label="打开询价清单"
    @click="openDrawer"
  >
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 8h14l-1.2 12.5H6.2L5 8z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" />
      <path d="M9 8V6.4a3 3 0 016 0V8" stroke="currentColor" stroke-width="1.9" />
    </svg>
    <span class="fab-badge" :class="{ zero: totalQuantity === 0 }">{{ totalQuantity }}</span>
  </button>
</template>
