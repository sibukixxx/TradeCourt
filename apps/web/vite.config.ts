import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local only. Defaults follow the port contract (web 5173 -> API 8787). The isolated browser E2E
// (scripts/e2e-browser.mjs) overrides both ports; any non-loopback API origin is refused.
const apiOrigin = process.env.TRADECOURT_API_ORIGIN ?? 'http://127.0.0.1:8787'
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}$/.test(apiOrigin)) {
  throw new Error(`TRADECOURT_API_ORIGIN must be a loopback http origin, got: ${apiOrigin}`)
}
const port = Number(process.env.TRADECOURT_WEB_PORT ?? 5173)

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    proxy: { '/api': apiOrigin },
  },
  preview: { host: '127.0.0.1', port, strictPort: true },
})
