// Vite config for the React clinic frontend, including local API proxying and chunk splitting.
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = String(env.VITE_DEV_PROXY_TARGET || 'http://127.0.0.1:5000').trim()

  return {
    plugins: [react()],
    server: {
      port: 3002,
      host: '0.0.0.0',
      allowedHosts: [
        'localhost',
        '127.0.0.1'
      ],
      strictPort: false,
      // Proxy backend routes in development so the browser can call Flask without CORS setup.
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true
        },
        '/uploads': {
          target: proxyTarget,
          changeOrigin: true
        },
        '/reports': {
          target: proxyTarget,
          changeOrigin: true
        }
      }
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        output: {
          // Group heavier vendors into stable chunks so exam/report tooling loads on demand.
          manualChunks(id) {
            // Shared preload helpers must not live in an optional feature chunk.
            if (id.includes('preload-helper') || id.includes('commonjsHelpers')) return 'runtime'
            if (!id.includes('node_modules')) {
              return undefined
            }

            if (id.includes('@mediapipe')) {
              return 'vision'
            }

            if (id.includes('jspdf')) {
              return 'reporting'
            }
            if (id.includes('html2canvas')) return 'report-capture'
            if (id.includes('dompurify')) return 'report-sanitize'

            if (
              id.includes('react') ||
              id.includes('scheduler') ||
              id.includes('react-router')
            ) {
              return 'react-vendor'
            }

            if (id.includes('axios')) {
              return 'data-vendor'
            }

            // Keep optional PDF/image dependencies with their consumers.
            // A catch-all vendor chunk would also load them with the login page.
            return undefined
          }
        }
      }
    }
  }
})
