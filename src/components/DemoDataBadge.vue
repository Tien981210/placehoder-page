<script setup lang="ts">
import { isMockActive } from '@/api/client';

/**
 * 「演示数据」角标。
 *
 * 只要 VITE_USE_MOCK 生效就常驻显示，确保用户与验收者
 * **不会把模拟数据误认为后端真实数据**。
 */
const mockActive = isMockActive();
</script>

<template>
  <span v-if="mockActive" class="demo-badge" role="status" title="当前展示的是前端演示数据，并非后端真实数据">
    演示数据（Mock）
  </span>
</template>

<style scoped>
/*
 * ⚠️ 这里原先重复定义了一份 `.demo-badge`（与 `styles/main.css` 的同名规则
 *    取值还不一致：gap / padding / 圆角都不同）。scoped 选择器带 `[data-v-*]`
 *    属性、特异性更高，所以**全局那份其实一直是死代码** —— 两处各写一份
 *    必然漂移。现在统一由全局 `styles/main.css` 的单一定义承担，本文件不再覆盖。
 */
</style>
