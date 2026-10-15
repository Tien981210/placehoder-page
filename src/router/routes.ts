import type { RouteRecordRaw } from 'vue-router';

/**
 * 页面路由表。
 *
 * 命名约定：路由 name 使用 kebab-case，页面组件使用 <Name>Page.vue。
 * 所有页面均为**惰性加载**（动态 import），避免首屏把全部页面打进同一个包。
 *
 * ⚠️ Luxra Beauty 临时站裁剪说明（后续真实开发阶段会整批复原）：
 *   · 已摘除 `/auth`、`/login`、`/register` —— 没有顾客账户体系；
 *   · 已摘除 `/account`、`/account/inquiries*` —— 没有「我的询价」；
 *   · 已摘除 `/orders`、`/orders/result` —— 没有游客订单查询。
 *   · **保留** `/cart` 与 `/checkout`：后端 `submit-inquiry.dto.ts` 要求
 *     `lines` 至少 1 个商品行，购物车是询价单的商品来源，
 *     删掉它询价表单将无法提交任何内容。
 *
 * 旧书签（/login、/account/*、/orders/*）会落到 404 —— 这是临时站的预期行为。
 */

declare module 'vue-router' {
  interface RouteMeta {
    /** 浏览器标签标题（见 App.vue）。 */
    title?: string;
    /**
     * 该路由的 meta description（见 App.vue）。
     *
     * ⚠️ 与 title 一样，只描述**本页确实存在**的内容：
     *    不写销量、认证、产地、成立年份或任何未证实的事实。
     */
    description?: string;
  }
}

export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/pages/HomePage.vue'),
    meta: {
      title: '首页',
      description:
        '首饰、假发与发片、美妆工具与美容配件。浏览商品详情后加入询价清单，客服跟进报价。',
    },
  },
  {
    path: '/categories',
    name: 'categories',
    component: () => import('@/pages/CategoriesPage.vue'),
    meta: {
      title: '商品分类',
      description:
        '按品类浏览在售商品：首饰、假发与发片、美妆工具与美容配件。价格与库存以商品页信息为准。',
    },
  },
  {
    path: '/products',
    name: 'products',
    component: () => import('@/pages/ProductListPage.vue'),
    meta: {
      title: '商品列表',
      description:
        '全部在售商品，支持按分类筛选与关键词搜索。本站为询价制，不提供在线支付。',
    },
  },
  {
    path: '/products/:slug',
    name: 'product-detail',
    component: () => import('@/pages/ProductDetailPage.vue'),
    meta: {
      title: '商品详情',
      description:
        '查看商品规格、价格与询价方式；加入询价清单后由客服核实库存与运费并回复报价。',
    },
  },
  {
    path: '/articles',
    name: 'articles',
    component: () => import('@/pages/ArticlesPage.vue'),
    meta: {
      title: '文章',
      description:
        '选品说明、佩戴与打理、尺码适配与询价流程 —— 内容筹备中。',
    },
  },
  {
    path: '/cart',
    name: 'cart',
    component: () => import('@/pages/CartPage.vue'),
    meta: {
      title: '询价清单',
      description:
        '查看已选商品、调整数量，并提交询价。本站为询价制，不提供在线支付。',
    },
  },
  {
    // 阶段 8-R：入口收敛。询价只有**一个**入口 —— /checkout。
    // /inquiry 保留为**历史链接兼容入口**（旧书签、外部链接、历史记录仍可用），
    // 仅做重定向，不再挂载页面。
    // 保留 name: 'inquiry'，因此 router.push({ name: 'inquiry' }) 仍可解析（会跟随重定向）。
    path: '/inquiry',
    name: 'inquiry',
    redirect: { name: 'checkout' },
    // 纯重定向路由不会渲染页面，因此**刻意不设 description**。
    meta: { title: '提交询价' },
  },
  {
    // 阶段 8：结算页 —— 询价的**唯一入口**。
    // 临时站没有登录态，因此对全体访客一律按游客行为处理：
    // 提交成功 → 结果页，由用户自行保存一次性访问凭证。
    path: '/checkout',
    name: 'checkout',
    component: () => import('@/pages/CheckoutPage.vue'),
    meta: {
      title: '提交询价',
      description:
        '填写联系方式与收货信息并提交询价，由客服核实库存与运费后回复报价。本页不涉及在线支付。',
    },
  },
  {
    // 阶段 8-R1：结果页路径收敛到 /checkout/result（与唯一入口 /checkout 同前缀）。
    // ⚠️ 路由 name **刻意保持** 'inquiry-result' —— 站内跳转全部按 name 进行
    //    （CheckoutPage 的 router.push({ name: 'inquiry-result' })）。
    path: '/checkout/result/:inquiryNo?',
    name: 'inquiry-result',
    component: () => import('@/pages/InquiryResultPage.vue'),
    meta: {
      title: '询价提交结果',
      description:
        '询价提交结果、询价编号与一次性访问凭证。',
    },
  },
  {
    // 阶段 8-R1：旧结果页路径保留为**兼容重定向** —— 旧书签、历史记录、
    // 已发出的链接都不会失效。inquiryNo 为可选参数，故用函数式 redirect
    // 条件化透传，并原样带上 query 与 hash。
    path: '/inquiry/result/:inquiryNo?',
    redirect: (to) => {
      const inquiryNo = to.params.inquiryNo;
      return {
        name: 'inquiry-result',
        params: typeof inquiryNo === 'string' && inquiryNo.length > 0 ? { inquiryNo } : {},
        query: to.query,
        hash: to.hash,
      };
    },
    meta: { title: '询价提交结果' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/pages/NotFoundPage.vue'),
    meta: {
      title: '页面不存在',
      description:
        '你访问的页面不存在，可返回首页或浏览在售商品。',
    },
  },
];
