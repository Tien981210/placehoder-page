/**
 * 颜色工具 —— 品牌色板的**派生**计算。
 *
 * 为什么需要它：
 *   品牌主色只有**一个**配置项（`brandPrimaryColor`）。但设计系统里需要
 *   一整条色阶（hover 加深、浅色底、描边等）。若把这些色阶也做成配置项，
 *   品牌方改色时就必须同时改 5 个值，很容易改漏、改错。
 *   这里由主色**自动派生**出深色 / 浅色变体，保证「改一处，全站一致」。
 *
 * 本文件是纯函数模块：无副作用、不访问 DOM，可直接单测。
 */

/** 把 `#rgb` / `#rrggbb` 归一化为 `#rrggbb`；非法输入返回 `null`。 */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    const [r, g, b] = raw.split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
  return null;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function toRgb(hex: string): Rgb {
  const normalized = normalizeHex(hex) ?? '#000000';
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * 按比例混合两个颜色。
 *
 * @param ratio 0 = 完全取 `a`；1 = 完全取 `b`。
 */
export function mixHex(a: string, b: string, ratio: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const from = toRgb(a);
  const to = toRgb(b);
  return toHex({
    r: from.r + (to.r - from.r) * clamped,
    g: from.g + (to.g - from.g) * clamped,
    b: from.b + (to.b - from.b) * clamped,
  });
}

/** 加深（向黑色混合）。 */
export function shadeHex(hex: string, amount: number): string {
  return mixHex(hex, '#000000', amount);
}

/** 变浅（向白色混合）。 */
export function tintHex(hex: string, amount: number): string {
  return mixHex(hex, '#ffffff', amount);
}

/** WCAG 相对亮度（0–1）。 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = toRgb(hex);
  const linear = [r, g, b].map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** 两个颜色的 WCAG 对比度（1–21）。 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * 在给定背景上挑一个**可读**的文字色（白色或深炭灰）。
 *
 * 用于「主色被改成一个很浅的颜色」时仍能保证按钮文字对比度 ——
 * 品牌方把主色设成浅金、浅粉时不会得到白底白字。
 */
export function readableInk(background: string): string {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#242321')
    ? '#ffffff'
    : '#242321';
}
