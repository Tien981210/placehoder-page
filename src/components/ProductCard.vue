<script setup lang="ts">
import { computed } from 'vue';
import { formatMoney } from '@/common/money';
import { pastelFor } from '@/common/pastel';
import { productPlaceholder } from '@/common/placeholderImage';
import { BRAND } from '@/config';
import SmartLink from '@/components/SmartLink.vue';
import type { ProductView } from '@/api/types';

const props = withDefaults(
  defineProps<{
    product: ProductView;
    /**
     * 是否在元信息行渲染分类名。
     *
     * ⚠️ 调用方在「整个结果集只有一个分类」时应传 `false`：
     *    当前商品库 6/6 件都在「护肤精华」下，每张卡都印同一个分类名
     *    等于零信息量噪音；在按分类筛选后的列表页更是与筛选条件完全重复。
     *
     * ⚠️ 默认值**必须**用 `withDefaults` 显式写成 `true`。
     *    Vue 对 `Boolean` 类型的 prop 有「缺省即 false」的隐式转换 ——
     *    只写 `showCategory?: boolean` 时省略该 prop 会得到 `false`，
     *    于是单卡场景（详情页推荐位等）的分类名会被静默隐藏，
     *    与「默认展示」的语义相反。
     */
    showCategory?: boolean;
    /**
     * 商品名标题层级（2 或 3）。
     *
     * 默认 `3`：首页的商品网格位于 `<h2>在售商品</h2>` 之下，H3 正确。
     *
     * 列表页 `/products` 必须传 `2`：那里的 H1「全部商品」**本身就是这一层的
     * 标题**，卡片再用 H3 就会出现 **H1 → H3 跳级**（实测该页标题大纲只有
     * `H1 全部商品` + 6 个 `H3`，没有任何 H2），违反规范 13.2 的层级顺序要求。
     */
    headingLevel?: 2 | 3;
  }>(),
  { showCategory: true, headingLevel: 3 },
);

/**
 * ⚠️ 事件名与 `useCart` 模块名保持不变（内部标识符）。
 *
 * 本轮只改**用户可见文案**（购物车 → 询价清单）；内部事件名、路由 name、
 * `localStorage` 键名与数量解析规则一律不动 —— 这些是与既有测试、
 * 既有书签和持久化数据绑定的契约，改名等于制造回归风险。
 */
const emit = defineEmits<{ addToCart: [product: ProductView] }>();

const primaryImage = computed(
  () => props.product.images.find((image) => image.isPrimary) ?? props.product.images[0] ?? null,
);

/**
 * 无真实商品图时的示意占位图。
 *
 * 后端商品普遍没有图片（`images: []`），这里按商品名 / 分类推断品类后取一张
 * 主题相符的占位图；推断不出主题时返回 `null`，由模板回落到品牌标记 ——
 * 宁可朴素，也不塞一张不相干的照片。
 */
const placeholderImage = computed(() =>
  primaryImage.value ? null : productPlaceholder(props.product),
);

const price = computed(() => formatMoney(props.product.price, props.product.currency));
const compareAtPrice = computed(() =>
  props.product.compareAtPrice
    ? formatMoney(props.product.compareAtPrice, props.product.currency)
    : null,
);

/**
 * 状态标记只保留**可核实**的一条：上架时间在 30 天以内 ⇒ 新品。
 *
 * 🔴 已移除「热卖」标记：它原本依据「有划线价」推断，而划线价并不能证明销量，
 *    属于无数据来源的营销 claim。
 *
 * ⚠️ 该标记在模板里**不再压在图片上做角标**，而是并进正文的元信息行 ——
 *    当前商品库 6/6 件都是近期上架，浮动角标会出现在每一张卡上，
 *    成了零信息量的装饰（规范明确要求避免「无意义的装饰标签」）。
 */
const tag = computed<{ label: string } | null>(() => {
  const { publishedAt } = props.product;
  if (!publishedAt) return null;
  const days = (Date.now() - new Date(publishedAt).getTime()) / 86400000;
  return days <= 30 ? { label: '新品' } : null;
});

/** 图片底色（占位图/品牌标记都盖在上面，主要用于图片加载前的过渡）。 */
const tone = computed(() => pastelFor(props.product.slug));

/**
 * 图片链接的可访问名称。
 *
 * ⚠️ 这里必须把「示意图」写进 `aria-label`：链接上的 `aria-label` 会**覆盖**
 *    内部文本，若只写在 `<span class="card-ph-note">` 里，屏幕阅读器用户
 *    完全听不到「这不是商品实拍」这条披露 —— 而这条披露恰恰是最需要被
 *    无障碍传达的信息之一。
 */
const mediaLabel = computed(() =>
  placeholderImage.value
    ? `查看商品：${props.product.name}（图片为示意图）`
    : `查看商品：${props.product.name}`,
);
</script>

<template>
  <article class="card">
    <SmartLink
      :to="{ name: 'product-detail', params: { slug: product.slug } }"
      class="card-ph"
      :style="{ background: tone }"
      :aria-label="mediaLabel"
    >
      <img
        v-if="primaryImage"
        :src="primaryImage.url"
        :alt="primaryImage.altText ?? product.name"
        loading="lazy"
        decoding="async"
      />
      <!-- 没有真实商品图时先用主题相符的示意占位图，避免列表看起来是空的 -->
      <img
        v-else-if="placeholderImage"
        :src="placeholderImage.url"
        :alt="placeholderImage.alt"
        loading="lazy"
        decoding="async"
      />
      <!-- 连主题都推断不出：用品牌标记兜底，不留破图 -->
      <img
        v-else
        class="card-ph-mark"
        :src="BRAND.brandLogo"
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
      />
      <span v-if="placeholderImage" class="card-ph-note">示意图</span>
    </SmartLink>

    <div class="card-body">
      <!-- 元信息行：分类 + 可核实的状态标记（如新品） -->
      <div v-if="(showCategory !== false && product.category) || tag" class="card-meta">
        <span v-if="showCategory !== false && product.category">{{ product.category.name }}</span>
        <span v-if="tag" class="card-flag">{{ tag.label }}</span>
      </div>

      <!--
        ⚠️ 商品名用标题元素包住链接，而不是把链接本身当标题。
           此前整站**没有任何 h3**，标题层级在 H2 之后直接中断
           （规范 13.2 要求 H1 / H2 / H3 语义顺序合理）。

        ⚠️ 层级由 `headingLevel` 决定：首页网格在 `<h2>在售商品</h2>` 之下用 H3；
           `/products` 的 H1 就是这一层标题，必须用 H2，否则 H1 → H3 跳级。
           视觉完全不受影响 —— `.card-name-wrap` 已把字号 / 字重 / 行高 / 外边距
           全部重置为 `inherit`，真实样式由里面的 `.card-name` 承担。
      -->
      <component :is="`h${headingLevel}`" class="card-name-wrap">
        <SmartLink :to="{ name: 'product-detail', params: { slug: product.slug } }" class="card-name">
          {{ product.name }}
        </SmartLink>
      </component>
      <p v-if="product.summary" class="card-summary">{{ product.summary }}</p>

      <div class="card-foot">
        <div class="card-price">
          {{ price }}
          <s v-if="compareAtPrice" class="card-compare">{{ compareAtPrice }}</s>
        </div>
        <!-- 非导航操作：加入询价清单使用原生 button，不受「新标签页」开关影响 -->
        <button
          type="button"
          class="add-btn"
          :aria-label="`将 ${product.name} 加入询价清单`"
          @click="emit('addToCart', product)"
        >
          加入询价清单
        </button>
      </div>
    </div>
  </article>
</template>
