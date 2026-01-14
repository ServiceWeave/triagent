import solidPlugin from "@opentui/solid/bun-plugin";

await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "bun",
  plugins: [solidPlugin],
});

console.log("Build complete");
