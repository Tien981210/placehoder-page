import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { trackVisit } from '@/api/visits';
import { ensureVisitorId } from './visitor-id';

/**
 * 主站访客采集（G6-5.8）。
 *
 * ## 行为
 *   1. **首次进入**：由 `ensureVisitorId()` 生成 / 读取 `visitorId`（localStorage，UUID v4）；
 *   2. **每次路由变化**（含首次）向 `POST /api/v1/visitor/track` 发一次上报；
 *   3. 上报**不携带任何页面路径 / 账号信息**（见 `api/visits.ts`）。
 *
 * ## 🔴 两条硬约束
 *   - **不影响页面加载**：上报被调度到**空闲时段**（`requestIdleCallback`，
 *     不支持时退化为 `setTimeout(…, 0)`），且**从不被 await** ——
 *     渲染路径上没有任何 await 点，网络慢也不会让页面卡住；
 *   - **失败静默**：网络错误 / 超时 / 后端 5xx **全部吞掉**，
 *     绝不弹提示、绝不写 `console.error`、绝不改变任何界面状态。
 *     统计是旁路能力，它坏了不能影响用户浏览。
 *
 * ## 为什么监听 `route.matched.length > 0 ? fullPath : null` 而不是直接监听 `fullPath`
 *   Vue Router 在**首次导航完成之前**，`useRoute()` 返回的是起始位置
 *   （`path === '/'`，`matched` 为空）。若直接监听 `fullPath`：
 *   - 落在首页时：起始 `/` → 解析后 `/` ⇒ **路径没变，watch 不触发** ⇒ **首次访问丢失**；
 *   - 落在内页时：起始 `/` → 解析后 `/products` ⇒ 触发，但会**多算一次**首页访问。
 *   改用「未解析 ⇒ `null`」后，两种情况都只触发**一次**且数值正确。
 *
 * ## 为什么 `visitorId` 与登录态无关
 *   匿名流量口径不随登录 / 登出变化（见 `visitor-id.ts` 的说明）。
 *   本 composable **不读取** `useAccount()` 的任何状态 —— 结构上不可能产生耦合。
 */

/** 上报函数签名（可注入，便于测试）。 */
export type VisitorReportFn = (visitorId: string) => Promise<unknown>;

export interface VisitorTrackingOptions {
  /** 上报实现；默认 `trackVisit`（真实 HTTP）。 */
  readonly report?: VisitorReportFn;
  /** 任务调度器；默认空闲调度。测试可注入为立即执行。 */
  readonly schedule?: (task: () => void) => void;
}

/** 在组件 `setup()` 中调用一次即可（本项目只在根组件 `App.vue` 调用）。 */
export function useVisitorTracking(options: VisitorTrackingOptions = {}): void {
  const route = useRoute();
  const report = options.report ?? trackVisit;
  const schedule = options.schedule ?? scheduleIdle;

  /** 上一次已计入的路径 —— 防止同一路径被重复上报。 */
  let lastReportedPath: string | null = null;

  const resolvedPath = computed(() => (route.matched.length > 0 ? route.fullPath : null));

  watch(
    resolvedPath,
    (path) => {
      if (!path || path === lastReportedPath) return;
      lastReportedPath = path;
      // 先记账、后调度：即使上报失败也不重复补发（统计不做重试，避免放大错误）。
      schedule(() => {
        void send();
      });
    },
    { immediate: true },
  );

  async function send(): Promise<void> {
    const visitorId = ensureVisitorId();
    // 无法持久化标识 ⇒ 放弃上报（宁可少统计，也不给出错误的 UV）
    if (!visitorId) return;

    try {
      await report(visitorId);
    } catch {
      // 🔴 失败静默：统计链路的问题一律不外显。
    }
  }
}

/**
 * 把任务排到浏览器空闲时段。
 *
 * ⚠️ 通过 `globalThis.requestIdleCallback` 以**方法调用**形式调用 ——
 *    解构后单独调用会触发浏览器的 "Illegal invocation"。
 */
function scheduleIdle(task: () => void): void {
  const target = globalThis as {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };

  if (typeof target.requestIdleCallback === 'function') {
    target.requestIdleCallback(task, { timeout: 2_000 });
    return;
  }

  setTimeout(task, 0);
}
