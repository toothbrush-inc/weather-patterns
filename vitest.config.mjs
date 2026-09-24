import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `@/...` is the tsconfig path alias the app/ components import lib modules through;
  // Vite needs it spelled out before those components can be rendered in a test.
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["mcp/**/*.test.mjs", "lib/**/*.test.mjs", "app/**/*.test.mjs"],
  },
});
