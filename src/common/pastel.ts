/**
 * 商品图占位底色。
 *
 * 真实商品图缺失时（后端 `images` 为空是常态），商品卡与详情页用一块
 * **低饱和暖中性色**兜底，保证同一商品永远同色、页面不出现破图或高度塌陷。
 *
 * ⚠️ 色板刻意做成「暖白 / 雾粉 / 米灰 / 浅蓝灰」这一类中性色：
 *    - 不用高饱和糖果色（那是原宠物主题的观感）；
 *    - 不抢占真实商品图的视觉位置 —— 占位块只负责说明「这里还没有图」。
 */
const PASTELS = ['#f3ece6', '#eee6ee', '#e9eef2', '#f0eee4', '#eceff0', '#f4eae9'] as const;

/** 依据任意字符串稳定地取一个占位色（同一商品永远同色）。 */
export function pastelFor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 100000;
  }
  return PASTELS[hash % PASTELS.length]!;
}
