<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { fetchProducts } from '@/api/client';
import ProductCard from '@/components/ProductCard.vue';
import SmartLink from '@/components/SmartLink.vue';
import StateEmpty from '@/components/StateEmpty.vue';
import StateError from '@/components/StateError.vue';
import StateLoading from '@/components/StateLoading.vue';
import { useAsyncData } from '@/composables/useAsyncData';
import { loadCategoryCatalog } from '@/composables/useCategoryCatalog';
import { useCart } from '@/cart/useCart';
import { useToast } from '@/composables/useToast';
import type { ProductView } from '@/api/types';

/**
 * 商品列表页。
 *
 * 契约保持（与后端接口一致，本次改造**未**改动）：
 *   - 查询条件全部来自 URL（`page` / `q` / `category`），刷新、前进后退、
 *     分享链接都能还原状态；
 *   - 请求参数只有 `page` / `pageSize` / `q` / `category` ——
 *     后端 `GET /api/v1/products` 不支持排序参数，因此**本页不提供排序控件**
 *     （放一个点了没用的下拉框属于假交互）。
 *
 * P7 修复：分类目录改走 `loadCategoryCatalog()` 共享加载器，
 *   与页头共用同一次请求，不再各发一份。
 */

const PAGE_SIZE = 12;

const route = useRoute();
const router = useRouter();
const { addLine } = useCart();
const { show } = useToast();

/** 从 URL 读取查询条件 —— 这样刷新、前进、后退、分享链接都能还原状态。 */
const query = computed(() => {
  const pageRaw = Number(route.query.page);
  return {
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1,
    pageSize: PAGE_SIZE,
    q: typeof route.query.q === 'string' && route.query.q ? route.query.q : undefined,
    category:
      typeof route.query.category === 'string' && route.query.category
        ? route.query.category
        : undefined,
  };
});

const list = useAsyncData(() => fetchProducts(query.value), { immediate: false });
const categories = useAsyncData(loadCategoryCatalog);

watch(query, () => void list.load(), { immediate: true, deep: true });

const searchInput = ref(typeof route.query.q === 'string' ? route.query.q : '');

watch(
  () => route.query,
  () => {
    searchInput.value = typeof route.query.q === 'string' ? route.query.q : '';
  },
);

const items = computed<ProductView[]>(() => list.data.value?.items ?? []);
const total = computed(() => list.data.value?.total ?? 0);
const totalPages = computed(() => list.data.value?.totalPages ?? 0);

/**
 * 是否在卡片上重复渲染分类名。
 *
 * ⚠️ 当结果集只落在一个分类里时（含「已按分类筛选」的情况），
 *    每张卡都印同一个分类名 = 零信息量噪音，且与页面上的筛选条件完全重复。
 *    此时不渲染；结果集跨多个分类时才保留，因为它真的能帮用户区分。
 */
const showCardCategory = computed(
  () => new Set(items.value.map((item) => item.category?.name ?? '')).size > 1,
);
const currentPage = computed(() => list.data.value?.page ?? query.value.page);
const categoryList = computed(() => categories.data.value ?? []);

const activeCategory = computed(
  () => categoryList.value.find((item) => item.slug === query.value.category) ?? null,
);

/**
 * URL 里的分类在后端分类库中**不存在**（过期书签 / 外链 / 手改 URL）。
 *
 * ⚠️ 只有在分类列表**已加载成功**时才能判定「不存在」——
 *    加载中或加载失败时一律不判定，否则会把正常链接误报成失效。
 */
const categoryMissing = computed(
  () =>
    Boolean(query.value.category) &&
    categories.status.value === 'success' &&
    !activeCategory.value,
);

/** 分类列表加载成功但后端一条分类都没有 —— 如实说明，而不是装作筛选栏可用。 */
const categoryCatalogEmpty = computed(
  () => categories.status.value === 'success' && categoryList.value.length === 0,
);

const pageTitle = computed(() => activeCategory.value?.name ?? '全部商品');

/** 是否存在生效中的筛选条件 —— 用于给出「清除筛选」出口。 */
const hasActiveFilter = computed(() => Boolean(query.value.q) || Boolean(query.value.category));

const pageDesc = computed(() => {
  if (activeCategory.value?.description) return activeCategory.value.description;
  if (query.value.q) return `关键词「${query.value.q}」的搜索结果。`;
  return '本站全部在售商品。价格为商品单价，运费由客服按收货地址核算后报价。';
});

function applySearch(): void {
  void router.push({
    name: 'products',
    query: {
      ...(searchInput.value ? { q: searchInput.value } : {}),
      ...(query.value.category ? { category: query.value.category } : {}),
      page: 1,
    },
  });
}

/** 选中某个真实分类。 */
function selectCategory(slug: string | null): void {
  void router.push({
    name: 'products',
    query: {
      ...(query.value.q ? { q: query.value.q } : {}),
      ...(slug ? { category: slug } : {}),
    },
  });
}

function resetAll(): void {
  searchInput.value = '';
  void router.push({ name: 'products' });
}

function pageTarget(page: number) {
  return {
    name: 'products' as const,
    query: {
      ...(query.value.q ? { q: query.value.q } : {}),
      ...(query.value.category ? { category: query.value.category } : {}),
      ...(page > 1 ? { page } : {}),
    },
  };
}

function handleAddToCart(product: ProductView): void {
  addLine({
    productId: product.id,
    slug: product.slug,
    name: product.name,
    unitPrice: product.price,
    currency: product.currency,
    imageUrl: product.images[0]?.url ?? null,
  });
  show(`已加入询价清单 · ${product.name}`);
}
</script>

<template>
  <div class="wrap collection">
    <nav class="crumb" aria-label="面包屑">
      <SmartLink :to="{ name: 'home' }">首页</SmartLink>
      <span aria-hidden="true"> / </span>
      <SmartLink :to="{ name: 'products' }">全部商品</SmartLink>
      <template v-if="activeCategory">
        <span aria-hidden="true"> / </span>
        <b>{{ activeCategory.name }}</b>
      </template>
    </nav>

    <div class="col-head">
      <h1 class="col-h1">{{ pageTitle }}</h1>
      <p class="col-desc">{{ pageDesc }}</p>

      <div class="toolbar">
        <div class="filter-bar" role="group" aria-label="按分类筛选">
          <button
            type="button"
            class="chip"
            :class="{ on: !activeCategory }"
            :aria-pressed="!activeCategory ? 'true' : 'false'"
            @click="selectCategory(null)"
          >
            全部
          </button>
          <button
            v-for="category in categoryList"
            :key="category.id"
            type="button"
            class="chip"
            :class="{ on: query.category === category.slug }"
            :aria-pressed="query.category === category.slug ? 'true' : 'false'"
            @click="selectCategory(category.slug)"
          >
            {{ category.name }}
          </button>
        </div>

        <!-- 关键词搜索属于非导航操作：原生 form + button -->
        <form class="search-pill" novalidate @submit.prevent="applySearch">
          <input
            v-model="searchInput"
            type="search"
            placeholder="按名称 / 编码搜索"
            maxlength="200"
            aria-label="商品关键词"
          />
          <button type="submit" class="btn btn--primary">搜索</button>
        </form>
      </div>

      <div class="col-meta">
        <p v-if="list.status.value === 'success'" class="col-meta__count">共 {{ total }} 件商品</p>
        <!--
          生效中的筛选条件回显 + 一键清除。
          ⚠️ 只在确有筛选时出现：没有筛选却常驻一个「清除筛选」按钮属于假交互。
        -->
        <div v-if="hasActiveFilter" class="col-meta__filters">
          <span class="col-meta__label">当前筛选</span>
          <span v-if="activeCategory" class="col-meta__tag">{{ activeCategory.name }}</span>
          <span v-if="query.q" class="col-meta__tag">关键词「{{ query.q }}」</span>
          <button type="button" class="col-meta__clear" @click="resetAll">清除筛选</button>
        </div>
      </div>
    </div>

    <p v-if="categoryMissing" class="notice notice--warn need-note" role="status">
      链接中的分类「{{ query.category }}」<strong>不存在或已下架</strong>，已按<strong>全部商品</strong>展示。
      请从下方筛选栏重新选择分类。
    </p>

    <p v-else-if="categoryCatalogEmpty" class="notice notice--info need-note" role="status">
      商品库尚未建立任何分类，因此暂时只能按<strong>全部商品</strong>浏览。
    </p>

    <StateLoading v-if="list.isLoading.value" />
    <StateError v-else-if="list.isError.value" :error="list.error.value" @retry="list.load" />
    <StateEmpty
      v-else-if="items.length === 0"
      title="没有找到商品"
      description="试试更换关键词或选择其它分类。"
    >
      <button type="button" class="btn btn--ghost" @click="resetAll">清空筛选条件</button>
    </StateEmpty>

    <template v-else>
      <!--
        ⚠️ 只有商品数能铺满整数行时才启用 4 列（`.grid-4--full`）。
            当前商品库 6 件：4 列会排成「4 + 2」，第二行右侧空两列；
            3 列则排成整齐的 2 × 3。实测 1024px（3 列）比 1440px（4 列）更好看，
            说明桌面端默认 4 列对这个小商品库是错的取值。
      -->
      <div class="grid-4" :class="{ 'grid-4--full': items.length >= 8 }" style="padding-bottom: 24px">
        <ProductCard
          v-for="product in items"
          :key="product.id"
          :product="product"
          :show-category="showCardCategory"
          :heading-level="2"
          @add-to-cart="handleAddToCart"
        />
      </div>

      <nav v-if="totalPages > 1" class="pagination" aria-label="分页">
        <SmartLink v-if="currentPage > 1" :to="pageTarget(currentPage - 1)" class="btn btn--ghost">
          上一页
        </SmartLink>
        <span v-else class="btn btn--ghost" aria-disabled="true">上一页</span>

        <span class="pagination__info">第 {{ currentPage }} / {{ totalPages }} 页 · 共 {{ total }} 件</span>

        <SmartLink v-if="currentPage < totalPages" :to="pageTarget(currentPage + 1)" class="btn btn--ghost">
          下一页
        </SmartLink>
        <span v-else class="btn btn--ghost" aria-disabled="true">下一页</span>
      </nav>
    </template>
  </div>
</template>

<style scoped>
.pagination__info {
  /* ⚠️ 原先硬编码 13px —— 与令牌 `--fs-sm` 是同一个值，属重复定义。
     改用令牌后，字号阶梯调整时这里会一起走，不会再漂移。 */
  font-size: var(--fs-sm);
  color: var(--ink-3);
}

.need-note {
  margin: 0 0 24px;
}

/* 结果计数 + 生效筛选回显 */
.col-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  flex-wrap: wrap;
  margin-top: var(--sp-4);
}

.col-meta__count {
  font-size: var(--fs-sm);
  color: var(--ink-3);
}

.col-meta__filters {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  font-size: var(--fs-sm);
}

.col-meta__label {
  color: var(--ink-3);
}

.col-meta__tag {
  padding: 0.15rem 0.6rem;
  border: 1px solid var(--line-2);
  /* 与筛选 chip 同一套圆角：全站已放弃胶囊形（见 `--r-control` 的说明） */
  border-radius: var(--r-control);
  color: var(--ink);
  background: var(--surface);
}

.col-meta__clear {
  color: var(--brand-ink);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}

@media (max-width: 720px) {
  .search-pill {
    min-width: 100%;
  }
}
</style>
