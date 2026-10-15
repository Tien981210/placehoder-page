import { describe, expect, it } from 'vitest';
import {
  describeOrderProgress,
  fulfillmentStatusLabel,
  inquiryStatusLabel,
  paymentStatusLabel,
  quoteStatusLabel,
  unavailableReasonLabel,
} from './statusLabels';

/**
 * 状态文案测试。
 *
 * 重点（任务书 5.3 / 六）：
 *   - 三条状态线**分开**呈现，绝不互相覆盖（「已报价」≠「已付款」）；
 *   - 「报价已确认」必须能从进度里看出来（`InquiryStatus` 没有这一态）；
 *   - 付款 / 物流都是**客服人工登记**，文案不得写成「支付成功」「物流已同步」；
 *   - 只使用项目真实支持的状态，不虚构能力。
 */

const base = {
  status: 'NEW' as const,
  paymentStatus: 'UNPAID' as const,
  fulfillmentStatus: 'PENDING' as const,
  acceptedQuoteVersion: null,
};

describe('状态文案映射', () => {
  it('跟进线文案与后端枚举一一对应', () => {
    expect(inquiryStatusLabel('NEW')).toBe('已提交，等待客服跟进');
    expect(inquiryStatusLabel('IN_REVIEW')).toBe('客服跟进中');
    expect(inquiryStatusLabel('QUOTED')).toBe('已报价，等待确认');
    expect(inquiryStatusLabel('CLOSED')).toBe('已结束');
    expect(inquiryStatusLabel('CANCELLED')).toBe('已取消');
  });

  it('付款线与履约线彼此独立，不共用文案', () => {
    expect(paymentStatusLabel('UNPAID')).toBe('未付款');
    expect(paymentStatusLabel('PAID')).toBe('已付款');
    expect(fulfillmentStatusLabel('PENDING')).toBe('待处理');
    expect(fulfillmentStatusLabel('SHIPPED')).toBe('已发货');
    // 「已发货」绝不能写成「已付款」
    expect(fulfillmentStatusLabel('SHIPPED')).not.toBe(paymentStatusLabel('PAID'));
  });

  it('报价状态文案完整', () => {
    expect(quoteStatusLabel('DRAFT')).toBe('草稿');
    expect(quoteStatusLabel('SENT')).toBe('已发送');
    expect(quoteStatusLabel('ACCEPTED')).toBe('顾客已接受');
    expect(quoteStatusLabel('DECLINED')).toBe('顾客已拒绝');
    expect(quoteStatusLabel('EXPIRED')).toBe('已过期');
  });

  it('商品不可询价原因文案（含未知原因的兜底）', () => {
    expect(unavailableReasonLabel('NOT_FOUND')).toBe('商品不存在');
    expect(unavailableReasonLabel('INACTIVE')).toBe('商品已下架');
    expect(unavailableReasonLabel('SOMETHING_NEW')).toBe('当前不可询价（SOMETHING_NEW）');
  });
});

describe('describeOrderProgress —— 询盘终态优先', () => {
  it('已取消 / 已结束压过其它一切进展', () => {
    expect(
      describeOrderProgress({
        ...base,
        status: 'CANCELLED',
        fulfillmentStatus: 'SHIPPED',
        acceptedQuoteVersion: 2,
      }),
    ).toBe('已取消');
    expect(describeOrderProgress({ ...base, status: 'CLOSED' })).toBe('已结束');
  });
});

describe('describeOrderProgress —— 履约线', () => {
  it('已送达 ⇒ 已完成，并说明物流是人工登记', () => {
    const text = describeOrderProgress({ ...base, fulfillmentStatus: 'DELIVERED' });
    expect(text).toContain('已完成');
    expect(text).toContain('人工登记');
    // 不得暗示已接入承运商物流
    expect(text).not.toContain('物流轨迹');
  });

  it('已发货 ⇒ 已发货（人工登记）', () => {
    const text = describeOrderProgress({ ...base, fulfillmentStatus: 'SHIPPED' });
    expect(text).toContain('已发货');
    expect(text).toContain('人工登记');
  });

  it('备货中 / 履约已取消', () => {
    expect(describeOrderProgress({ ...base, fulfillmentStatus: 'PROCESSING' })).toBe('备货中');
    expect(describeOrderProgress({ ...base, fulfillmentStatus: 'CANCELLED' })).toBe('履约已取消');
  });
});

describe('describeOrderProgress —— 付款线（本站不经手在线支付）', () => {
  it('已付款 ⇒ 明确写「客服已登记收款」，绝不写「支付成功」', () => {
    const text = describeOrderProgress({ ...base, paymentStatus: 'PAID' });
    expect(text).toContain('已登记收款');
    expect(text).toContain('非在线支付');
    expect(text).not.toContain('支付成功');
  });

  it('已退款 ⇒ 明确写「已登记退款」', () => {
    const text = describeOrderProgress({ ...base, paymentStatus: 'REFUNDED' });
    expect(text).toContain('已登记退款');
  });

  it('未付款 / 已发送付款指引', () => {
    expect(describeOrderProgress({ ...base, paymentStatus: 'LINK_SENT' })).toBe('客服已发送付款指引');
    expect(describeOrderProgress(base)).toBe('已提交，等待客服跟进');
  });
});

describe('describeOrderProgress —— 报价确认状态', () => {
  it('已确认报价 ⇒ 明确显示版本号，且不再说「等待确认」', () => {
    const text = describeOrderProgress({ ...base, status: 'QUOTED', acceptedQuoteVersion: 2 });
    expect(text).toContain('第 2 版');
    expect(text).toContain('已确认');
    expect(text).not.toContain('等待确认');
  });

  it('存在可确认的已发送报价 ⇒ 报价待确认', () => {
    expect(
      describeOrderProgress({ ...base, status: 'QUOTED', confirmableQuoteVersion: 1 }),
    ).toBe('报价待确认');
  });

  it('全是草稿 ⇒ 明确说明尚未正式发送（不诱导顾客去确认）', () => {
    const text = describeOrderProgress({ ...base, status: 'QUOTED', hasReleasedQuote: false });
    expect(text).toContain('草稿');
    expect(text).toContain('尚未正式发送');
    expect(text).not.toContain('待确认');
  });

  it('已发送但不可确认（例如已过期 / 已拒绝）⇒ 措辞与「全是草稿」区分开', () => {
    const text = describeOrderProgress({ ...base, status: 'QUOTED', hasReleasedQuote: true });
    expect(text).not.toContain('尚未正式发送');
    expect(text).toContain('已生成报价');
  });

  it('已确认报价时，付款线进展优先展示（更靠后的真实进展）', () => {
    expect(
      describeOrderProgress({
        ...base,
        status: 'QUOTED',
        paymentStatus: 'PAID',
        acceptedQuoteVersion: 1,
      }),
    ).toBe('客服已登记收款（非在线支付）');
  });
});

describe('describeOrderProgress —— 跟进线兜底', () => {
  it('客服跟进中', () => {
    expect(describeOrderProgress({ ...base, status: 'IN_REVIEW' })).toBe('客服跟进中');
  });

  it('刚提交', () => {
    expect(describeOrderProgress(base)).toBe('已提交，等待客服跟进');
  });
});
