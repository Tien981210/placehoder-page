<script setup lang="ts">
import { watch } from 'vue';
import { useRoute } from 'vue-router';
import AppFooter from '@/components/AppFooter.vue';
import AppHeader from '@/components/AppHeader.vue';
import CartDrawer from '@/components/CartDrawer.vue';
import CartFab from '@/components/CartFab.vue';
import ToastHost from '@/components/ToastHost.vue';
import { useVisitorTracking } from '@/visitor/useVisitorTracking';
import { BRAND } from '@/config';

const route = useRoute();
// 浏览器标签标题里的品牌名统一取自品牌配置，不再读构建期环境变量 ——
// 品牌定稿后只需改 `src/config/brand.ts` 一处。
const appTitle = BRAND.brandName;

/**
 * 按选择器覆写 `<meta>` 的 content。
 *
 * 标签不存在时**静默跳过** —— 不动态创建，避免在 `<head>` 里堆积
 * 一堆 index.html 未声明的标签。静态兜底见 index.html。
 */
function setMetaContent(selector: string, value: string): void {
  const tag = document.querySelector(selector);
  if (tag) tag.setAttribute('content', value);
}

/**
 * 同步浏览器标签标题，以及社交卡片的标题。
 *
 * og:title / twitter:title 与 `<title>` 用同一个值：三处不一致会让
 * 「分享出去的卡片标题」与「点进去看到的页面标题」对不上。
 */
watch(
  () => route.meta.title,
  (title) => {
    const full = typeof title === 'string' && title ? `${title} · ${appTitle}` : appTitle;
    document.title = full;
    setMetaContent('meta[property="og:title"]', full);
    setMetaContent('meta[name="twitter:title"]', full);
  },
  { immediate: true },
);

/**
 * 同步 meta description，以及社交卡片的描述。
 *
 * 单页应用只有一份静态 `<meta name="description">`（见 index.html），
 * 若不随路由更新，8 个页面会共用同一段描述 —— 搜索引擎无法区分页面主题。
 * 这里按 `route.meta.description` 覆写；未声明的路由保留静态兜底文案。
 */
watch(
  () => route.meta.description,
  (description) => {
    if (typeof description !== 'string' || !description) return;
    setMetaContent('meta[name="description"]', description);
    setMetaContent('meta[property="og:description"]', description);
    setMetaContent('meta[name="twitter:description"]', description);
  },
  { immediate: true },
);

/**
 * 同步 `<link rel="canonical">`。
 *
 * 为什么需要：单页应用的所有路由共用同一份 `index.html`，若不声明 canonical，
 * 搜索引擎会把 `/products?page=2&category=serum`、`/products?utm_source=…`
 * 这类参数变体都当成**独立页面**收录，产生重复内容。
 * 这里按当前路由给出**自指向** canonical（去掉 query 与 hash），
 * 让参数变体归并到同一个规范地址。
 *
 * 两条**刻意不生成** canonical 的路由：
 *   - `not-found`：错误页不应自指向，否则等于告诉搜索引擎「这个 404 是规范页」；
 *   - `inquiry-result`：路径里带一次性访问凭证（询价编号），属私人页面，
 *     不应被收录，也不该把凭证写进 meta 标签。
 *
 * ⚠️ 不硬编码任何生产域名 —— 用 `location.origin` 取当前来源，
 *    因此换域名 / 换端口都不需要改代码，也不会出现「canonical 指向错误站点」。
 */
const CANONICAL_EXCLUDED_ROUTES = new Set(['not-found', 'inquiry-result']);

watch(
  () => route.name,
  (name) => {
    const head = document.head;
    let link = head.querySelector<HTMLLinkElement>('link[rel="canonical"]');

    if (typeof name === 'string' && CANONICAL_EXCLUDED_ROUTES.has(name)) {
      link?.remove();
      return;
    }

    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      head.appendChild(link);
    }
    link.href = `${window.location.origin}${route.path}`;
  },
  { immediate: true },
);

// G6-5.8 —— 匿名访客访问统计。
// 首次进入生成 / 读取 visitorId，并在每次路由变化时上报一次访问。
// ⚠️ 上报在浏览器空闲时段执行且**从不被 await** ⇒ 不影响页面加载；
//    接口失败**静默吞掉** ⇒ 统计坏了也不影响浏览。
useVisitorTracking();
</script>

<template>
  <div class="app-shell">
    <a class="skip-link" href="#main-content">跳到主要内容</a>
    <AppHeader />

    <main id="main-content" class="app-main">
      <RouterView />
    </main>

    <AppFooter />

    <CartFab />
    <CartDrawer />
    <ToastHost />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}

.app-shell > :deep(.site-header) {
  flex: none;
}

.app-main {
  flex: 1;
}

.skip-link {
  position: absolute;
  left: -9999px;
  top: 0;
  z-index: 130;
  padding: 0.5rem 0.9rem;
  background: var(--ink);
  color: #fff;
  border-radius: 0 0 8px 0;
}

.skip-link:focus {
  left: 0;
}
</style>
