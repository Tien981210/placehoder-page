import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VISITOR_ID_STORAGE_KEY, __resetVisitorIdForTest } from './visitor-id';
import { useVisitorTracking, type VisitorReportFn } from './useVisitorTracking';

/**
 * 主站访客采集单测（G6-5.8）。
 *
 * 锁定：
 *   ① 首次进入就上报一次（不会因为「起始路由未解析」而丢失首次访问）；
 *   ② SPA 路由变化各上报一次；**同一路径重复导航不重复上报**；
 *   ③ 上报被调度到空闲时段（`schedule`），**不在 setup 期间同步发出**；
 *   ④ 上报失败**静默**：不抛错、不写 console.error；
 *   ⑤ 无法持久化 visitorId ⇒ 不上报（不用临时 id 冒充访客）。
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createTestRouter(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div>home</div>' }, meta: { title: '首页' } },
      {
        path: '/products',
        name: 'products',
        component: { template: '<div>products</div>' },
        meta: { title: '商品' },
      },
      {
        path: '/about',
        name: 'about',
        component: { template: '<div>about</div>' },
        meta: { title: '关于' },
      },
    ],
  });
}

interface Harness {
  router: Router;
  reports: string[];
  scheduleCalls: number;
}

/** 挂载一个只调用本 composable 的宿主组件。 */
async function mountTracking(
  options: {
    report?: VisitorReportFn;
    deferred?: boolean;
    onFlush?: (() => void) | null;
  } = {},
): Promise<Harness> {
  const router = createTestRouter();
  const reports: string[] = [];
  const pending: Array<() => void> = [];
  const harness: Harness = { router, reports, scheduleCalls: 0 };

  const report =
    options.report ??
    (async (visitorId: string) => {
      reports.push(visitorId);
    });

  const schedule = (task: () => void): void => {
    harness.scheduleCalls += 1;
    if (options.deferred) {
      pending.push(task);
      return;
    }
    task();
  };

  const Host = defineComponent({
    setup() {
      useVisitorTracking({ report, schedule });
      return () => h('div');
    },
  });

  mount(Host, { global: { plugins: [router] } });

  await router.isReady();
  await flushPromises();

  // 供 deferred 模式在测试中手动放行
  (harness as Harness & { flush?: () => Promise<void> }).flush = async () => {
    for (const task of pending.splice(0)) task();
    await flushPromises();
  };

  return harness;
}

/** 手动放行被延迟调度的任务。 */
async function flushScheduled(harness: Harness): Promise<void> {
  const withFlush = harness as Harness & { flush?: () => Promise<void> };
  if (withFlush.flush) await withFlush.flush();
  await flushPromises();
}

describe('useVisitorTracking', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetVisitorIdForTest();
  });

  afterEach(() => {
    localStorage.clear();
    __resetVisitorIdForTest();
  });

  it('🔴 首次进入即上报一次，且携带合法 UUID v4', async () => {
    const harness = await mountTracking();

    expect(harness.reports).toHaveLength(1);
    expect(harness.reports[0]).toMatch(UUID_V4);
  });

  it('🔴 SPA 路由变化各上报一次', async () => {
    const harness = await mountTracking();

    await harness.router.push('/products');
    await flushPromises();
    expect(harness.reports).toHaveLength(2);

    await harness.router.push('/about');
    await flushPromises();
    expect(harness.reports).toHaveLength(3);
  });

  it('🔴 同一路径重复导航不重复上报', async () => {
    const harness = await mountTracking();

    await harness.router.push('/products');
    await flushPromises();
    const afterFirstVisit = harness.reports.length;

    await harness.router.push('/products'); // 重复导航
    await flushPromises();

    expect(harness.reports).toHaveLength(afterFirstVisit);
  });

  it('查询参数变化视为新的页面浏览（fullPath 变化）', async () => {
    const harness = await mountTracking();

    await harness.router.push('/products?status=ACTIVE');
    await flushPromises();
    const afterFirst = harness.reports.length;

    await harness.router.push('/products?status=DRAFT');
    await flushPromises();

    expect(harness.reports.length).toBe(afterFirst + 1);
  });

  it('所有上报使用**同一个** visitorId（刷新 / 跳转不会变成新访客）', async () => {
    const harness = await mountTracking();

    await harness.router.push('/products');
    await flushPromises();
    await harness.router.push('/about');
    await flushPromises();

    expect(new Set(harness.reports).size).toBe(1);
    expect(localStorage.getItem(VISITOR_ID_STORAGE_KEY)).toBe(harness.reports[0]);
  });

  it('🔴 上报被调度（不阻塞 setup / 首次渲染）', async () => {
    const harness = await mountTracking({ deferred: true });

    // 调度已发生，但任务尚未执行 ⇒ 上报还没有发出
    expect(harness.scheduleCalls).toBe(1);
    expect(harness.reports).toHaveLength(0);

    await flushScheduled(harness);
    expect(harness.reports).toHaveLength(1);
  });

  it('🔴 上报失败 ⇒ 静默（不抛错、不写 console.error、不影响后续导航）', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reports: string[] = [];

    const harness = await mountTracking({
      report: async (visitorId: string) => {
        reports.push(visitorId);
        throw new Error('统计接口 500');
      },
    });

    expect(reports).toHaveLength(1);
    expect(errorSpy).not.toHaveBeenCalled();

    // 后续导航仍然正常上报（失败不阻断链路）
    await harness.router.push('/products');
    await flushPromises();
    expect(reports).toHaveLength(2);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('网络拒绝（Promise reject 非 Error）同样静默', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      mountTracking({
        report: async () => {
          throw 'network down';
        },
      }),
    ).resolves.toBeDefined();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('🔴 无法持久化 visitorId ⇒ 不上报（不用临时 id 冒充访客）', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const harness = await mountTracking();

    expect(harness.reports).toHaveLength(0);
  });

  it('上报内容只有 visitorId（不发送路径 / 账号信息）', async () => {
    const payloads: string[] = [];
    const harness = await mountTracking({
      report: async (visitorId: string) => {
        payloads.push(visitorId);
      },
    });

    await harness.router.push('/products?secret=1');
    await flushPromises();

    expect(payloads).toHaveLength(2);
    // 只传一个参数 ⇒ 结构上不可能夹带路径或账号字段
    for (const payload of payloads) {
      expect(payload).toMatch(UUID_V4);
      expect(payload).not.toContain('secret');
      expect(payload).not.toContain('products');
    }
  });
});
