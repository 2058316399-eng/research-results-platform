import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/postcss";

export default defineConfig({
  base: "/research-results-platform/",
  plugins: [react()],
  resolve: {
    alias: { "next/image": fileURLToPath(new URL("./src/static/image.tsx", import.meta.url)) },
  },
  css: {
    postcss: { plugins: [tailwind({ base: fileURLToPath(new URL("./src", import.meta.url)) })] },
  },
  build: {
    outDir: "docs",
    emptyOutDir: true,
    sourcemap: false,
  },
});
