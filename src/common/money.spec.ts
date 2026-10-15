import { describe, expect, it } from 'vitest';
import { currencySymbol, formatCents, formatMoney, parseMoneyToCents } from './money';

describe('money', () => {
  it('把金额字符串解析为分', () => {
    expect(parseMoneyToCents('12.34')).toBe(1234);
    expect(parseMoneyToCents('0.05')).toBe(5);
    expect(parseMoneyToCents('100')).toBe(10000);
    expect(parseMoneyToCents('12.3')).toBe(1230);
  });

  it('非法输入返回 0', () => {
    expect(parseMoneyToCents(null)).toBe(0);
    expect(parseMoneyToCents(undefined)).toBe(0);
    expect(parseMoneyToCents('')).toBe(0);
    expect(parseMoneyToCents('abc')).toBe(0);
    expect(parseMoneyToCents('1.2.3')).toBe(0);
  });

  it('分转字符串保持两位小数', () => {
    expect(formatCents(1234)).toBe('12.34');
    expect(formatCents(5)).toBe('0.05');
    expect(formatCents(0)).toBe('0.00');
    expect(formatCents(10000)).toBe('100.00');
  });

  it('带货币符号格式化', () => {
    expect(formatMoney('12.34', 'USD')).toBe('$12.34');
    expect(formatMoney('12.34', 'CNY')).toBe('¥12.34');
    expect(formatMoney(null, 'USD')).toBe('$0.00');
  });

  it('未知货币返回空符号', () => {
    expect(currencySymbol('XYZ')).toBe('');
  });

  it('整数运算避免浮点误差', () => {
    // 0.1 + 0.2 的经典问题：按分相加得到精确结果
    expect(formatCents(parseMoneyToCents('0.1') + parseMoneyToCents('0.2'))).toBe('0.30');
  });
});
