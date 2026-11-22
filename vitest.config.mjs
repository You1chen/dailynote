import { defineConfig } from 'vitest/config';

// 单元测试不加载应用构建/PWA 插件；native loader 避免 Windows 配置打包的额外子进程。
export default defineConfig({
  test: { include: ['test/**/*.test.{ts,tsx}'], pool: 'threads' },
});
