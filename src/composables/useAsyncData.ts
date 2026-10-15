import { ref, shallowRef, type Ref } from 'vue';

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseAsyncDataResult<T> {
  readonly data: Ref<T | null>;
  readonly error: Ref<unknown>;
  readonly status: Ref<AsyncStatus>;
  readonly isLoading: Ref<boolean>;
  readonly isError: Ref<boolean>;
  readonly load: () => Promise<void>;
  /**
   * 丢弃当前数据与错误，回到 `idle`（并让进行中的请求作废）。
   *
   * ⚠️ G6-3.4 引入：账户相关页面在「登出 / 切换账号」时必须**立刻清掉上一个
   *    账号的数据**，否则旧数据会残留在新账号的页面上（跨标签页切换时尤其明显）。
   */
  readonly reset: () => void;
}

/**
 * 统一的数据加载状态机：idle → loading → success | error。
 *
 * 页面据此渲染「加载中 / 空 / 错误」三种状态，避免每个页面各写一套。
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  options: { immediate?: boolean } = {},
): UseAsyncDataResult<T> {
  const data = shallowRef<T | null>(null);
  const error = shallowRef<unknown>(null);
  const status = ref<AsyncStatus>('idle');
  const isLoading = ref(false);
  const isError = ref(false);

  let requestSeq = 0;

  async function load(): Promise<void> {
    const seq = ++requestSeq;
    status.value = 'loading';
    isLoading.value = true;
    isError.value = false;
    error.value = null;

    try {
      const result = await loader();
      if (seq !== requestSeq) return; // 过期响应，丢弃
      data.value = result;
      status.value = 'success';
    } catch (err) {
      if (seq !== requestSeq) return;
      error.value = err;
      isError.value = true;
      status.value = 'error';
    } finally {
      if (seq === requestSeq) isLoading.value = false;
    }
  }

  function reset(): void {
    // 递增序号 ⇒ 任何在途请求的结果都会被判为「过期」而丢弃
    requestSeq += 1;
    data.value = null;
    error.value = null;
    status.value = 'idle';
    isLoading.value = false;
    isError.value = false;
  }

  if (options.immediate !== false) {
    void load();
  }

  return { data, error, status, isLoading, isError, load, reset };
}
