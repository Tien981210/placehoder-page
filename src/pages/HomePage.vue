<script setup lang="ts">
import { computed } from 'vue';
import { fetchProducts } from '@/api/client';
import { resolveSiteCategories, unmatchedCategories } from '@/common/categories';
import {
  HERO_PLACEHOLDER_URL,
  categoryPlaceholder,
  placeholderImageFor,
  type PlaceholderImage,
} from '@/common/placeholderImage';
import {
  BRAND,
  CONTACT_MESSAGES,
  HOME_HERO,
  HOME_SECTIONS,
  SITE_CATEGORIES,
  SITE_SERVICE_ITEMS,
  brandWhatsAppUrl,
} from '@/config';
import { useAsyncData } from '@/composables/useAsyncData';
import { loadCategoryCatalog } from '@/composables/useCategoryCatalog';
import ProductCard from '@/components/ProductCard.vue';
import SmartLink from '@/components/SmartLink.vue';
import StateEmpty from '@/components/StateEmpty.vue';
import StateError from '@/components/StateError.vue';
import StateLoading from '@/components/StateLoading.vue';
import { useCart } from '@/cart/useCart';
import { useToast } from '@/composables/useToast';
import type { ProductView } from '@/api/types';
import type { RouteLocationRaw } from 'vue-router';

/**
 * 首页。
 *
 * P7 修复：原先「精选」与「新品」各发一次商品请求（pageSize 4 / 8），
 *   同屏两次请求返回的其实是同一批数据的前缀。现在**只发一次**
 *   `pageSize=8`，前 4 件做精选、其余做「更多商品」。
 *
 * 品类区块的数据来源：
 *   1. 后端真实存在的分类（当前是 `serum` / 护肤精华）—— **排在最前**，
 *      因为它才是真有商品的品类，不能让真实数据被四个空品类挤掉；
 *   2. 站点四大目标品类 —— 未上架时如实标注「筹备中」并退化为全部商品。
 *
 * 第二阶段首屏改动：
 *   · 首屏新增**品类快捷入口**（四个目标品类），把「逛什么」提前到第一屏；
 *   · 主视觉图注从图片上的浮层移到图外，图片完整可见；
 *   · 图片列收窄，避免 4:5 竖图把首屏撑出一屏之外。
 */

const HOMEPAGE_PAGE_SIZE = 8;

const catalog = useAsyncData(loadCategoryCatalog);
const products = useAsyncData(() => fetchProducts({ page: 1, pageSize: HOMEPAGE_PAGE_SIZE }));

const { addLine } = useCart();
const { show } = useToast();

const categories = computed(() => catalog.data.value ?? []);

/** 首屏品类快捷入口 —— 与主导航同一套解析结果（真实分类缺失时退化为全部商品）。 */
const heroCategories = computed(() => resolveSiteCategories(SITE_CATEGORIES, categories.value));

/**
 * 首页只渲染**一个**商品网格。
 *
 * ⚠️ Phase 2.2 修正：原先拆成「精选好物（4 件）」＋「更多商品（其余）」两组，
 *    两组用的是完全相同的卡片模板与 4 列网格 —— 规范 2.1 明确禁止
 *    「同一页面连续出现多组结构完全相同的卡片网格」；
 *    而且 6 件商品被切成 4+2，第二组又是 2 张卡占 4 列、右侧两列空。
 *    现在合并为一组（一次请求、一个网格），页面上只有一处商品墙。
 */
const productItems = computed<ProductView[]>(() => products.data.value?.items ?? []);

/**
 * 是否在卡片上重复渲染分类名。
 *
 * ⚠️ 当结果集只有一个分类时（当前商品库 6/6 件都在「护肤精华」下），
 *    每张卡都印同一个分类名 = 零信息量噪音；在按分类筛选后的列表页
 *    更是与筛选条件完全重复。此时不渲染。
 */
const showCardCategory = computed(() => {
  const names = new Set(productItems.value.map((item) => item.category?.name ?? ''));
  return names.size > 1;
});

/** 分类卡片的统一形状 —— 真实分类与目标品类走同一个渲染分支。 */
interface CategoryCard {
  key: string;
  /** 主标题（真实分类用后端名，目标品类用英文名） */
  label: string;
  /** 副标题（目标品类的中文名；真实分类为空） */
  sub: string;
  blurb: string;
  target: RouteLocationRaw;
  /** 该品类是否真的已有商品可看 */
  available: boolean;
  /** 品类占位图；推断不出主题时为 `null`（回落到品牌标记） */
  photo: PlaceholderImage | null;
}

/**
 * 分类卡片列表 —— 拆成两组，**结构上分开渲染**。
 *
 * ⚠️ 为什么必须拆开（Phase 2.2 修正）：
 *   原先真实分类与四个目标品类混在同一个 4 列网格里，共 5 张卡 ⇒
 *   第二行只剩 1 张（Beauty Accessories）、右侧 3 列全空。
 *   更要紧的是语义：真实分类是「现在能买的」，目标品类是「还没建立的」，
 *   把两者混在同一个网格里，等于用版式暗示它们地位相同。
 *   现在拆成「在售品类」与「目标品类方向（筹备中）」两个区块，
 *   各自成整齐网格，状态差异由**结构**表达而不是靠一枚小标签。
 */
const realCategoryCards = computed<CategoryCard[]>(() =>
  unmatchedCategories(categories.value, SITE_CATEGORIES).map((category) => ({
    key: `real-${category.slug}`,
    label: category.name,
    sub: '',
    blurb: category.description ?? '该品类下的在售商品。',
    target: { name: 'products', query: { category: category.slug } },
    available: true,
    photo: placeholderImageFor(
      category.slug,
      [category.name, category.slug, category.description],
      category.name,
    ),
  })),
);

const targetCategoryCards = computed<CategoryCard[]>(() =>
  heroCategories.value.map((item) => ({
    key: item.category.key,
    /*
     * ⚠️ 标题用**中文名**、副标题用英文名。
     *    原先目标品类卡是「英文主标题 + 中文副标题」，而真实分类卡是
     *    「中文主标题 + 无副标题」，同一网格内两套语言层级 ⇒ 观感不一致。
     *    现在统一为「中文主标题 + 英文副标题」。
     */
    label: item.category.labelZh,
    sub: item.category.label,
    blurb: item.category.blurb,
    target: item.target,
    available: Boolean(item.slug),
    photo: categoryPlaceholder(item.category.key, item.category.key, item.category.labelZh),
  })),
);

/** 四大目标品类中已上架的数量 —— 用于给出如实说明，而不是假装品类齐全。 */
const targetAvailableCount = computed(
  () => heroCategories.value.filter((item) => item.slug).length,
);

const whatsappUrl = computed(() => brandWhatsAppUrl(CONTACT_MESSAGES.heroGreeting));

const brandNoteItems = [
  '浏览商品详情后加入询价清单，填写联系方式即可提交询价。',
  '客服核实库存与适用运费后，通过你选择的方式回复报价。',
  '本站不提供在线支付，也不会自动扣款；价格与库存以商品页信息为准。',
];

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
  <section class="hero" aria-label="首页主视觉">
    <div class="wrap">
      <div class="hero__grid">
        <div class="hero__intro">
          <p class="overline hero__kicker">{{ HOME_HERO.kicker }}</p>
          <h1 class="hero__title">{{ HOME_HERO.headline }}</h1>
          <p class="hero__text">{{ HOME_HERO.supporting }}</p>

          <div class="hero__cta">
            <SmartLink :to="{ name: 'products' }" class="btn btn--primary">
              {{ HOME_HERO.primaryCta }}
            </SmartLink>
            <a
              v-if="whatsappUrl"
              :href="whatsappUrl"
              class="btn btn--ghost"
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp 咨询
            </a>
          </div>

          <!--
            首屏品类快捷入口。
            ⚠️ 未上架的品类同样可点 —— 目标由 `resolveSiteCategories()` 解析，
               缺分类时退化为「全部商品」，不会指向空列表。
          -->
          <nav class="hero__cats" :aria-label="HOME_HERO.secondaryCta">
            <span class="hero__cats-label">{{ HOME_HERO.secondaryCta }}</span>
            <div class="hero__cat-list">
              <SmartLink
                v-for="item in heroCategories"
                :key="item.category.key"
                :to="item.target"
                class="hero__cat"
              >
                {{ item.category.label }}
                <small>{{ item.category.labelZh }}</small>
              </SmartLink>
            </div>
          </nav>
        </div>

        <!-- 主视觉图位：品牌尚未提供实拍大图，暂用示意图占位并如实标注 -->
        <div class="hero__media-col">
          <div class="hero__media">
            <img
              class="hero__photo"
              :src="HERO_PLACEHOLDER_URL"
              alt=""
              loading="eager"
              decoding="async"
            />
          </div>
          <p class="hero__note">
            示意图 —— 品牌主视觉图尚未提供，此处暂用占位图，替换真实素材后即自动生效。
          </p>
        </div>
      </div>
    </div>
  </section>

  <!-- 服务说明：只写本站真实存在的流程步骤 -->
  <section class="service-strip" aria-label="询价流程说明">
    <div class="wrap">
      <div class="service-grid">
        <div v-for="(item, index) in SITE_SERVICE_ITEMS" :key="item.title" class="service-item">
          <span class="service-item__index" aria-hidden="true">{{ index + 1 }}</span>
          <div>
            <div class="service-item__title">{{ item.title }}</div>
            <p class="service-item__text">{{ item.text }}</p>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- 品类 -->
  <section class="section">
    <div class="wrap">
      <div class="sec-head">
        <div>
          <p class="overline">{{ HOME_SECTIONS.categories.overline }}</p>
          <h2 class="sec-title">{{ HOME_SECTIONS.categories.title }}</h2>
          <p class="sec-sub">{{ HOME_SECTIONS.categories.subtitle }}</p>
        </div>
        <SmartLink :to="{ name: 'categories' }" class="sec-more">
          {{ HOME_SECTIONS.categories.moreLabel }} →
        </SmartLink>
      </div>

      <StateLoading v-if="catalog.isLoading.value" />
      <StateError v-else-if="catalog.isError.value" :error="catalog.error.value" @retry="catalog.load" />
      <StateEmpty
        v-else-if="realCategoryCards.length === 0 && targetCategoryCards.length === 0"
        title="暂无分类"
        description="商品库尚未配置任何启用中的分类。"
      />
      <template v-else>
        <!--
          在售品类 —— 后端确实建立了分类、也确实有商品可买。
          用 flex 流式排布而不是 4 列网格：分类数量是数据驱动的（当前 1 个），
          固定列数会在分类数不是列数整数倍时留下空列。
        -->
        <div v-if="realCategoryCards.length > 0" class="cat-grid cat-grid--real">
          <SmartLink
            v-for="card in realCategoryCards"
            :key="card.key"
            :to="card.target"
            class="cat-card"
          >
            <div class="cat-card__media">
              <img
                v-if="card.photo"
                class="cat-card__photo"
                :src="card.photo.url"
                :alt="card.photo.alt"
                loading="lazy"
                decoding="async"
              />
              <img v-else class="cat-card__mark" :src="BRAND.brandLogo" alt="" aria-hidden="true" />
              <span class="cat-card__status">在售</span>
            </div>
            <div class="cat-card__body">
              <h3 class="cat-card__name">{{ card.label }}</h3>
              <div v-if="card.sub" class="cat-card__zh">{{ card.sub }}</div>
              <p class="cat-card__blurb">{{ card.blurb }}</p>
              <span class="cat-card__cta">查看该品类商品 →</span>
            </div>
          </SmartLink>
        </div>

        <!--
          目标品类方向 —— 商品库里**尚未建立**这四个分类。
          与上一区块分开渲染，状态差异由结构表达；卡片本身也如实标注「筹备中」。
        -->
        <div v-if="targetCategoryCards.length > 0" class="cat-targets">
          <p class="cat-targets__label" id="cat-targets-label">目标品类方向（筹备中）</p>
          <div class="cat-grid cat-grid--target" role="list" aria-labelledby="cat-targets-label">
            <SmartLink
              v-for="card in targetCategoryCards"
              :key="card.key"
              :to="card.target"
              class="cat-card"
              role="listitem"
            >
              <div class="cat-card__media">
                <img
                  v-if="card.photo"
                  class="cat-card__photo"
                  :src="card.photo.url"
                  :alt="card.photo.alt"
                  loading="lazy"
                  decoding="async"
                />
                <img v-else class="cat-card__mark" :src="BRAND.brandLogo" alt="" aria-hidden="true" />
                <span class="cat-card__status">筹备中</span>
              </div>
              <div class="cat-card__body">
                <h3 class="cat-card__name">{{ card.label }}</h3>
                <div v-if="card.sub" class="cat-card__zh">{{ card.sub }}</div>
                <p class="cat-card__blurb">{{ card.blurb }}</p>
                <span class="cat-card__cta">查看全部商品 →</span>
              </div>
            </SmartLink>
          </div>
        </div>

        <p v-if="targetAvailableCount === 0" class="notice notice--info cat-targets__note">
          标注「筹备中」的品类在商品库中尚未建立，点击后展示的是全部在售商品。
        </p>
      </template>
    </div>
  </section>

  <!-- 商品墙：全站只有这一组卡片网格 -->
  <section class="section section--tight">
    <div class="wrap">
      <div class="sec-head">
        <div>
          <p class="overline">{{ HOME_SECTIONS.featured.overline }}</p>
          <h2 class="sec-title">{{ HOME_SECTIONS.featured.title }}</h2>
          <p class="sec-sub">{{ HOME_SECTIONS.featured.subtitle }}</p>
        </div>
        <SmartLink :to="{ name: 'products' }" class="sec-more">
          {{ HOME_SECTIONS.featured.moreLabel }} →
        </SmartLink>
      </div>

      <StateLoading v-if="products.isLoading.value" />
      <StateError
        v-else-if="products.isError.value"
        :error="products.error.value"
        @retry="products.load"
      />
      <StateEmpty
        v-else-if="productItems.length === 0"
        title="暂无商品"
        description="商品库中还没有在售商品，请稍后再来。"
      />
      <div v-else class="grid-4" :class="{ 'grid-4--full': productItems.length >= 8 }">
        <ProductCard
          v-for="product in productItems"
          :key="product.id"
          :product="product"
          :show-category="showCardCategory"
          @add-to-cart="handleAddToCart"
        />
      </div>
    </div>
  </section>

  <!-- 品牌说明：只写业务规则，不含任何未证实的品牌事实 -->
  <section class="section">
    <div class="wrap">
      <div class="brand-note">
        <div>
          <p class="overline">{{ HOME_SECTIONS.brandNote.overline }}</p>
          <h2 class="brand-note__title">{{ HOME_SECTIONS.brandNote.title }}</h2>
          <p class="brand-note__text">
            {{ BRAND.brandName }} 采用询价制：先把想买的商品加入询价清单并留下联系方式，
            由客服核实后回复报价。这样做的原因是商品规格、库存与运费需要逐单确认，
            而不是用一个统一的「立即购买」按钮含糊带过。
          </p>
          <div class="hero__cta">
            <SmartLink :to="{ name: 'products' }" class="btn btn--primary">开始挑选</SmartLink>
            <SmartLink :to="{ name: 'cart' }" class="btn btn--ghost">查看询价清单</SmartLink>
          </div>
        </div>

        <ul class="brand-note__list">
          <li v-for="item in brandNoteItems" :key="item">{{ item }}</li>
        </ul>
      </div>
    </div>
  </section>
</template>
