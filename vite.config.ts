/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const isCapacitor = process.env.CAPACITOR === 'true'

export default defineConfig({
  base: isCapacitor ? './' : '/',
  plugins: [
    react(),
    ...(isCapacitor
      ? []
      : [
          VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['icons/icon.svg'],
            manifest: {
              name: 'DailyNote - 日程计划管理',
              short_name: 'DailyNote',
              description: '计划·反思·收获 — 三位一体的日程管理系统',
              theme_color: '#1a1a2e',
              background_color: '#ffffff',
              display: 'standalone',
              orientation: 'portrait',
              start_url: '/',
              icons: [
                {
                  src: 'icons/icon.svg',
                  sizes: '512x512',
                  type: 'image/svg+xml',
                  purpose: 'any maskable',
                },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
              runtimeCaching: [
                {
                  urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
                  handler: 'CacheFirst',
                  options: {
                    cacheName: 'google-fonts',
                    expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
                  },
                },
              ],
            },
          }),
        ]),
  ],
})
