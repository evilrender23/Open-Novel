import { defineConfig } from "vite";

// Configuración pensada para Tauri: puerto fijo y sin observar src-tauri.
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "chrome120",
    outDir: "dist",
    emptyOutDir: true,
  },
});
