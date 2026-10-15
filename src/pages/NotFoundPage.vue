<script setup lang="ts">
import SmartLink from '@/components/SmartLink.vue';

/**
 * 404。
 *
 * 设计取舍：
 *   · 只保留**两个**操作：回首页（主）+ 逛商品（次）。
 *     此前并列三个按钮（回首页 / 全部商品 / 全部品类），而后两个的目的地
 *     高度重叠（品类总览页最终也指向商品列表），属于「同一个意图给两个入口」，
 *     反而稀释了主要操作。品类总览仍可从主导航进入。
 *   · 这里**不**直接列出四个目标品类：品类跳转需要按后端真实分类解析
 *     （见 `common/categories.ts`），在 404 页再拉一次分类接口得不偿失，
 *     而硬编码 slug 会把人送进 0 商品页。
 *   · 文案中性，不使用任何宠物时代的意象，也不卖萌。
 */
</script>

<template>
  <div class="page container">
    <div class="panel not-found">
      <p class="not-found__code" aria-hidden="true">404</p>
      <h1 class="page__title">页面不存在</h1>
      <p class="muted">你访问的页面可能已被移动或删除，也可能链接拼写有误。</p>

      <div class="row not-found__actions">
        <SmartLink :to="{ name: 'home' }" class="btn btn--primary">回到首页</SmartLink>
        <SmartLink :to="{ name: 'products' }" class="btn btn--ghost">浏览全部商品</SmartLink>
      </div>
    </div>
  </div>
</template>
