import path from "node:path";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

// React's `cache()` only memoizes in the `react-server` build. Tests that need
// the real thing (a genuine Flight render of async Server Components) are named
// `*.react-server.test.tsx?` and run in their own project with that resolve
// condition, for both Vite-resolved sources and Node-resolved externals.
const REACT_SERVER_TESTS = "src/**/*.react-server.test.{ts,tsx}";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "default",
          environment: "jsdom",
          setupFiles: ["./src/test/setup.ts"],
          exclude: [...configDefaults.exclude, REACT_SERVER_TESTS],
        },
      },
      {
        extends: true,
        resolve: { conditions: ["react-server"] },
        ssr: { resolve: { conditions: ["react-server", "node"], externalConditions: ["react-server", "node"] } },
        test: {
          name: "react-server",
          environment: "node",
          include: [REACT_SERVER_TESTS],
          pool: "forks",
          execArgv: ["--conditions=react-server"],
        },
      },
    ],
  },
});
