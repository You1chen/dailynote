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
            includeAssets: ['icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'],
            manifest: {
              name: 'DailyNote · 日程与卡片',
              short_name: 'DailyNote',
              description: '两页的日程、待办、卡片关系网，本地优先。',
              lang: 'zh-CN',
              theme_color: '#f5f5f7',
              background_color: '#f5f5f7',
              display: 'standalone',
              orientation: 'portrait',
              start_url: '/',
              icons: [
                {
                  src: 'icons/icon-192.png',
                  sizes: '192x192',
                  type: 'image/png',
                  purpose: 'any',
                },
                {
                  src: 'icons/icon-512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'any',
                },
                {
                  src: 'icons/icon.svg',
                  sizes: '512x512',
                  type: 'image/svg+xml',
                  purpose: 'maskable',
                },
              ],
            },
            workbox: {
              globPatterns: ['**/*.{js,css,html,ico,png,svg,traineddata}'],
              maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
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
