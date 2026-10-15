import { ApiError } from '@/api/http';
import type { UnavailableProductRef } from '@/api/types';

/**
 * 后端错误载荷的解析工具。
 *
 * 后端在「部分商品不可询价」时返回 409，载荷形如：
 *   { statusCode: 409, message: '部分商品当前不可询价…', error: 'Conflict',
 *     unavailable: [{ productId, reason }] }
 * 这里把 details.unavailable 安全地提取出来 —— 结构不符时返回空数组，
 * 绝不让脏载荷把页面搞崩。
 */
export function extractUnavailableProducts(error: unknown): UnavailableProductRef[] {
  if (!(error instanceof ApiError)) return [];

  const details = error.details;
  if (typeof details !== 'object' || details === null) return [];

  const raw = (details as { unavailable?: unknown }).unavailable;
  if (!Array.isArray(raw)) return [];

  const result: UnavailableProductRef[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.productId !== 'string' || typeof record.reason !== 'string') continue;
    result.push({ productId: record.productId, reason: record.reason });
  }
  return result;
}

/**
 * 订单查询失败时的统一提示。
 *
 * 后端对「订单号错 / 凭证错 / 凭证过期 / 已撤销 / 订单号与凭证不匹配」
 * 一律返回同一个 404（避免枚举攻击），因此前端也只能给出同一条中性提示，
 * 不要试图猜测具体原因。
 */
export function describeLookupError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) {
      return '未找到匹配的询价单：请核对订单号与访问凭证是否都正确，以及凭证是否仍在有效期内。';
    }
    if (error.status === 400) {
      return isCustomerFacingCopy(error.message)
        ? `输入格式不正确：${error.message}`
        : '输入格式不正确，请检查订单号与访问凭证的格式。';
    }
    return isCustomerFacingCopy(error.message) ? error.message : '查询失败，请稍后重试。';
  }
  return '查询失败，请稍后重试。';
}

/**
 * 判断后端给的文案是否已经是一句**面向顾客的中文说明**。
 *
 * 用途见 `describeSubmitError()`：5xx 时后端常常把框架/网关的默认英文
 * 状态文本直接透出来（`Internal Server Error`、`Service Unavailable`、
 * `Bad Gateway` …），那不是业务文案，直接显示给顾客毫无意义。
 * 而只要后端给的是中文说明，就说明它确实为顾客准备了话术，原样保留更好。
 *
 * 判定用「是否含 CJK 字符」而不是「是否等于某几个英文串」—— 后者永远列不全，
 * 前者对「NestJS 默认英文文案」与「网关 HTML 错误页」都成立。
 */
function hasLocalizedMessage(message: string): boolean {
  return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(message);
}

/**
 * 明显属于**工程实现**的标记。
 *
 * ⚠️ 只靠 `hasLocalizedMessage()` 是不够的 —— 实测踩到过：把
 *    `无法连接到 API（http://127.0.0.1:4100）。请配置 CORS。`
 *    丢进去，因为里面有「无法连接到」「请配置」这些汉字，会被判成
 *    「已经本地化」而原样透给顾客。这类**中文外壳 + 英文内部**的混合串
 *    才是最容易漏的形态。
 */
const TECHNICAL_MARKER = /https?:\/\/|127\.0\.0\.1|localhost|\bCORS\b|\bAPI\b|\b[A-Z][A-Za-z]*Error\b|\d+ms\b/;

/**
 * 这句话可以直接给顾客看吗？
 * 需要同时满足：是中文，且不含上面那些工程标记。
 */
function isCustomerFacingCopy(message: string): boolean {
  return hasLocalizedMessage(message) && !TECHNICAL_MARKER.test(message);
}

/**
 * `status === 0`（**没拿到服务端 HTTP 响应**）时的顾客文案。
 *
 * 优先沿用传输层已经写好的文案（`http.ts` 已归一化为顾客语言）；
 * 只要它沾了工程细节或压根不是中文，就按 `code` 给一句兜底 ——
 * 用 code 而不是 message 决定兜底内容，因为 message 可能已经被污染。
 */
function transportMessage(error: ApiError): string {
  if (isCustomerFacingCopy(error.message)) return error.message;
  return error.code === 'TIMEOUT'
    ? '请求超时，没有收到服务器响应。'
    : '网络连接中断，没有收到服务器响应。';
}

/**
 * 数据加载失败（首页 / 分类页 / 商品列表 / 商品详情）的统一文案。
 *
 * 与 `describeSubmitError()` 的区别：读操作没有「结果未知」的歧义 ——
 * 重新加载永远是安全的，所以这里只需要把**工程文案**换成**顾客文案**。
 *
 * ⚠️ 真实浏览器实测（`audit/phase22/apierr_probe.py`，route 拦截制造 500）：
 *    `StateError.vue` 原本把 `error.message` 原样渲染，于是后端一返 500，
 *    页面上就直接出现一句 `Internal Server Error`。后端 5xx 的 message 是
 *    NestJS 框架默认英文，不是给顾客看的。
 *
 * 判定沿用 `hasLocalizedMessage()`：中文一律原样保留（后端确实为顾客写了话术，
 * 实测 404 返回的就是「商品不存在或已下架」），非中文一律换成通用文案。
 */
export function describeLoadError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return transportMessage(error);
    if (isCustomerFacingCopy(error.message)) return error.message;
    if (error.status >= 500) {
      return '服务器暂时无法响应，内容没能加载出来。请稍后重试；如果一直失败，可以直接联系客服。';
    }
    return '内容没能加载出来，请稍后重试。';
  }
  if (error instanceof Error && isCustomerFacingCopy(error.message)) return error.message;
  return '内容加载失败，请稍后重试。';
}

/**
 * 提交询价失败时的统一提示。
 *
 * ⚠️ 关键语义：必须区分「确定失败」与「结果未知」。
 *
 * `ApiError.status === 0` 表示**根本没拿到服务端的 HTTP 响应**，它包含三种 code：
 *   - `TIMEOUT`       —— 请求已发出，超时未收到响应；
 *   - `NETWORK_ERROR` —— 连接被拒 / 中断（可能发出去了，也可能没到）；
 *   - `MOCK_MODE`     —— 演示数据模式，请求**从未发出**（确定失败，不是「未知」）。
 *
 * 对前两种，服务端**可能已经建单**。此时若只显示「提交失败」会误导用户
 * 去重填表单或反复重提 —— 而重试其实是安全的：`CheckoutPage` 在非 409 失败时
 * **保留**当前幂等键，重试会复用同一个 key，服务端按 key 命中已有订单直接返回，
 * 不会重复建单。因此这里必须显式告知「结果未知 + 重试安全」。
 *
 * ⚠️ 5xx 与「结果未知」是两回事：拿到了 5xx 响应 ⇒ 服务端**确实回过话**，
 *    属于「确定失败」（与既有测试一致，不得附加「结果未知」）。
 *    但它的 message 往往是英文框架文案，因此这里替换为本地化、可操作的提示。
 */
export function describeSubmitError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return '提交失败，请稍后重试。';
  }

  // status 0 且非演示模式 ⇒ 未收到服务端响应，提交结果未知。
  if (error.status === 0 && error.code !== 'MOCK_MODE') {
    // 传输层文案已由 http.ts 归一化为顾客语言，中文则沿用；非中文（调用方
    // 自行构造的 ApiError）一律兜底，避免把内部细节带进页面。
    const head = transportMessage(error);
    return `${head} 结果未知：本次提交可能已送达服务器。直接重试是安全的——会复用同一次询价的幂等键，不会重复建单。`;
  }

  /*
   * 5xx：服务端自身异常。真实浏览器实测（`states-before.json` 的 fail500 用例）
   * 后端把 `Internal Server Error` 原样透出，顾客看到一句英文、且不知道能做什么。
   * 后端没给中文说明时改用本地化、可操作的提示；给了中文说明则原样保留。
   */
  if (error.status >= 500 && !isCustomerFacingCopy(error.message)) {
    return '服务器暂时无法处理这次提交，本次询价没有提交成功。请稍后重试；如果一直失败，可以直接联系客服人工登记。';
  }

  return error.message;
}
