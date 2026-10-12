import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const webDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Sign-in needs the public anon key, which scripts/gen-env.py already writes
  // to the repo root .env as SUPABASE_ANON_KEY. Only that one variable is read
  // from there, so no server secret can reach the browser. A
  // VITE_SUPABASE_ANON_KEY set for the web app itself wins.
  const own = loadEnv(mode, webDir, 'VITE_SUPABASE_ANON_KEY')
  const root = loadEnv(mode, repoRoot, 'SUPABASE_ANON_KEY')
  const anonKey = own.VITE_SUPABASE_ANON_KEY || root.SUPABASE_ANON_KEY || ''

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(anonKey),
    },
    server: {
      proxy: {
        '/api': 'http://localhost:8000',
      },
    },
  }
})
