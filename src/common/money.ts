/**
 * 金额工具。
 *
 * 后端把 price / compareAtPrice 以「字符串」形式返回（数据库列为 DECIMAL），
 * 例如 "12.34"。前端一律转成「分」做整数运算，避免浮点误差。
 */

/** 把形如 "12.34" 的金额字符串转成分（整数）。非法输入返回 0。 */
export function parseMoneyToCents(value: string | null | undefined): number {
  if (!value) return 0;
  const normalized = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return 0;
  const negative = normalized.startsWith('-');
  const [intPart, fracPart = ''] = normalized.replace('-', '').split('.');
  const cents = Number(intPart) * 100 + Number((fracPart + '00').slice(0, 2));
  return negative ? -cents : cents;
}

/** 把分转回展示用的金额字符串，例如 1234 → "12.34"。 */
export function formatCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const intPart = Math.floor(abs / 100);
  const fracPart = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

/** 带货币符号的展示。 */
export function formatMoney(value: string | null | undefined, currency = 'USD'): string {
  const cents = parseMoneyToCents(value);
  const symbol = currencySymbol(currency);
  return `${symbol}${formatCents(cents)}`;
}

export function currencySymbol(currency: string): string {
  switch (currency.trim().toUpperCase()) {
    case 'USD':
      return '$';
    case 'CNY':
    case 'RMB':
      return '¥';
    case 'EUR':
      return '€';
    case 'GBP':
      return '£';
    default:
      return '';
  }
}
