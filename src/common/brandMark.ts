/**
 * 品牌标记（刻面宝石）的**内联 SVG 片段**。
 *
 * 用途：演示（Mock）数据的商品占位图是在**运行时拼 SVG 字符串**，
 * 而 SVG 作为 `<img>` 加载时不允许引用外部相对路径资源，
 * 因此这里把标记的路径直接内联进字符串 —— 无需 base64 位图，
 * 体积更小、任意缩放不失真、也便于跟随品牌色调整。
 *
 * 几何与 `public/brand/logo-mark.svg` **完全一致**（64 × 64 坐标系）。
 * 真实界面（导航字标 / 商品卡兜底图）用的是 `public/brand/logo-mark.png`，不走这里。
 */

/** 标记自身的坐标系边长。 */
export const BRAND_MARK_VIEWBOX = '0 0 64 64';

/**
 * 标记内部绘制指令（不含 `<svg>` 外壳）。
 *
 * 色值取自品牌主色 `#8e4a5f` 的派生色阶 —— 与 `src/config/brand.ts` 一致。
 * 刻意不含任何动物 / 宠物元素。
 */
export const BRAND_MARK_SVG_BODY = [
  // 轮廓
  '<path d="M20 15 H44 L56 28 L32 51 L8 28 Z" fill="#8e4a5f"/>',
  // 冠部：台面 + 左右冠面
  '<path d="M20 15 H44 L38 28 H26 Z" fill="#b0808f"/>',
  '<path d="M8 28 L20 15 L26 28 Z" fill="#9c6072"/>',
  '<path d="M56 28 L44 15 L38 28 Z" fill="#804356"/>',
  // 亭部：三个切面
  '<path d="M8 28 H26 L32 51 Z" fill="#a26b7c"/>',
  '<path d="M26 28 H38 L32 51 Z" fill="#955569"/>',
  '<path d="M38 28 H56 L32 51 Z" fill="#7a4052"/>',
  // 切面分隔线
  '<g fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="0.8" stroke-linejoin="round">',
  '<path d="M20 15 L26 28 H38 L44 15"/>',
  '<path d="M8 28 H56"/>',
  '<path d="M26 28 L32 51 L38 28"/>',
  '</g>',
].join('');

/** 生成一个独立的标记 SVG 字符串（可作 `src` 的 data URI，或直接内联）。 */
export function brandMarkSvg(size = 64): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BRAND_MARK_VIEWBOX}" width="${size}" height="${size}">${BRAND_MARK_SVG_BODY}</svg>`;
}
