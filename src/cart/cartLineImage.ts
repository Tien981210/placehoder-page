import type { CartLine } from '@/cart/useCart';
import { productPlaceholder } from '@/common/placeholderImage';

/**
 * 购物车行 → 展示用图片。
 *
 * 抽成独立模块的原因：购物车抽屉（`CartDrawer.vue`）与购物车页（`CartPage.vue`）
 * 都要渲染行缩略图，而两处必须得到**同一张图**，否则同一件商品在抽屉里和
 * 购物车页里长得不一样，看起来像数据错乱。
 *
 * 规则（与商品卡、详情页共用 `common/placeholderImage.ts`）：
 *   1. 有真实图片（`imageUrl`）→ 用真实图片；
 *   2. 没有 → 按行名 / slug 推断品类取示意占位图；
 *   3. 连主题都推断不出 → 返回 `null`，由调用方回落到品牌标记。
 */
export interface CartLineImage {
  readonly url: string;
  readonly alt: string;
  /** `true` 表示这是示意占位图，不是商品实拍。 */
  readonly isPlaceholder: boolean;
}

export function resolveCartLineImage(line: CartLine): CartLineImage | null {
  if (line.imageUrl) {
    return { url: line.imageUrl, alt: line.name, isPlaceholder: false };
  }
  const placeholder = productPlaceholder(line);
  return placeholder
    ? { url: placeholder.url, alt: placeholder.alt, isPlaceholder: true }
    : null;
}
