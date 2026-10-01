import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  root: path.join(here, "fixture"),
  base: "/",
  configFile: false,
  logLevel: "error",
  build: {
    outDir: path.join(here, ".output", "vite"),
    emptyOutDir: true,
    manifest: true,
    sourcemap: true,
    assetsInlineLimit: 0,
    cssCodeSplit: true,
    rollupOptions: {
      input: path.join(here, "fixture", "index.html"),
    },
  },
};
