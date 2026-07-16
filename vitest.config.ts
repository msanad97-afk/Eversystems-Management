import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import path from 'path'

// Load .env so integration tests (idgen) get DATABASE_URL, like Next does at runtime.
const env = loadEnv('test', process.cwd(), '')
if (env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
})
