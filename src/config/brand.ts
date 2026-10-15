import { mixHex, normalizeHex, readableInk, shadeHex, tintHex } from './color';

/**
 * ============================================================================
 * 品牌配置 —— **全站唯一的品牌事实来源**
 * ============================================================================
 *
 * 为什么要有这个文件：
 *   品牌名称尚未最终确定，而品牌名 / Logo / 主色 / 客服邮箱 / WhatsApp /
 *   社交链接 / 版权文字此前散落在页头、页脚、首页轮播等多个组件里。
 *   品牌一旦定稿，逐个页面搜索替换既慢又必然漏。
 *   现在全部收敛到本文件：**改这里 = 改全站**。
 *
 * 使用方式：
 *   - 组件里**不要**再写死品牌名、邮箱、号码或色值，一律 import `BRAND`；
 *   - 颜色由 `applyBrandTheme()` 在启动时写入 CSS 变量（见 `main.ts`），
 *     组件只消费 `var(--brand)` 之类的令牌，不感知具体色值。
 *
 * 明确不在本次范围内：
 *   - 不新增「品牌管理后台」—— 品牌信息由前端配置维护；
 *   - 不新增后端接口或数据库字段。
 */

export interface BrandSocialLink {
  /** 展示名，如 `Instagram`。 */
  readonly label: string;
  /** 完整外链地址。 */
  readonly href: string;
}

export interface BrandConfig {
  /** 品牌显示名称（页头字标、页脚、浏览器标题都用它）。 */
  readonly brandName: string;
  /** 短品牌名（窄屏 / 小尺寸场景）。 */
  readonly brandShortName: string;
  /** 品牌标语（页脚与首屏使用）。 */
  readonly brandTagline: string;
  /** Logo 资源路径。 */
  readonly brandLogo: string;
  /** 站点图标。 */
  readonly brandFavicon: string;
  /** 品牌主色（唯一色值来源，其余色阶由它派生）。 */
  readonly brandPrimaryColor: string;
  /** 品牌辅助色（用于点缀，不做正文文字色）。 */
  readonly brandAccentColor: string;
  /** 客服邮箱。**留空字符串即表示未配置**，全站隐藏邮箱入口。 */
  readonly brandEmail: string;
  /**
   * 客服 WhatsApp 号码，**纯数字国际格式**（含国家代码，不含 `+` / 空格 / 连字符）。
   * **留空字符串即表示未配置**，全站隐藏 WhatsApp 入口。
   */
  readonly brandWhatsApp: string;
  /** 社交媒体链接；空数组即表示不展示。 */
  readonly brandSocialLinks: readonly BrandSocialLink[];
  /** 版权显示内容（年份由页脚自动补在 `©` 之后）。 */
  readonly brandCopyright: string;
}

/* -------------------------------------------------------------------------- */
/* 默认值 —— 中性占位，等待品牌定稿后一次性替换                                 */
/* -------------------------------------------------------------------------- */

/**
 * 中性占位品牌名。
 *
 * ⚠️ 刻意**不**使用 `Buling Beauty` / `Luxra Beauty` ——
 *    这两个名字都还没有最终确认，写进页面会让品牌方以为已经定了。
 */
const DEFAULT_BRAND_NAME = 'BEAUTY STORE';

export const BRAND: BrandConfig = {
  brandName: DEFAULT_BRAND_NAME,
  brandShortName: 'BEAUTY',
  brandTagline: 'Your beauty, your style.',

  // 抽象品牌标记（与「宠物」主题无关），同时作为 og:image 等外部引用资源。
  brandLogo: '/brand/logo-mark.svg',
  brandFavicon: '/favicon.png',

  // 暖调玫瑰棕：在白色背景上对白色文字的对比度约 6.4:1，满足 WCAG AA。
  brandPrimaryColor: '#8e4a5f',
  // 香槟金：仅用于点缀（角标、分隔、装饰线），**不作为正文或按钮文字色**。
  brandAccentColor: '#c2a05b',

  // ⚠️ 客服邮箱尚未提供 —— 留空 ⇒ 全站不渲染任何邮箱入口（不会出现死链）。
  brandEmail: '',

  /**
   * ⚠️ TODO(品牌确认)：这是**沿用原项目、尚未确认**的客服号码，不是正式客服号。
   *    它集中在这里而不是散落在组件中，品牌定稿后改这一处即可全站生效。
   *    设为 `''` 可立刻让全站所有 WhatsApp 入口消失（机制已具备）。
   */
  brandWhatsApp: '8613070758373',

  // 社交媒体尚未提供 —— 空数组 ⇒ 页脚不渲染社交区块。
  brandSocialLinks: [],

  brandCopyright: `${DEFAULT_BRAND_NAME}. 本站为询价制独立站，不直接在线支付。`,
};

/* -------------------------------------------------------------------------- */
/* 派生：联系方式可用性                                                        */
/* -------------------------------------------------------------------------- */

/** E.164 允许的最短 / 最长位数（含国家代码）—— 与后端 `common/whatsapp-number.ts` 一致。 */
const WHATSAPP_MIN_DIGITS = 8;
const WHATSAPP_MAX_DIGITS = 15;

function digitsOnly(value: string): string {
  return value.replace(/\D+/g, '');
}

/**
 * 已配置且格式可用的客服邮箱；未配置返回 `null`。
 *
 * 未配置时**调用方必须隐藏入口**，而不是渲染一个点了没反应的按钮。
 */
export function brandEmailAddress(brand: BrandConfig = BRAND): string | null {
  const email = brand.brandEmail.trim();
  return email.length > 0 && email.includes('@') ? email : null;
}

/**
 * 已配置且格式可用的客服 WhatsApp 号码（纯数字国际格式）；未配置返回 `null`。
 *
 * 校验规则：纯数字、长度落在 E.164 区间。
 * 号码里若混入 `+` / 空格 / 括号，说明还没规范化 —— 直接判为不可用，
 * 避免拼出一个看起来能点、实际打不开的链接。
 */
export function brandWhatsAppNumber(brand: BrandConfig = BRAND): string | null {
  const raw = brand.brandWhatsApp.trim();
  if (raw.length === 0) return null;
  if (digitsOnly(raw) !== raw) return null;
  if (raw.length < WHATSAPP_MIN_DIGITS || raw.length > WHATSAPP_MAX_DIGITS) return null;
  return raw;
}

/** `mailto:` 链接；未配置邮箱时返回 `null`。 */
export function brandMailtoUrl(brand: BrandConfig = BRAND): string | null {
  const email = brandEmailAddress(brand);
  return email ? `mailto:${email}` : null;
}

/** 标准 Click to Chat 链接；未配置号码时返回 `null`。 */
export function brandWhatsAppUrl(message: string, brand: BrandConfig = BRAND): string | null {
  const phone = brandWhatsAppNumber(brand);
  return phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null;
}

/** 展示用国际号码（补前导 `+`）；未配置时返回 `null`。 */
export function brandWhatsAppDisplay(brand: BrandConfig = BRAND): string | null {
  const phone = brandWhatsAppNumber(brand);
  return phone ? `+${phone}` : null;
}

/**
 * 品牌名对应的**文件名安全 slug**（小写、非字母数字折叠为 `-`）。
 *
 * 用途：下载文件名（如 `beauty-store-inquiry-xxx.txt`）不能写死品牌名 ——
 * 品牌定稿后必须自动跟着变。非 ASCII 品牌名（例如纯中文）会退化为 `brand`。
 */
export function brandFileSlug(brand: BrandConfig = BRAND): string {
  const slug = brand.brandName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'brand';
}

/* -------------------------------------------------------------------------- */
/* 派生：CSS 变量                                                              */
/* -------------------------------------------------------------------------- */

/** 品牌色阶令牌名 —— 与 `styles/main.css` 的 `:root` 默认值一一对应。 */
export interface BrandThemeTokens {
  readonly '--brand': string;
  readonly '--brand-600': string;
  readonly '--brand-700': string;
  readonly '--brand-50': string;
  readonly '--brand-100': string;
  readonly '--on-brand': string;
  readonly '--accent': string;
  readonly '--accent-50': string;
  readonly '--on-accent': string;
  readonly '--brand-ink': string;
}

/**
 * 由主色 / 辅助色派生出完整色阶。
 *
 * 派生规则（纯函数，便于单测）：
 *   - `--brand-600` / `--brand-700`：向黑色混合 12% / 28%（hover / active 态）
 *   - `--brand-50`  / `--brand-100`：向白色混合 92% / 84%（浅色底）
 *   - `--on-brand`  ：在品牌色上可读的文字色（主色很浅时自动转为深色文字）
 */
export function brandThemeTokens(brand: BrandConfig = BRAND): BrandThemeTokens {
  const primary = normalizeHex(brand.brandPrimaryColor) ?? '#8e4a5f';
  const accent = normalizeHex(brand.brandAccentColor) ?? '#c2a05b';

  return {
    '--brand': primary,
    '--brand-600': shadeHex(primary, 0.12),
    '--brand-700': shadeHex(primary, 0.28),
    '--brand-50': tintHex(primary, 0.92),
    '--brand-100': tintHex(primary, 0.84),
    '--on-brand': readableInk(primary),
    '--accent': accent,
    '--accent-50': tintHex(accent, 0.88),
    '--on-accent': readableInk(accent),
    // 品牌色作为**正文链接色**时的可读版本：白底上至少 4.5:1
    '--brand-ink': contrastSafeInk(primary),
  };
}

/**
 * 把颜色调到在白底上可读为止（用于链接 / 小字）。
 *
 * 主色本身通常够深；若品牌方选了浅色，就逐步加深直到满足 AA 正文对比度。
 */
function contrastSafeInk(primary: string): string {
  const white = '#faf8f5';
  for (let step = 0; step <= 10; step += 1) {
    const candidate = mixHex(primary, '#000000', step * 0.06);
    if (contrast(candidate, white) >= 4.5) return candidate;
  }
  return shadeHex(primary, 0.6);
}

/** 局部对比度计算（避免为了一个调用把 color.ts 的导出面扩大）。 */
function contrast(a: string, b: string): number {
  const lum = (hex: string): number => {
    const normalized = normalizeHex(hex) ?? '#000000';
    const channels = [1, 3, 5].map((offset) => {
      const value = Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const la = lum(a);
  const lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * 把品牌色写入 CSS 变量。
 *
 * 在应用启动时调用一次（见 `main.ts`）。CSS 里保留一份默认值，
 * 这样即使 JS 尚未执行、或变量注入失败，页面也不会变成「无色」状态。
 */
export function applyBrandTheme(
  root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement,
  brand: BrandConfig = BRAND,
): void {
  if (!root) return;
  const tokens = brandThemeTokens(brand);
  for (const [name, value] of Object.entries(tokens)) {
    root.style.setProperty(name, value);
  }
}
