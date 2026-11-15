import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    target: 'chrome116',
    rollupOptions: {
      input: {
        background: resolve('src/background.ts'),
        sidepanel: resolve('sidepanel.html'),
        options: resolve('options.html'),
        onboarding: resolve('onboarding.html'),
      },
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
})
