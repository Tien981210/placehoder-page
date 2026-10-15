<script setup lang="ts">
import SmartLink from '@/components/SmartLink.vue';
import StateEmpty from '@/components/StateEmpty.vue';
import { SITE_CATEGORIES, SITE_FEATURES } from '@/config';

/**
 * 文章 / 内容栏目。
 *
 * ⚠️ 后端**没有**内容接口（`GET /api/v1/articles` 不存在），
 *    所以这里如实说明「内容筹备中」：
 *    - 不做假的文章列表；
 *    - 不放占位假标题；
 *    - 不编造发布时间 / 作者 / 阅读量。
 *
 * `SITE_FEATURES.articles = false` 时，首页与主导航都不会出现入口，
 * 但路由保留，直接访问也能得到一个说得清楚的页面（而不是 404）。
 */

/** 内容上线后计划覆盖的方向 —— 只是栏目规划，不代表已有内容。 */
const PLANNED_TOPICS = [
  { title: '选品说明', text: '材质、尺寸与工艺差异怎么看，帮你在下单前把预期对齐。' },
  { title: '佩戴与打理', text: '首饰收纳、假发与发片清洗、美妆工具清洁保养的日常做法。' },
  { title: '尺码与适配', text: '发片色号、夹片宽度、饰品长度与自身条件的匹配建议。' },
  { title: '询价与交付', text: '怎么提交询价、客服会核实哪些信息、报价包含什么。' },
];
</script>

<template>
  <div class="wrap collection">
    <nav class="crumb" aria-label="面包屑">
      <SmartLink :to="{ name: 'home' }">首页</SmartLink>
      <span aria-hidden="true"> / </span>
      <b>文章</b>
    </nav>

    <div class="col-head">
      <p class="overline">EDITORIAL</p>
      <h1 class="col-h1">文章</h1>
      <p class="col-desc">
        选品说明、佩戴与打理、尺码适配与询价流程 —— 把购买前真正会遇到的疑问写清楚。
      </p>
    </div>

    <StateEmpty
      title="内容筹备中"
      description="这个栏目还在筹备，暂时不会展示任何文章。以下是我们计划先覆盖的方向，上线后会在此按主题列出。"
    >
      <SmartLink :to="{ name: 'products' }" class="btn btn--primary">先去逛逛商品</SmartLink>
      <SmartLink :to="{ name: 'categories' }" class="btn btn--ghost">按品类选购</SmartLink>
    </StateEmpty>

    <!--
      计划栏目。
      ⚠️ 用 <dl> 而不是带边框的卡片：卡片外观会暗示「可以点开阅读」，
         而这些栏目**当前没有内容也没有目的地**。规范明确禁止
         「看似可点击但实际没有目的地的文章卡」。
    -->
    <section v-if="!SITE_FEATURES.articles" class="planned" aria-labelledby="planned-title">
      <h2 id="planned-title" class="planned__title">计划中的栏目</h2>
      <dl class="planned__list">
        <div v-for="topic in PLANNED_TOPICS" :key="topic.title" class="planned__item">
          <dt class="planned__item-title">{{ topic.title }}</dt>
          <dd class="planned__item-text">{{ topic.text }}</dd>
        </div>
      </dl>
      <p class="planned__note">
        以上是内容方向规划，与在售商品无关。这些方向对应的目标品类（{{
          SITE_CATEGORIES.map((c) => c.labelZh).join(' / ')
        }}）目前尚未上架，现可选购的是全部在售商品。
      </p>
    </section>
  </div>
</template>
