import { describe, expect, it } from 'vitest';
import { routes } from './routes';

/**
 * SEO 与合规守卫（第二阶段新增）。
 *
 * 两道防线：
 *   1. **每个真正渲染的页面路由**都必须有 `meta.title` 与 `meta.description` ——
 *      单页应用只有一份静态 `<meta name="description">`，若某页漏配，
 *      它会继承上一页的描述，搜索引擎看到的是「张冠李戴」的摘要。
 *   2. 页面文案里**不得出现**在线支付语义或未经证实的事实性宣称。
 *      这条是硬约束（规范 §3.2 / §3.3），用测试固化，避免后续迭代回退。
 */

/** 真正渲染页面的路由（纯重定向路由不渲染，因此不要求 description）。 */
const RENDERED = routes.filter((route) => typeof route.component === 'function');

/** 严禁出现的措辞 —— 命中任意一条即判定为越界。 */
const FORBIDDEN_IN_META: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /立即购买|去支付|支付成功|已付款|已支付|在线支付成功/, reason: '在线支付语义' },
  { pattern: /Buy Now|Pay Now|Proceed to Payment|Checkout Now/i, reason: '在线支付语义（英文）' },
  { pattern: /热销|销量|已售|好评率|五星好评|Best ?Seller|Top ?Rated/i, reason: '无数据来源的销量/评价宣称' },
  { pattern: /全球领先|百万用户|行业第一|全国第一|官方认证|权威认证/, reason: '未经证实的资质宣称' },
  { pattern: /包邮|次日达|当日达|顺丰包邮|极速发货/, reason: '未经证实的配送承诺' },
  { pattern: /成立\s*\d+\s*年|始创于\s*\d{4}|since\s*\d{4}/i, reason: '未经证实的品牌历史' },
];

describe('SEO：路由 meta', () => {
  it('每个渲染页面的路由都有 title 与 description', () => {
    const missing = RENDERED.filter(
      (route) =>
        typeof route.meta?.title !== 'string' ||
        route.meta.title.length === 0 ||
        typeof route.meta?.description !== 'string' ||
        route.meta.description.length === 0,
    ).map((route) => route.path);

    expect(missing, `以下路由缺少 title 或 description：${missing.join(', ')}`).toEqual([]);
  });

  it('title 在渲染页面之间唯一（避免浏览器标签无法区分页面）', () => {
    const titles = RENDERED.map((route) => route.meta?.title as string);
    expect(new Set(titles).size, `重复的 title：${titles.join(' / ')}`).toBe(titles.length);
  });

  it('description 在渲染页面之间唯一（避免搜索引擎摘要重复）', () => {
    const descs = RENDERED.map((route) => route.meta?.description as string);
    expect(new Set(descs).size, '存在重复的 description').toBe(descs.length);
  });

  it('description 长度落在合理区间（约 20–160 字符）', () => {
    for (const route of RENDERED) {
      const text = route.meta?.description as string;
      expect(text.length, `${route.path} 的 description 过短`).toBeGreaterThanOrEqual(20);
      expect(text.length, `${route.path} 的 description 过长`).toBeLessThanOrEqual(160);
    }
  });

  it.each(FORBIDDEN_IN_META)('description 不含「$reason」类措辞', ({ pattern }) => {
    const offenders = RENDERED.filter((route) => pattern.test(route.meta?.description ?? '')).map(
      (route) => route.path,
    );
    expect(offenders, `以下路由的描述命中禁用措辞：${offenders.join(', ')}`).toEqual([]);
  });

  it('title 同样不含在线支付语义', () => {
    const offenders = RENDERED.filter((route) =>
      /立即购买|去支付|结算|支付成功|Buy Now|Pay Now/i.test(route.meta?.title ?? ''),
    ).map((route) => route.path);
    expect(offenders).toEqual([]);
  });
});
