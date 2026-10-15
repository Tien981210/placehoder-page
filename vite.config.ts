import { fileURLToPath, URL } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

/**
 * 主站构建配置。
 *
 * 技术路线（已确认，不得替换）：Vue 3 SPA + Vue Router + Vite。
 * 本项目是纯客户端单页应用，**没有** SSR / 服务端渲染，也**不是** Next.js。
 *
 * 开发端口默认 5173，可由 .env 的 `VITE_DEV_PORT` 覆盖 ——
 * 用于本机 5173 已被其它项目占用的场景（strictPort=true 会直接失败而不是静默换端口）。
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const devPort = Number(env.VITE_DEV_PORT || 5173);

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: devPort,
      strictPort: true,
      // 绑定所有网卡（0.0.0.0），便于同一局域网内的手机访问 dev server。
      // 仅影响本地开发服务器；生产构建产物是纯静态文件，不包含该配置。
      // （Vite 8 对 IP 字面量形式的 Host 头恒放行，无需额外配置 allowedHosts。）
      host: true,
    },
    preview: {
      port: 4173,
      strictPort: true,
    },
  };
});
