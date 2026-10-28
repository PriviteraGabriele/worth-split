import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      id: '/',
      name: 'WorthSplit',
      short_name: 'WorthSplit',
      description: 'Il tuo patrimonio, diviso con chiarezza.',
      start_url: '/',
      scope: '/',
      theme_color: '#09090A',
      background_color: '#09090A',
      display: 'standalone',
      icons: [
        { src: '/branding/logo-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/branding/logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/branding/logo-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: '/branding/logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ],
    },
    workbox: {
      cleanupOutdatedCaches: true,
      navigateFallback: '/index.html',
      runtimeCaching: [{ urlPattern: /\/api\//, handler: 'NetworkOnly' }],
    },
  })],
  server: { proxy: { '/api': process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000', '/health': process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000' } },
});
