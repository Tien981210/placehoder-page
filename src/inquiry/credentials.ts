import type { InquirySubmitResult } from '@/api/types';
import { BRAND } from '@/config';

/**
 * 访问凭证的导出工具。
 *
 * 设计意图：凭证只存在于内存中，用户必须**主动**保存。
 * 这里提供「复制到剪贴板」与「下载为 txt」两条路径，
 * 两者都不经过网络，也不写入浏览器持久存储。
 *
 * 🔴 临时站裁剪说明：
 *    原 `summarizeOrderItems` 与「订单查询入口链接」已删除 ——
 *    临时站没有游客订单查询页。凭证仍是后端下发的真实凭据，
 *    保存文案据实改为「联系客服时提供」。
 *
 * 品牌名取自 `src/config/brand.ts`（此处不再写死），
 * 品牌定稿后导出的 txt 抬头会自动跟着变。
 */

/** 凭证文件内容 —— 只包含顾客自查所需信息，不含任何内部字段。 */
export function buildCredentialFileText(
  result: Pick<
    InquirySubmitResult,
    'orderNo' | 'accessToken' | 'accessExpiresAt' | 'submittedAt' | 'submittedSubtotal' | 'currency'
  >,
): string {
  const title = `${BRAND.brandName} 询价单访问凭证`;
  return [
    title,
    '='.repeat(Math.max(title.length, 12)),
    `询价单号：${result.orderNo}`,
    `访问凭证：${result.accessToken}`,
    `凭证有效期至：${result.accessExpiresAt}`,
    '',
    `提交时间：${result.submittedAt}`,
    `商品小计：${result.submittedSubtotal} ${result.currency}`,
    '',
    '请妥善保管本文件。如需查询询价进度，请通过邮件或 WhatsApp 联系客服，',
    '并提供「询价单号」与「访问凭证」以便核实身份。',
    '',
    '注意：访问凭证等同于取件凭据，请勿转发给他人或公开发布。',
    '',
  ].join('\n');
}

/** 触发浏览器下载（仅在浏览器环境可用）。 */
export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // 交回对象 URL，避免长时间占用内存
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * 复制文本到剪贴板。
 *
 * 优先用异步 Clipboard API；在非安全上下文（http + 非 localhost）或旧浏览器下
 * 退回 execCommand('copy')。返回是否成功，调用方据此给出如实提示。
 */
export async function copyText(text: string): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // 继续走降级路径
    }
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
