import path from "node:path";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

// React's `cache()` only memoizes in the `react-server` build. Tests that need
// the real thing (a genuine Flight render of async Server Components) are named
// `*.react-server.test.tsx?` and run in their own project with that resolve
// condition, for both Vite-resolved sources and Node-resolved externals.
const REACT_SERVER_TESTS = "src/**/*.react-server.test.{ts,tsx}";
// Only component and hook tests need a DOM. Everything else (db, sync, coach,
// auth, routes) runs in plain Node: building a jsdom window per file was most
// of the suite's wall time, and server code is more faithfully exercised
// without a global `window`. A new non-component test that needs the DOM can
// opt in with a `// @vitest-environment jsdom` docblock.
const DOM_TESTS = ["**/*.test.tsx", "src/components/**/*.test.ts"];

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
          include: DOM_TESTS,
          exclude: [...configDefaults.exclude, REACT_SERVER_TESTS],
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          exclude: [...configDefaults.exclude, REACT_SERVER_TESTS, ...DOM_TESTS],
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
