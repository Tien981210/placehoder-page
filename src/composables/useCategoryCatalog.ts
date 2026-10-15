import { fetchCategories } from '@/api/client';
import type { CategoryView } from '@/api/types';

/**
 * 分类目录的**进程内共享加载器**。
 *
 * 为什么需要它：
 *   导航（`AppHeader`）、首页分类网格、分类页与商品列表页都必须按**后端真实分类**
 *   解析跳转目标（见 `common/categories.ts` 的 `resolveCategorySlug`）。
 *   若各处各写一个 `useAsyncData(() => fetchCategories())`，
 *   同一个页面上会出现多次完全相同的请求。
 *
 * 语义：
 *   - 并发调用复用**同一个 Promise**（同一帧内的多个组件只发一次请求）；
 *   - 成功结果长期复用（分类目录在一次会话内视为稳定）；
 *   - **失败时清空缓存** —— 否则一次网络抖动会被永久固化，
 *     后续导航再也拿不到分类，页面刷新也无济于事。
 *
 * ⚠️ 仅缓存「加载动作」，不缓存「组件状态」：每个调用方仍然各自持有
 *    `useAsyncData` 的 loading / error 状态，可以独立重试。
 */
let pending: Promise<CategoryView[]> | null = null;

export function loadCategoryCatalog(): Promise<CategoryView[]> {
  if (pending) return pending;

  pending = fetchCategories().catch((error: unknown) => {
    // 失败必须让缓存失效，否则重试永远拿到同一个 rejected Promise。
    pending = null;
    throw error;
  });

  return pending;
}

/** 仅供测试使用。 */
export function __resetCategoryCatalogForTest(): void {
  pending = null;
}
