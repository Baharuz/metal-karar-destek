import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001';
  const proxy = { '/api': { target, changeOrigin: true } };
  return { plugins: [vue()], server: { proxy }, preview: { proxy } };
});
