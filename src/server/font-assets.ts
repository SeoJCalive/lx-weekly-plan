import type { BunPlugin } from "bun";

export default {
  name: "local-font-subsets",
  setup(build) {
    build.onResolve({ filter: /^\.\/woff2-dynamic-subset\// }, ({ path }) => ({
      path: path.replace("./woff2-dynamic-subset/", "/fonts/"),
      external: true,
    }));
  },
} satisfies BunPlugin;
