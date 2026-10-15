import { defineConfig } from "vite";
export default defineConfig({
  server: {
    port: 8839,
    proxy: {
      "/api": "http://127.0.0.1:8838",
      "/audio": "http://127.0.0.1:8838",
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          "auth-vendor": ["@supabase/supabase-js"],
          "markdown-vendor": ["react-markdown", "remark-gfm"],
          "react-vendor": ["react", "react-dom"],
        },
      },
    },
  },
});
