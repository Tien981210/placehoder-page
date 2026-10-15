/**
 * 与后端 API 对齐的视图模型。
 *
 * 这些类型**逐字段对应**后端返回的 JSON（见 luxra-beauty-backend 的
 * src/catalog/products/product.mapper.ts 与 category.mapper.ts），
 * 修改前请先核对后端映射器。
 */

export type ProductStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type ImageVisibility = 'PUBLIC' | 'PRIVATE';

export interface ProductImageView {
  id: string;
  storageKey: string;
  url: string;
  altText: string | null;
  visibility: ImageVisibility;
  sortOrder: number;
  isPrimary: boolean;
}

export interface ProductCategoryRef {
  id: string;
  name: string;
  slug: string;
}

export interface ProductView {
  id: string;
  name: string;
  slug: string;
  summary: string | null;
  description: string | null;
  /** 金额为字符串（后端 DECIMAL），例如 "12.34" */
  price: string;
  currency: string;
  compareAtPrice: string | null;
  sku: string | null;
  status: ProductStatus;
  category: ProductCategoryRef | null;
  images: ProductImageView[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryView {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 后端分页信封。 */
export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PublicProductQuery {
  page?: number;
  pageSize?: number;
  /** 按名称 / slug / sku 模糊匹配 */
  q?: string;
  /** 按启用中的分类 slug 过滤 */
  category?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AdminIdentity {
  id: string;
  email: string;
  role: 'ADMIN' | 'SUPPORT';
  displayName: string | null;
}

export interface LoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  admin: AdminIdentity;
}

export interface MediaCapabilities {
  driver: string;
  uploadsEnabled: boolean;
  supportedDrivers: readonly string[];
}

/* ------------------------------------------------------------------ */
/* 阶段 4：游客询价与订单查询                                          */
/* 逐字段对齐后端 src/inquiry/inquiry.mapper.ts —— 改前请先核对映射器。 */
/* ------------------------------------------------------------------ */

/** 跟进线（客服处理进度）—— 与付款、履约彼此独立 */
export type InquiryStatus = 'NEW' | 'IN_REVIEW' | 'QUOTED' | 'CLOSED' | 'CANCELLED';
/** 付款线 */
export type PaymentStatus = 'UNPAID' | 'LINK_SENT' | 'PAID' | 'REFUNDED';
/** 履约线 */
export type FulfillmentStatus = 'PENDING' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
/** 报价单状态 */
export type QuoteStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

/**
 * 提交的商品行。
 *
 * ⚠️ 只允许 { productId, quantity }：
 * 商品名称 / 价格 / 图片一律由服务端重读并写入快照，
 * 客户端多传任何字段都会被后端 400（forbidNonWhitelisted）拒绝。
 */
export interface InquiryLineInput {
  productId: string;
  quantity: number;
}

/** 询盘渠道（G6）—— 与后端 InquiryChannel 枚举逐字对应。 */
export type InquiryChannel = 'EMAIL' | 'WHATSAPP';

export interface InquirySubmitRequest {
  contactEmail: string;
  contactName: string;
  shippingAddress: string;
  note?: string;
  lines: InquiryLineInput[];
  /** 幂等键：同一次提交的重试复用同一个值，服务端据此避免重复建单 */
  idempotencyKey?: string;

  // ---------------------------------------------------------------- G6
  /** 询盘渠道；省略时服务端按 EMAIL 处理（与既有行为一致） */
  channel?: InquiryChannel;
  /** 业务类型 key（来自 GET /contacts/business-types）；省略表示未指定 */
  businessTypeKey?: string;
  /** 国家 / 地区（可选） */
  country?: string;
  /** 城市（可选） */
  city?: string;
  /**
   * 邮政编码（可选）。
   * ⚠️ 不做纯数字校验 —— 不同国家的邮编可能含字母、空格与连字符。
   */
  postalCode?: string;
}

export interface EmailDeliveryView {
  /** 已排入外发队列的邮件任务数 */
  queued: number;
  /**
   * 传输层是否已配置真实发送能力。
   * false ⇒ 真实邮件发送尚未启用：界面必须如实说明「未发出任何邮件」，
   * 绝不能显示成「已发送」。
   */
  transportConfigured: boolean;
}

/** 提交响应 —— 原始访问凭证**只在此响应中出现一次**。 */
export interface InquirySubmitResult {
  orderNo: string;
  submittedAt: string;
  /** 原始访问凭证；服务端只保存其 SHA-256 哈希，无法再次回显 */
  accessToken: string;
  accessExpiresAt: string;
  currency: string;
  submittedSubtotal: string;
  itemCount: number;
  emailDelivery: EmailDeliveryView;

  // ---------------------------------------------------------------- G6
  /** 本次询盘实际使用的渠道 */
  channel: InquiryChannel;
  /** 顾客指定的业务类型（未指定为 null） */
  businessType: { key: string; label: string } | null;
  country: string | null;
  city: string | null;
  postalCode: string | null;
  /** 联系人解析结果（未解析到时会带明确原因） */
  contactResolution: ContactResolutionView;
  /** **仅** WhatsApp 渠道非 null */
  whatsapp: WhatsAppPreviewView | null;
}

/**
 * 联系人解析结果。
 *
 * ⚠️ `resolved = false` ⇒ 该渠道当前没有可用联系人：
 *    询盘**已经保存**（订单号与凭证都在），界面必须给出明确提示与后续操作，
 *    绝不能显示成「已成功送达」。
 */
export interface ContactResolutionView {
  resolved: boolean;
  channel: InquiryChannel;
  /**
   * 解析路径：BUSINESS_TYPE_DEFAULT → BUSINESS_TYPE_ANY → GENERAL_DEFAULT → GENERAL_ANY
   *           →（G6-2.6，仅未指定业务类型时）SYSTEM_DEFAULT → SYSTEM_ANY → NONE
   */
  source:
    | 'BUSINESS_TYPE_DEFAULT'
    | 'BUSINESS_TYPE_ANY'
    | 'GENERAL_DEFAULT'
    | 'GENERAL_ANY'
    | 'SYSTEM_DEFAULT'
    | 'SYSTEM_ANY'
    | 'NONE';
  reason: string | null;
  contactOwnerName: string | null;
  businessTypeLabel: string | null;
}

/**
 * WhatsApp 预填消息与 Click to Chat 链接（**仅** WhatsApp 渠道返回）。
 *
 * ⚠️⚠️ 这里只有「消息内容已生成」与「链接已构造」，
 *    **没有**「已发送 / 已送达」—— 普通 wa.me 链接不能自动发送，
 *    也不能可靠确认用户是否点击了发送。
 *    `manualSendRequired` 恒为 true：界面必须如实呈现「需在 WhatsApp 中手动发送」。
 */
export interface WhatsAppPreviewView {
  /** 是否解析到了可用的 WhatsApp 联系人 */
  available: boolean;
  /** 规范化后的国际号码（纯数字，不含 `+`）；未解析到为 null */
  phoneNumber: string | null;
  /** 服务端生成的预填消息（顾客可在 WhatsApp 中编辑后再发送） */
  message: string;
  /** 完整 Click to Chat 链接；未解析到联系人为 null */
  url: string | null;
  /** 消息是否因过长被截断（界面必须提示） */
  truncated: boolean;
  omittedItems: number;
  totalItems: number;
  /** 恒为 true：必须由用户手动确认发送 */
  manualSendRequired: true;
}

/**
 * 公开的「业务类型 × 渠道能力」目录（GET /contacts/business-types）。
 *
 * ⚠️ **不含**邮箱地址、WhatsApp 号码或内部 id ——
 *    具体号码只在提交询盘后由服务端按分配规则选定并返回给该顾客。
 */
export interface PublicBusinessTypeView {
  key: string;
  label: string;
  description: string | null;
  sortOrder: number;
  /** 该业务类型当前**有可用联系人**的渠道 */
  channels: InquiryChannel[];
}

export interface PublicChannelCatalogView {
  /**
   * 当前**实际可用**的渠道（G6-2.2 起按服务端配置计算，不再是固定两条）：
   *   - `EMAIL` **恒在** —— 没有邮箱联系人时，询盘邮件会兜底投递给管理员账号；
   *   - `WHATSAPP` **仅当存在可用联系人时**才出现，否则前台不应展示该渠道。
   */
  channels: InquiryChannel[];
  businessTypes: PublicBusinessTypeView[];
}

/** 订单商品快照（提交当时的价格与名称，不随后续改价而变）。 */
export interface InquiryItemView {
  productId: string;
  productName: string;
  productSlug: string;
  unitPrice: string;
  currency: string;
  quantity: number;
  lineTotal: string;
  imageUrl: string | null;
  imageAltText: string | null;
}

/** 报价单（可版本化，不覆盖顾客最初提交的询价快照）。 */
export interface InquiryQuoteView {
  version: number;
  currency: string;
  itemsSubtotal: string;
  shippingFee: string;
  total: string;
  note: string | null;
  status: QuoteStatus;
  createdAt: string;
}

/**
 * 顾客侧物流信息（G6-3.7）。
 *
 * ⚠️ 本站**未接入任何物流承运商 API** —— 这些值全部由客服**人工登记**，
 *    界面不得渲染成「物流轨迹」「实时物流」之类的说法。
 * ⚠️ `recorded = false` ⇒ 界面**不得**渲染物流区块：
 *    没有登记时什么都不显示，绝不显示空壳或伪造的运单号。
 * ⚠️ 服务端**刻意不下发**客服内部备注（`logisticsNote`），
 *    前端类型里也不应出现该字段。
 */
export interface CustomerLogisticsView {
  /** 是否已由客服登记过任何物流信息（四项全空 ⇒ `false`）。 */
  recorded: boolean;
  carrier: string | null;
  trackingNo: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
}

/** 顾客侧订单视图（订单查询接口返回）。 */
export interface InquiryOrderView {
  orderNo: string;
  submittedAt: string;
  /** 三条彼此独立的状态线，界面必须分开呈现 */
  status: InquiryStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  contactEmail: string;
  contactName: string;
  shippingAddress: string;
  note: string | null;
  currency: string;
  submittedSubtotal: string;
  items: InquiryItemView[];
  /** 按版本倒序（最新在前） */
  quotes: InquiryQuoteView[];
  emailDelivery: EmailDeliveryView;
  /**
   * 已被顾客确认的报价版本号；没有则为 `null`（G6-3.6）。
   *
   * ⚠️ 服务端**派生字段**：`InquiryStatus` 里没有「已确认」这一态
   *    （新增枚举值需要数据库迁移），因此「报价已确认」只能由报价行表达。
   *    界面必须据此覆盖「已报价，等待确认」这类会误导顾客的文案。
   */
  acceptedQuoteVersion: number | null;
  /**
   * 人工登记的物流信息（G6-3.7）。
   *
   * ⚠️ 服务端新增的**响应字段**（数据列早已存在）⇒ 不需要任何迁移；
   *    旧前端会忽略它，因此不存在发布顺序约束。
   */
  logistics: CustomerLogisticsView;
}

/** 409 响应 details.unavailable 的明细项。 */
export interface UnavailableProductRef {
  productId: string;
  /** NOT_FOUND | DRAFT | INACTIVE | ARCHIVED */
  reason: string;
}

/* ------------------------------------------------------------------ */
/* 阶段 7：前台顾客账户                                                */
/* 逐字段对齐后端 src/account/account.mapper.ts —— 改前请先核对映射器。 */
/* ------------------------------------------------------------------ */

/**
 * 顾客账户资料（后端 UserView）。
 *
 * ⚠️ 后端保证**不返回** passwordHash；前端类型里也不应出现该字段。
 */
export interface AccountUserView {
  id: string;
  email: string;
  nickname: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

/** 注册请求体（后端 RegisterDto）。 */
export interface RegisterRequest {
  email: string;
  password: string;
  /** 可选；缺省时服务端用邮箱 @ 之前的部分兜底 */
  nickname?: string;
}

/** 登录请求体（后端 UserLoginDto）。 */
export interface UserLoginRequest {
  email: string;
  password: string;
}

/**
 * 注册 / 登录成功后的响应（后端 UserAuthResult）。
 *
 * 注册成功即自动登录 —— 与登录返回同一结构。
 */
export interface AccountAuthResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  user: AccountUserView;
}

/* ------------------------------------------------------------------ */
/* 阶段 8：账户询价（登录用户查看自己提交的询价单）                    */
/* 逐字段对齐后端 src/inquiry/inquiry.mapper.ts —— 改前请先核对映射器。 */
/* ------------------------------------------------------------------ */

/**
 * 账户询价列表项（摘要）。
 *
 * ⚠️ 与游客查询返回的完整视图不同，列表项**不含**商品明细与报价 ——
 * 明细走详情接口。
 */
export interface CustomerInquirySummaryView {
  id: string;
  orderNo: string;
  submittedAt: string;
  /** 三条彼此独立的状态线，界面必须分开呈现 */
  status: InquiryStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  currency: string;
  submittedSubtotal: string;
  /** 商品行数 */
  itemCount: number;
  /** 已被顾客确认的报价版本号；没有则为 `null`（G6-3.6，与详情视图同源同义）。 */
  acceptedQuoteVersion: number | null;
  /**
   * 当前**可以确认**的报价版本号；没有则为 `null`（G6-3.6）。
   *
   * 由服务端算好下发 —— 列表接口不含报价明细，前端无法自行推断。
   */
  confirmableQuoteVersion: number | null;
  /** 是否存在**正式发送过**的报价（`status !== 'DRAFT'`）（G6-3.6）。 */
  hasReleasedQuote: boolean;
}

/** 账户询价详情：与游客查询的订单视图同构，额外带内部 id。 */
export interface InquiryDetailView extends InquiryOrderView {
  id: string;
}
