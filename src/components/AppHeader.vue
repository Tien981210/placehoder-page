<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { CategoryView } from '@/api/types';
import { resolveSiteCategories, type ResolvedSiteCategory } from '@/common/categories';
import { BRAND, CONTACT_MESSAGES, SITE_CATEGORIES, SITE_FEATURES, brandWhatsAppUrl } from '@/config';
import { useCart } from '@/cart/useCart';
import { useCartDrawer } from '@/composables/useCartDrawer';
import { useScrollLock } from '@/composables/useScrollLock';
import { useAsyncData } from '@/composables/useAsyncData';
import { loadCategoryCatalog } from '@/composables/useCategoryCatalog';
import SmartLink from '@/components/SmartLink.vue';

/**
 * 顶部导航。
 *
 * 设计要点：
 *   1. 品牌信息（名称 / 标记 / 联系方式）全部来自 `src/config/brand.ts`，
 *      本组件不写死任何品牌名、号码或色值。
 *   2. 导航品类来自 `SITE_CATEGORIES`，但**跳转目标必须按后端真实分类解析**
 *      （`resolveSiteCategories`）—— 数据源里没有的品类退化为「全部商品」
 *      并如实提示，绝不生成指向空列表的链接。
 *   3. 分类目录走 `loadCategoryCatalog()` 共享加载器：同一页面多个入口
 *      只发一次请求（P7 重复请求）。
 */

const router = useRouter();
const { totalQuantity } = useCart();
const { openDrawer } = useCartDrawer();

/* ------------------------------ 导航品类解析 ------------------------------ */

const categoryCatalog = useAsyncData(loadCategoryCatalog);
const catalog = computed<CategoryView[]>(() => categoryCatalog.data.value ?? []);

/** 四大目标品类 × 后端真实分类 = 可直接跳转的导航项。 */
const navItems = computed<ResolvedSiteCategory[]>(() =>
  resolveSiteCategories(SITE_CATEGORIES, catalog.value),
);

/** 品类商品尚未上架的数量 —— 用于给出如实提示，而不是假装分类已建好。 */
const pendingCategoryCount = computed(() => navItems.value.filter((item) => !item.slug).length);

/* ------------------------------ 联系入口 ------------------------------ */

/**
 * 页头联系入口 —— 号码来自品牌配置；**未配置时不渲染该入口**
 * （不留一个点了没反应的按钮）。
 */
const whatsappUrl = computed(() => brandWhatsAppUrl(CONTACT_MESSAGES.headerGreeting));

/* ------------------------------ 公告条 ------------------------------ */

const noticeClosed = ref(false);

/**
 * 公告条文案 —— 只陈述**真实存在**的业务规则。
 *
 * ⚠️ 刻意不含任何折扣、满减、限时或包邮承诺：这些既无数据来源，
 *    也与询价制业务不符。
 */
const NOTICE_TEXT = '本站为询价制：提交询价后由客服核实库存与运费并回复报价，不直接在线支付。';

/* ------------------------------ 滚动状态 ------------------------------ */

const scrolled = ref(false);

function onScroll(): void {
  scrolled.value = window.scrollY > 16;
}

/* ------------------------------ Mega 面板 ------------------------------ */

const megaKey = ref<string | null>(null);
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const activeItem = computed(
  () => navItems.value.find((item) => item.category.key === megaKey.value) ?? null,
);

/** 面板里的「其他品类」快捷入口（排除当前展开的那个）。 */
const otherItems = computed(() =>
  navItems.value.filter((item) => item.category.key !== megaKey.value),
);

function cancelClose(): void {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
}

function openMega(key: string): void {
  cancelClose();
  megaKey.value = key;
}

function scheduleClose(): void {
  // 触屏 / 窄屏没有 hover 语义，收起交给点击与 Esc，避免误收起
  if (window.innerWidth <= 980) return;
  cancelClose();
  closeTimer = setTimeout(() => {
    megaKey.value = null;
  }, 160);
}

function toggleMega(key: string): void {
  if (megaKey.value === key) {
    megaKey.value = null;
    return;
  }
  openMega(key);
}

function closeMega(): void {
  megaKey.value = null;
}

/* ------------------------------ 移动端菜单 ------------------------------ */

const mobileOpen = ref(false);

/**
 * 移动端菜单打开时锁定背景滚动。
 *
 * ⚠️ Phase 2.2 修正（P1-15）：此前菜单打开后 `<body>` 完全没有被锁定
 *    （真实浏览器实测：打开菜单后 `body` 仍是 `overflow: hidden auto`、
 *    `html` 为 `visible`），背景页面照旧能滚 —— 用户滑到的其实是菜单
 *    后面的页面，菜单本身看起来「跟着跑」。
 *
 * ⚠️ 锁与询价清单抽屉共用同一份带引用计数的实现（`useScrollLock`），
 *    否则「菜单 + 抽屉同时打开」时先关掉的那个会把 body 解锁。
 */
useScrollLock(mobileOpen);

function closeMobile(): void {
  mobileOpen.value = false;
}

/* ------------------------------ 全局事件 ------------------------------ */

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  closeMega();
  closeMobile();
}

function goProducts(): void {
  closeMobile();
  closeMega();
  void router.push({ name: 'products' });
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('keydown', onKeydown);
  onScroll();
});

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('keydown', onKeydown);
  cancelClose();
});
</script>

<template>
  <header class="site-header" :class="{ 'site-header--no-promo': noticeClosed }">
    <!-- 公告条：如实说明询价制，不含折扣承诺 -->
    <div v-if="!noticeClosed" class="promo">
      <span>
        <b>询价制</b><span class="promo-extra"> · {{ NOTICE_TEXT }}</span
        ><span class="promo-short"> · 提交后由客服核实并报价，不直接在线支付</span>
      </span>
      <button type="button" class="promo-close" aria-label="关闭公告条" @click="noticeClosed = true">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <div class="nav-bar" :class="{ scrolled, 'mega-open': megaKey !== null }">
      <div class="nav-inner">
        <SmartLink :to="{ name: 'home' }" class="brand" :aria-label="`${BRAND.brandName} 首页`">
          <img class="brand__mark" :src="BRAND.brandLogo" alt="" width="30" height="30" />
          <span class="brand__name">{{ BRAND.brandName }}</span>
        </SmartLink>

        <nav class="menu" aria-label="主导航">
          <div
            v-for="item in navItems"
            :key="item.category.key"
            class="menu-item"
            :class="{ open: megaKey === item.category.key }"
            @mouseenter="openMega(item.category.key)"
            @mouseleave="scheduleClose"
          >
            <button
              type="button"
              class="menu-btn"
              aria-haspopup="true"
              :aria-expanded="megaKey === item.category.key ? 'true' : 'false'"
              @click="toggleMega(item.category.key)"
            >
              {{ item.category.label }}
              <svg class="chev" width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M2.5 4.5L6 8l3.5-3.5"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>

          <SmartLink :to="{ name: 'products' }" class="menu-btn menu-btn--accent" @click="closeMega">
            全部商品
          </SmartLink>
        </nav>

        <div class="utils">
          <button type="button" class="util-btn" @click="goProducts">
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.7" />
              <path d="M13.5 13.5L18 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
            </svg>
            <span>搜索</span>
          </button>

          <!-- 号码未配置时整条入口不渲染，避免死链 / 空按钮 -->
          <a
            v-if="whatsappUrl"
            :href="whatsappUrl"
            class="util-btn"
            target="_blank"
            rel="noopener noreferrer"
            :aria-label="`通过 WhatsApp 联系${BRAND.brandName}`"
          >
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path
                d="M10 2.6a7.4 7.4 0 0 0-6.3 11.3L2.6 17.4l3.6-1a7.4 7.4 0 1 0 3.8-13.8z"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linejoin="round"
              />
              <path
                d="M7.4 7.1c0 .9 1.4 2.6 2.6 3.6 1.2 1 2.6 1.4 2.6 1.4"
                stroke="currentColor"
                stroke-width="1.7"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span>联系我们</span>
          </a>

          <button
            type="button"
            class="util-btn"
            :aria-label="`打开询价清单，当前 ${totalQuantity} 件商品`"
            @click="openDrawer"
          >
            <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M4 6.5h12l-1 10.5H5L4 6.5z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
              <path d="M7.2 6.5V5.2a2.8 2.8 0 015.6 0v1.3" stroke="currentColor" stroke-width="1.7" />
            </svg>
            <span>询价清单</span>
            <span class="badge" :class="{ zero: totalQuantity === 0 }" aria-hidden="true">{{ totalQuantity }}</span>
          </button>
        </div>

        <button
          type="button"
          class="hamburger icon-btn"
          aria-label="打开菜单"
          :aria-expanded="mobileOpen ? 'true' : 'false'"
          @click="mobileOpen = true"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M2 5h16M2 10h16M2 15h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
      </div>

      <!-- Mega 面板：当前品类介绍 + 其他品类快捷入口 + 底部全站入口 -->
      <div class="mega-layer" @mouseenter="cancelClose" @mouseleave="scheduleClose">
        <div v-if="activeItem" class="mega" :class="{ show: megaKey !== null }">
          <div class="mega-col">
            <div class="mega-headline">
              {{ activeItem.category.label }}
              <span class="mega-headline-zh">{{ activeItem.category.labelZh }}</span>
            </div>
            <p class="mega-blurb">{{ activeItem.category.blurb }}</p>

            <p v-if="activeItem.slug" class="mega-hint" style="margin-top: var(--sp-3)">
              该品类已在售，点击下方按钮查看全部商品。
            </p>
            <p v-else class="mega-hint" style="margin-top: var(--sp-3)">
              「{{ activeItem.category.labelZh }}」分类下暂时还没有商品，点击将展示全部商品。
            </p>

            <div class="subcat-list">
              <SmartLink :to="activeItem.target" class="subcat" @click="closeMega">
                {{ activeItem.slug ? `查看${activeItem.category.labelZh}` : '查看全部商品' }}
              </SmartLink>
              <SmartLink :to="{ name: 'categories' }" class="subcat" @click="closeMega">
                全部分类
              </SmartLink>
            </div>
          </div>

          <div class="mega-col">
            <div class="mega-col-title">其他品类</div>
            <div class="subcat-list" style="margin-top: 0">
              <SmartLink
                v-for="other in otherItems"
                :key="other.category.key"
                :to="other.target"
                class="subcat"
                @click="closeMega"
              >
                {{ other.category.label }}
              </SmartLink>
            </div>

            <div class="mega-col-title" style="margin-top: var(--sp-5)">快速入口</div>
            <div class="subcat-list" style="margin-top: 0">
              <SmartLink :to="{ name: 'products' }" class="subcat" @click="closeMega">全部商品</SmartLink>
              <SmartLink :to="{ name: 'cart' }" class="subcat" @click="closeMega">询价清单</SmartLink>
              <SmartLink :to="{ name: 'checkout' }" class="subcat" @click="closeMega">提交询价</SmartLink>
              <SmartLink v-if="SITE_FEATURES.articles" :to="{ name: 'articles' }" class="subcat" @click="closeMega">
                文章
              </SmartLink>
            </div>
          </div>

          <div class="mega-foot">
            <SmartLink :to="activeItem.target" class="mega-all" @click="closeMega">
              查看{{ activeItem.slug ? `全部${activeItem.category.labelZh}` : '全部' }}商品
            </SmartLink>
            <span v-if="pendingCategoryCount > 0" class="mega-hint">
              商品库中已有 {{ navItems.length - pendingCategoryCount }} / {{ navItems.length }} 个品类上架商品。
            </span>
            <span v-else class="mega-hint">按 Esc 或点击空白处收起</span>
          </div>
        </div>
      </div>
    </div>
  </header>

  <!-- 移动端菜单 -->
  <div class="mobile-menu" :class="{ show: mobileOpen }">
    <div class="mm-head">
      <span class="brand" style="margin: 0">
        <img class="brand__mark" :src="BRAND.brandLogo" alt="" width="26" height="26" />
        <span class="brand__name brand__name--sm">{{ BRAND.brandName }}</span>
      </span>
      <button type="button" class="drawer-close icon-btn" aria-label="关闭菜单" @click="closeMobile">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </button>
    </div>

    <div class="mm-section-title">商品品类</div>
    <template v-for="item in navItems" :key="item.category.key">
      <SmartLink :to="item.target" class="mm-link" @click="closeMobile">
        {{ item.category.label }}
        <span class="mm-link__zh">{{ item.category.labelZh }}</span>
      </SmartLink>
      <p v-if="!item.slug" class="mm-note">该品类下暂时还没有商品，点击将展示全部商品。</p>
    </template>

    <div class="mm-section-title">快速入口</div>
    <SmartLink :to="{ name: 'products' }" class="mm-sub" @click="closeMobile">全部商品</SmartLink>
    <SmartLink :to="{ name: 'categories' }" class="mm-sub" @click="closeMobile">商品分类</SmartLink>
    <SmartLink :to="{ name: 'cart' }" class="mm-sub" @click="closeMobile">询价清单</SmartLink>
    <SmartLink :to="{ name: 'checkout' }" class="mm-sub" @click="closeMobile">提交询价</SmartLink>
    <SmartLink v-if="SITE_FEATURES.articles" :to="{ name: 'articles' }" class="mm-sub" @click="closeMobile">
      文章
    </SmartLink>

    <template v-if="whatsappUrl">
      <div class="mm-section-title">联系我们</div>
      <a
        :href="whatsappUrl"
        class="mm-sub"
        target="_blank"
        rel="noopener noreferrer"
        @click="closeMobile"
      >
        通过 WhatsApp 联系我们
      </a>
    </template>
  </div>
</template>
