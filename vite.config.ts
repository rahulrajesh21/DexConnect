/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'node:path'

const isTest = Boolean(process.env.VITEST)

export default defineConfig({
  plugins: [
    react(),
    ...(isTest
      ? []
      : [
          electron([
            {
              entry: 'electron/main/index.ts',
              vite: {
                build: {
                  outDir: 'dist-electron/main',
                  rollupOptions: {
                    external: ['electron'],
                    onwarn(warning, defaultWarn) {
                      if (warning.message.includes('platform')) return
                      defaultWarn(warning)
                    },
                  },
                },
              },
            },
            {
              entry: 'electron/preload/index.ts',
              onstart(options) {
                options.reload()
              },
              vite: {
                build: {
                  outDir: 'dist-electron/preload',
                  rollupOptions: {
                    external: ['electron'],
                    onwarn(warning, defaultWarn) {
                      if (warning.message.includes('platform')) return
                      defaultWarn(warning)
                    },
                  },
                },
              },
            },
          ]),
          renderer(),
        ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{ts,tsx}'],
  },
})
