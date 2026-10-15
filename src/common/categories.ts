import type { RouteLocationRaw } from 'vue-router';
import type { CategoryView } from '@/api/types';
import type { SiteCategory } from '@/config';

/**
 * 品类 → 真实分类的解析工具。
 *
 * 设计原则（沿用原 `navMatrix.ts` 的「候选 slug + 运行时解析」思路，
 * 但把「宠物受众矩阵」整体换成「美容品类」）：
 *   导航与首页**不信任硬编码 slug**。配置里只声明候选列表，
 *   实际跳转目标一律按**后端真实分类**解析：
 *     · 命中 → 带 `category=<真实 slug>` 跳商品列表；
 *     · 全不命中（含分类接口失败、分类库为空）→ 退化为「全部商品」。
 *
 * 为什么必须这样：把用户送进一个「该分类不存在」的 0 商品页，
 * 比少给一个筛选条件糟糕得多。本文件是纯函数模块，便于单测。
 */

/** 真实分类列表的最小形状（只依赖 slug，便于测试与复用）。 */
export interface CategorySlugSource {
  readonly slug: string;
}

/** 按候选顺序返回第一个命中的真实 slug；一个都不命中返回 `null`。 */
export function resolveCategorySlug(
  candidates: readonly string[],
  available: readonly CategorySlugSource[],
): string | null {
  if (candidates.length === 0 || available.length === 0) return null;
  const known = new Set(available.map((item) => item.slug));
  for (const candidate of candidates) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/** 商品列表页的跳转目标（不带 category 时即「全部商品」）。 */
export function productListTarget(slug: string | null): RouteLocationRaw {
  return slug
    ? { name: 'products', query: { category: slug } }
    : { name: 'products' };
}

/** 单个品类的解析结果。 */
export interface ResolvedSiteCategory {
  /** 配置项本体。 */
  readonly category: SiteCategory;
  /** 解析到的真实分类 slug；`null` 表示该品类尚未在后台建立。 */
  readonly slug: string | null;
  /** 对应的真实分类对象（用于取真实描述 / 名称）；未命中为 `null`。 */
  readonly matched: CategoryView | null;
  /** 可直接用于 `:to` 的跳转目标。 */
  readonly target: RouteLocationRaw;
}

/** 把一个配置品类与真实分类列表对齐。 */
export function resolveSiteCategory(
  category: SiteCategory,
  available: readonly CategoryView[],
): ResolvedSiteCategory {
  const slug = resolveCategorySlug(category.candidates, available);
  return {
    category,
    slug,
    matched: slug ? (available.find((item) => item.slug === slug) ?? null) : null,
    target: productListTarget(slug),
  };
}

/** 批量解析（导航与首页分类网格共用同一套规则，保证结果一致）。 */
export function resolveSiteCategories(
  categories: readonly SiteCategory[],
  available: readonly CategoryView[],
): ResolvedSiteCategory[] {
  return categories.map((category) => resolveSiteCategory(category, available));
}

/**
 * 真实分类中**不属于**任何配置品类的部分。
 *
 * 用途：分类页要如实展示后端全部启用分类。若只展示四大目标品类，
 * 后台真实存在的分类（例如当前的 `serum`）就会在页面上凭空消失 ——
 * 那等于隐藏了真实数据。
 */
export function unmatchedCategories(
  available: readonly CategoryView[],
  categories: readonly SiteCategory[] = [],
): CategoryView[] {
  const claimed = new Set<string>();
  for (const category of categories) {
    const slug = resolveCategorySlug(category.candidates, available);
    if (slug) claimed.add(slug);
  }
  return available.filter((item) => !claimed.has(item.slug));
}
