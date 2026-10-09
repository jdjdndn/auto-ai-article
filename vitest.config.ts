import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['dist-test/**', 'third_party/**', 'node_modules/**'],
  },
})
