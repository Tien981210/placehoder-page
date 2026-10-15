import { ApiError, apiRequest } from './http';
import { mockCategories, mockDelay, mockFindProductBySlug, mockListProducts } from './mock';
import type {
  CategoryView,
  InquirySubmitRequest,
  InquirySubmitResult,
  MediaCapabilities,
  PaginatedResult,
  ProductView,
  PublicChannelCatalogView,
  PublicProductQuery,
} from './types';

/**
 * 业务 API 客户端。
 *
 * 所有页面只通过本文件访问后端 —— 页面里不出现 fetch / URL 拼接。
 *
 * VITE_USE_MOCK：
 *   - true  → 返回 mock.ts 中明确标记的演示数据（界面会显示「演示数据」角标）
 *   - false → 调用真实后端
 */
/**
 * 演示模式开关。
 *
 * 初始值来自 VITE_USE_MOCK；保存为**可变的模块状态**，
 * 以便测试能在运行时切换两条分支（真实请求 / 演示模式）。
 *
 * ⚠️ 缺省方向是「**真实 API**」而不是「演示数据」：
 *    只有显式配置 `VITE_USE_MOCK=true` 才进入演示模式。
 *    早期写法是 `(env ?? 'true') !== 'false'` —— 那样在环境变量缺失
 *    （例如构建机没有 .env、或变量名拼错）时会**静默进入演示模式**，
 *    把约 20 件并不存在的商品当成真实商品库渲染出来。
 *    宁可连不上后端如实报错，也不能让界面编造出可浏览的假商品。
 */
let mockMode = import.meta.env.VITE_USE_MOCK === 'true';

export function isMockActive(): boolean {
  return mockMode;
}

/** 仅供测试使用：运行时切换演示模式。 */
export function __setMockModeForTest(value: boolean): void {
  mockMode = value;
}

/** 后端当前版本尚未实现的能力 —— 明确抛出，绝不伪造成功。 */
export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature}：后端尚未实现该能力（阶段 4/5 计划）。`);
    this.name = 'NotImplementedError';
  }
}

const DEFAULT_PAGE_SIZE = 20;

/* ----------------------------- 公开接口 ----------------------------- */

export async function fetchCategories(): Promise<CategoryView[]> {
  if (isMockActive()) {
    await mockDelay();
    return mockCategories.map((category) => ({ ...category }));
  }
  return apiRequest<CategoryView[]>('/categories');
}

export async function fetchProducts(
  query: PublicProductQuery = {},
): Promise<PaginatedResult<ProductView>> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

  if (isMockActive()) {
    await mockDelay();
    return mockListProducts({ page, pageSize, q: query.q, category: query.category });
  }

  return apiRequest<PaginatedResult<ProductView>>('/products', {
    query: { page, pageSize, q: query.q, category: query.category },
  });
}

export async function fetchProductBySlug(slug: string): Promise<ProductView> {
  if (isMockActive()) {
    await mockDelay();
    const product = mockFindProductBySlug(slug);
    if (!product) {
      throw new ApiError(404, 'NotFound', '商品不存在或已下架');
    }
    return { ...product };
  }
  return apiRequest<ProductView>(`/products/${encodeURIComponent(slug)}`);
}

/* -------------------- 联系方式目录（G6，公开） -------------------- */

/**
 * 演示模式下的业务类型目录 —— 与后端迁移写入的内置 5 类一致。
 * ⚠️ 这是**演示数据**：界面会显示「演示数据」角标（与 mockCategories 同源）。
 */
const MOCK_CONTACT_CATALOG: PublicChannelCatalogView = {
  channels: ['EMAIL', 'WHATSAPP'],
  businessTypes: [
    { key: 'sales', label: '销售咨询', description: '售前商品、价格与库存咨询', sortOrder: 10, channels: ['EMAIL', 'WHATSAPP'] },
    { key: 'after-sales', label: '售后服务', description: '售后问题、退换与维修', sortOrder: 20, channels: ['EMAIL'] },
    { key: 'order-logistics', label: '订单与物流', description: '订单进度、发货与物流查询', sortOrder: 30, channels: ['EMAIL'] },
    { key: 'custom-bulk', label: '定制与批量采购', description: '定制需求与批量采购洽谈', sortOrder: 40, channels: ['EMAIL', 'WHATSAPP'] },
    { key: 'general-support', label: '通用客服', description: '未指定业务类型时的默认回退渠道', sortOrder: 90, channels: ['EMAIL', 'WHATSAPP'] },
  ],
};

/**
 * 公开的「业务类型 × 渠道能力」目录。
 *
 * 用于让前台在**不硬编码业务类型**的前提下渲染询盘选项（任务书 3.2）。
 * ⚠️ 响应**不含**任何邮箱地址或 WhatsApp 号码 ——
 *    具体号码只在提交询盘后由服务端按分配规则选定并返回给该顾客。
 */
export async function fetchContactCatalog(): Promise<PublicChannelCatalogView> {
  if (isMockActive()) {
    await mockDelay();
    return {
      channels: [...MOCK_CONTACT_CATALOG.channels],
      businessTypes: MOCK_CONTACT_CATALOG.businessTypes.map((type) => ({ ...type })),
    };
  }
  return apiRequest<PublicChannelCatalogView>('/contacts/business-types');
}

/* ----------------------------- 媒体能力 ----------------------------- */

/**
 * 媒体能力查询。
 *
 * ⚠️ Luxra Beauty 临时站当前**没有任何页面调用**它（原站后台的商品图片页才用）。
 *     函数保留是为了与接口层结构保持一致，后续从 Luxra Beauty 复原图片管理时直接可用。
 */
export async function fetchMediaCapabilities(): Promise<MediaCapabilities> {
  if (isMockActive()) {
    throw new NotImplementedError('媒体能力查询');
  }
  return apiRequest<MediaCapabilities>('/admin/media/capabilities');
}

/* -------------------------- 询价（阶段 4） -------------------------- */

/** 演示模式下不伪造询价结果 —— 如实告知需要连接后端。 */
const MOCK_INQUIRY_MESSAGE =
  '当前为演示数据模式（VITE_USE_MOCK=true），不会创建真实询价单，也不会返回真实订单。请设置 VITE_USE_MOCK=false 连接后端。';

/**
 * 提交询价。
 *
 * 契约要点：
 *   - 只提交 { productId, quantity }，商品信息由服务端重读并生成快照；
 *   - 传入 idempotencyKey 可让同一次提交的重试不会重复建单；
 *   - 返回的 accessToken 是**唯一一次**下发的原始凭证，前端必须提示用户自行保存。
 *
 * 🔴 临时站裁剪：不再接受 `accessToken` 参数 —— 没有顾客账户体系，
 *    所有询价单都是游客单。原参数与「归属到账户」的语义一并移除。
 */
export async function submitInquiry(request: InquirySubmitRequest): Promise<InquirySubmitResult> {
  if (isMockActive()) {
    await mockDelay();
    throw new ApiError(0, 'MOCK_MODE', MOCK_INQUIRY_MESSAGE);
  }
  return apiRequest<InquirySubmitResult>('/inquiries', {
    method: 'POST',
    body: request,
  });
}
