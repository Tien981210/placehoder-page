<script setup lang="ts">
import { computed } from 'vue';
import { resolveSiteCategories, unmatchedCategories } from '@/common/categories';
import { categoryPlaceholder } from '@/common/placeholderImage';
import { BRAND, SITE_CATEGORIES } from '@/config';
import { useAsyncData } from '@/composables/useAsyncData';
import { loadCategoryCatalog } from '@/composables/useCategoryCatalog';
import SmartLink from '@/components/SmartLink.vue';
import StateEmpty from '@/components/StateEmpty.vue';
import StateError from '@/components/StateError.vue';
import StateLoading from '@/components/StateLoading.vue';
import type { CategoryView } from '@/api/types';

/**
 * 商品分类页。
 *
 * 页面刻意分成两块，避免把「计划卖的品类」和「真的在卖的分类」混为一谈：
 *   ① 目标品类 —— 来自 `SITE_CATEGORIES` 的四个品类，未上架时如实标注「筹备中」；
 *   ② 商品库现有分类 —— 后端真实返回的分类，按 `parentId` 组装层级。
 *
 * ⚠️ 第 ② 块**必须**渲染后端全部启用分类：只展示四大目标品类的话，
 *    后台已存在的分类（例如当前的 `serum`）会在页面上凭空消失。
 *
 * P7：分类目录走 `loadCategoryCatalog()` 共享加载器，与页头共用一次请求。
 */

const categories = useAsyncData(loadCategoryCatalog);

const items = computed<CategoryView[]>(() => categories.data.value ?? []);

const targetCategories = computed(() => resolveSiteCategories(SITE_CATEGORIES, items.value));

/**
 * 目标品类 + 各自的占位图。
 *
 * 占位图在这里一次性算好，而不是在模板里反复调用 —— 模板里调用会让
 * 同一个纯函数在一次渲染中被执行多次，也让模板难以阅读。
 */
const targetCards = computed(() =>
  targetCategories.value.map((item) => ({
    ...item,
    photo: categoryPlaceholder(item.category.key, item.category.key, item.category.labelZh),
  })),
);

const realCategories = computed(() => unmatchedCategories(items.value, SITE_CATEGORIES));

/** 后端返回扁平列表，这里按 parentId 组装成层级。 */
interface CategoryNode extends CategoryView {
  children: CategoryNode[];
}

function buildTree(source: readonly CategoryView[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  for (const item of source) {
    nodes.set(item.id, { ...item, children: [] });
  }
  const roots: CategoryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

const realTree = computed(() => buildTree(realCategories.value));

const targetAvailableCount = computed(
  () => targetCategories.value.filter((item) => item.slug).length,
);
</script>

<template>
  <div class="page container">
    <header class="page__header">
      <p class="overline">CATEGORIES</p>
      <h1 class="page__title">商品分类</h1>
      <p class="page__subtitle">先从品类进入，再挑具体款式。价格与库存以商品页信息为准。</p>
    </header>

    <StateLoading v-if="categories.isLoading.value" />
    <StateError v-else-if="categories.isError.value" :error="categories.error.value" @retry="categories.load" />

    <template v-else>
      <!-- ① 目标品类 -->
      <section class="block">
        <div class="sec-head">
          <div>
            <p class="overline">TARGET CATEGORIES</p>
            <h2 class="sec-title">目标品类</h2>
            <p class="sec-sub">
              本站计划经营的四个方向。标注「筹备中」的品类在商品库中尚未建立，
              点击后会展示全部在售商品。
            </p>
          </div>
          <SmartLink :to="{ name: 'products' }" class="sec-more">查看全部商品 →</SmartLink>
        </div>

        <div class="cat-grid">
          <SmartLink
            v-for="item in targetCards"
            :key="item.category.key"
            :to="item.target"
            class="cat-card"
          >
            <div class="cat-card__media">
              <img
                v-if="item.photo"
                class="cat-card__photo"
                :src="item.photo.url"
                :alt="item.photo.alt"
                loading="lazy"
                decoding="async"
              />
              <img v-else class="cat-card__mark" :src="BRAND.brandLogo" alt="" aria-hidden="true" />
              <span class="cat-card__status">{{ item.slug ? '在售' : '筹备中' }}</span>
            </div>
            <div class="cat-card__body">
              <!--
                ⚠️ 与首页保持同一套语言层级：中文主标题（h3）+ 英文副标题。
                   原先这里和目标品类区块里都是「英文主标题 + 中文副标题」，
                   而首页在售分类卡是「中文主标题」，同一站内两套层级 ⇒ 观感不一致。
                   同时把标题从 div 换成 h3 —— 全站此前 H1 → H2 之后层级即中断（P1-17）。
              -->
              <h3 class="cat-card__name">{{ item.category.labelZh }}</h3>
              <div class="cat-card__zh">{{ item.category.label }}</div>
              <p class="cat-card__blurb">{{ item.category.blurb }}</p>
              <span class="cat-card__cta">
                {{ item.slug ? '查看该品类商品 →' : '查看全部商品 →' }}
              </span>
            </div>
          </SmartLink>
        </div>

        <p v-if="targetAvailableCount === 0" class="notice notice--info" style="margin-top: var(--sp-5)">
          四个目标品类目前都还没有上架商品。下面的「商品库现有分类」是当前真实可购买的范围。
        </p>
      </section>

      <!-- ② 商品库现有分类 -->
      <section class="block">
        <div class="sec-head">
          <div>
            <p class="overline">LIVE CATALOG</p>
            <h2 class="sec-title">商品库现有分类</h2>
            <p class="sec-sub">直接来自后端分类接口 —— 这些分类下的商品现在就能询价。</p>
          </div>
        </div>

        <StateEmpty
          v-if="realTree.length === 0"
          title="商品库还没有分类"
          description="后端尚未配置任何启用中的分类，此时只能按「全部商品」浏览。"
        >
          <SmartLink :to="{ name: 'products' }" class="btn btn--ghost">浏览全部商品</SmartLink>
        </StateEmpty>

        <div v-else class="category-grid">
          <section v-for="node in realTree" :key="node.id" class="panel category-block">
            <h3 class="category-block__title">
              <SmartLink :to="{ name: 'products', query: { category: node.slug } }">
                {{ node.name }}
              </SmartLink>
            </h3>
            <p v-if="node.description" class="category-block__desc">{{ node.description }}</p>

            <ul v-if="node.children.length > 0" class="category-block__children">
              <li v-for="child in node.children" :key="child.id">
                <SmartLink :to="{ name: 'products', query: { category: child.slug } }">
                  {{ child.name }}
                </SmartLink>
              </li>
            </ul>

            <SmartLink :to="{ name: 'products', query: { category: node.slug } }" class="btn btn--ghost btn--sm">
              查看该分类商品
            </SmartLink>
          </section>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.block + .block {
  margin-top: var(--sp-8);
}

.category-grid {
  display: grid;
  gap: var(--sp-4);
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}

.category-block {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  align-items: flex-start;
}

.category-block__title {
  margin: 0;
  font-size: var(--fs-lg);
}

.category-block__desc {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--ink-2);
}

.category-block__children {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.9rem;
  font-size: var(--fs-sm);
}

.category-block__children a {
  color: var(--brand-ink);
}

.category-block .btn {
  margin-top: auto;
}
</style>
