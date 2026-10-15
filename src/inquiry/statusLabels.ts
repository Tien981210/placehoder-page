import type {
  FulfillmentStatus,
  InquiryStatus,
  PaymentStatus,
  QuoteStatus,
} from '@/api/types';

/**
 * 状态文案映射。
 *
 * 三条状态线**分开呈现**：跟进 / 付款 / 履约互不覆盖，
 * 界面不得把「已报价」写成「已付款」，也不得把「已发货」写成「已完成付款」。
 */

export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  NEW: '已提交，等待客服跟进',
  IN_REVIEW: '客服跟进中',
  QUOTED: '已报价，等待确认',
  CLOSED: '已结束',
  CANCELLED: '已取消',
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: '未付款',
  LINK_SENT: '已发送付款链接',
  PAID: '已付款',
  REFUNDED: '已退款',
};

export const FULFILLMENT_STATUS_LABELS: Record<FulfillmentStatus, string> = {
  PENDING: '待处理',
  PROCESSING: '备货中',
  SHIPPED: '已发货',
  DELIVERED: '已送达',
  CANCELLED: '已取消',
};

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: '草稿',
  SENT: '已发送',
  ACCEPTED: '顾客已接受',
  DECLINED: '顾客已拒绝',
  EXPIRED: '已过期',
};

/** 商品不可询价的原因文案（后端 409 details.unavailable[].reason）。 */
export function unavailableReasonLabel(reason: string): string {
  switch (reason) {
    case 'NOT_FOUND':
      return '商品不存在';
    case 'DRAFT':
      return '商品尚未发布';
    case 'INACTIVE':
      return '商品已下架';
    case 'ARCHIVED':
      return '商品已归档';
    default:
      return `当前不可询价（${reason}）`;
  }
}

export function inquiryStatusLabel(status: InquiryStatus): string {
  return INQUIRY_STATUS_LABELS[status] ?? status;
}

export function paymentStatusLabel(status: PaymentStatus): string {
  return PAYMENT_STATUS_LABELS[status] ?? status;
}

export function fulfillmentStatusLabel(status: FulfillmentStatus): string {
  return FULFILLMENT_STATUS_LABELS[status] ?? status;
}

export function quoteStatusLabel(status: QuoteStatus): string {
  return QUOTE_STATUS_LABELS[status] ?? status;
}

/** `describeOrderProgress` 的入参 —— 全部来自服务端返回的订单视图。 */
export interface OrderProgressInput {
  status: InquiryStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  /** 已被顾客确认的报价版本号；没有则为 `null`。 */
  acceptedQuoteVersion: number | null;
  /**
   * 当前**可以确认**的报价版本号；没有则为 `null`。
   * 由 `describeQuoteAcceptance()` 从报价列表算出（可选，省略视为 `null`）。
   */
  confirmableQuoteVersion?: number | null;
  /**
   * 是否存在**正式发送过**的报价（`status !== 'DRAFT'`）。
   * 由 `describeQuoteAcceptance()` 算出（可选，省略视为 `false`）。
   */
  hasReleasedQuote?: boolean;
}

/**
 * 把三条状态线 + 报价确认状态合成**一句话的订单进度**。
 *
 * 为什么需要：
 *   三条状态线是**相互独立**的（客服跟进 / 付款 / 履约），单独看没问题，
 *   但顾客需要一句话知道「现在轮到谁」。尤其是「报价已确认」这个状态 ——
 *   `InquiryStatus` 枚举里根本没有它（新增枚举值要迁移），
 *   于是 `QUOTED` 的文案「已报价，等待确认」在顾客确认之后会**说反**。
 *   这里按「从最末端的进展往回退」的优先级给出唯一答案。
 *
 * ⚠️ **只使用项目真实支持的状态**，绝不虚构能力：
 *   - 付款线在本站**没有在线支付**，`PAID` / `REFUNDED` 都是客服**人工登记**的，
 *     因此文案写「客服已登记收款 / 已登记退款」，绝不写「支付成功」；
 *   - 履约线的物流信息同样是客服**人工登记**，绝不写成「已同步物流轨迹」。
 */
export function describeOrderProgress(input: OrderProgressInput): string {
  const {
    status,
    paymentStatus,
    fulfillmentStatus,
    acceptedQuoteVersion,
    confirmableQuoteVersion = null,
    hasReleasedQuote = false,
  } = input;

  // 1. 询盘终态优先 —— 之后的一切进展都不再是「进行中」。
  if (status === 'CANCELLED') return '已取消';
  if (status === 'CLOSED') return '已结束';

  // 2. 履约线（从最末端往回退）
  if (fulfillmentStatus === 'DELIVERED') return '已完成（物流信息由客服人工登记）';
  if (fulfillmentStatus === 'SHIPPED') return '已发货（物流信息由客服人工登记）';
  if (fulfillmentStatus === 'PROCESSING') return '备货中';
  if (fulfillmentStatus === 'CANCELLED') return '履约已取消';

  // 3. 付款线（本站不经手在线支付，全部为客服人工登记）
  if (paymentStatus === 'REFUNDED') return '已登记退款（客服人工登记，非在线支付）';
  if (paymentStatus === 'PAID') return '客服已登记收款（非在线支付）';
  if (paymentStatus === 'LINK_SENT') return '客服已发送付款指引';

  // 4. 报价确认状态
  if (acceptedQuoteVersion !== null) {
    return `报价已确认（第 ${acceptedQuoteVersion} 版），等待客服处理`;
  }
  if (confirmableQuoteVersion !== null) return '报价待确认';

  // 5. 只剩跟进线
  //    ⚠️ 走到这里说明没有「可确认的已发送报价」（否则第 4 步已返回）。
  //       若确实存在正式发送过的版本（例如已过期 / 已拒绝），措辞必须与
  //       「全是草稿、尚未发送」区分开，否则会让顾客以为报价已经发出。
  if (status === 'QUOTED') {
    return hasReleasedQuote ? '客服已生成报价，请查看最新一版' : '客服已生成报价草稿，尚未正式发送';
  }
  if (status === 'IN_REVIEW') return '客服跟进中';
  return '已提交，等待客服跟进';
}
