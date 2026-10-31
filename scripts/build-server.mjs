// The Node entry, as one JavaScript file.
//
// The runtime image carries the bundle, not the TypeScript source and not tsx. The packages the
// bundle leaves external (`hono`, `@hono/node-server`, `ws`) are the three the server actually
// calls at runtime; Node's own built-ins stay external automatically. `dist/server.js` is the
// entry `npm run server` and the image's CMD run.
import { mkdirSync } from 'node:fs'
import { build } from 'esbuild'

mkdirSync('dist', { recursive: true })

await build({
  entryPoints: ['server/index.node.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  external: ['hono', '@hono/node-server', 'ws'],
  logLevel: 'info',
})
