import { shallowRef, type ShallowRef } from 'vue';
import type { InquiryOrderView, InquirySubmitResult } from '@/api/types';

/**
 * 询价会话存储（**仅内存**）。
 *
 * 为什么不落 localStorage：
 *   访问凭证是订单查询的唯一授权凭据。一旦写入 localStorage / sessionStorage，
 *   任何同源脚本或后续 XSS 都能直接读走；放在 URL query 里则会进入浏览器历史、
 *   并被 Referer 泄露。因此这里只保存在内存中，刷新页面即失效 ——
 *   由界面引导用户主动「复制 / 下载」凭证自行保管。
 */

export const lastSubmitResult: ShallowRef<InquirySubmitResult | null> = shallowRef(null);
export const lastOrderView: ShallowRef<InquiryOrderView | null> = shallowRef(null);

export function setLastSubmitResult(result: InquirySubmitResult | null): void {
  lastSubmitResult.value = result;
}

export function setLastOrderView(view: InquiryOrderView | null): void {
  lastOrderView.value = view;
}

/** 仅供测试使用。 */
export function __resetInquirySessionForTest(): void {
  lastSubmitResult.value = null;
  lastOrderView.value = null;
}
