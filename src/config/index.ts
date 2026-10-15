/**
 * 配置层统一出口。
 *
 * 组件只从 `@/config` 引入，不直接拼文件路径 ——
 * 这样以后拆分或合并配置文件时，调用方无需改动。
 */

export {
  BRAND,
  applyBrandTheme,
  brandEmailAddress,
  brandFileSlug,
  brandMailtoUrl,
  brandThemeTokens,
  brandWhatsAppDisplay,
  brandWhatsAppNumber,
  brandWhatsAppUrl,
  type BrandConfig,
  type BrandSocialLink,
  type BrandThemeTokens,
} from './brand';

export {
  CONTACT_MESSAGES,
  HOME_HERO,
  HOME_SECTIONS,
  INQUIRY_FLOW_STEPS,
  SITE_CATEGORIES,
  SITE_FEATURES,
  SITE_SERVICE_ITEMS,
  type SiteCategory,
} from './site';

export { contrastRatio, mixHex, normalizeHex, readableInk, shadeHex, tintHex } from './color';
