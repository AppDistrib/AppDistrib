'use strict'

import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path-browserify'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/front', import.meta.url)),
      path: 'path-browserify'
    }
  },
  build: { sourcemap: true, minify: true }
})
