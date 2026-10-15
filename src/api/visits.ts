import { apiRequest } from '@/api/http';

/**
 * 访客上报接口（G6-5.8）。
 *
 * ## 为什么放在 `src/api/` 而**不**并进 `client.ts`
 *   `client.ts` 是「页面数据源」客户端，它带 `VITE_USE_MOCK` 演示模式开关 ——
 *   而访客上报**不是页面数据**：它是旁路副作用，
 *   - 演示模式下**同样应该上报**（演示站也是真实访问）；
 *   - 失败**绝不能**影响页面（页面根本不消费它的结果）。
 *   把它塞进 `client.ts` 会让「演示模式」这一开关的语义变模糊，
 *   因此单独成文件，但仍在 `src/api/` 内统一走 `http.ts` 的 HTTP 层。
 *
 * 🔴 本文件**只发送** `visitorId`：
 *    不发当前路径、不发商品、不发账户信息 —— 上报内容最小化。
 *    （「SPA 路由变化记录访问」由**每次导航发一次**实现，
 *     因此「访问次数」有意义，而「浏览了什么」不被记录。）
 */

/** 上报响应（后端恒返回 `{ success: true }`）。 */
export interface TrackVisitResponse {
  readonly success: true;
}

/** 上报超时（毫秒）。刻意短：统计请求不该在后台长期挂着。 */
export const TRACK_VISIT_TIMEOUT_MS = 5_000;

/**
 * 上报一次访问。
 *
 * ⚠️ **会抛错**（网络 / 超时 / 非 2xx）—— 调用方必须自行吞掉，
 *    这是刻意的：把「静默」的决定权留给调用方，本函数保持可测试的诚实语义。
 */
export function trackVisit(visitorId: string): Promise<TrackVisitResponse> {
  return apiRequest<TrackVisitResponse>('/visitor/track', {
    method: 'POST',
    body: { visitorId },
    timeoutMs: TRACK_VISIT_TIMEOUT_MS,
  });
}
