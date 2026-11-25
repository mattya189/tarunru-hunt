import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    // Keep the WebGL engine cacheable across gameplay updates.
    chunkSizeWarningLimit: 620,
    rollupOptions: { output: { manualChunks: { three: ['three'] } } },
  },
})
