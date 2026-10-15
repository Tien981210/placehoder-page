import { createRouter, createWebHistory } from 'vue-router';
import { routes } from './routes';

/**
 * 主站路由。
 *
 * 使用 HTML5 history 模式（createWebHistory）—— 因此部署时需要
 * 由服务器把未匹配的路径回退到 index.html（本地开发由 Vite dev server 负责）。
 *
 * 🔴 与 Luxra Beauty 原站的差异：**已移除全局导航守卫**。
 *    原站的 `requireAuthGuard` 会先恢复顾客会话，再把未登录用户弹到 `/login`。
 *    临时站没有 `/login`、没有顾客账户体系，该守卫失去意义，故一并删除；
 *    访客无论访问哪个页面都是可用的。
 */
export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    // 浏览器前进/后退时恢复原滚动位置；普通跳转回到顶部。
    return savedPosition ?? { top: 0 };
  },
});
