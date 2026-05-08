import { defineConfig } from "electron-vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { resolve } from "node:path";

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { include: ["electron"] },
      rollupOptions: {
        external: ["electron"],
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: { include: ["electron"] },
      rollupOptions: {
        external: ["electron"],
        output: {
          format: "cjs",
          entryFileNames: "[name].js",
        },
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
        },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  },
});
