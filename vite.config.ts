import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    base: './', // Crucial for Electron: ensures assets use relative paths (e.g., "./script.js" instead of "/script.js")
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
      'process.env.NODE_ENV': JSON.stringify(mode),
    },
    server: {
      port: 5173,
      strictPort: true,
    }
  }
})