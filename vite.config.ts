import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The commit an error report came from. CI passes the sha; a local build says `dev`.
  define: { __RELEASE__: JSON.stringify((process.env.GITHUB_SHA ?? 'dev').slice(0, 7)) },
  build: {
    // The manifest names every file and what it imports, which is how the size check knows what
    // the board actually downloads before it draws — no guessing from a glob of the output folder.
    manifest: true,
    // A reported stack says `at dropCardAt (index-abc.js:1:4821)` rather than `at t (...)`, and
    // `keepNames` has to be set where the minifier reads it: this Vite minifies with oxc, so an
    // `esbuild` option would be ignored.
    rolldownOptions: { output: { keepNames: true } },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
  },
})
