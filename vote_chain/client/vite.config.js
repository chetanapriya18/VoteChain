import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Allow ALL hosts (for development only!)
    allowedHosts: true,
    
    // OR allow specific patterns:
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '.ngrok-free.dev',  // Allows ALL ngrok domains
      '.ngrok.io',       // Allows paid ngrok domains
      '.loca.lt'         // Allows localtunnel domains
    ]
  }
})