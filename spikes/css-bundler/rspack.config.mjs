import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  context: path.join(here, "fixture"),
  mode: "production",
  entry: {
    main: "./src/main.js",
  },
  output: {
    path: path.join(here, ".output", "rspack"),
    clean: true,
    publicPath: "/",
    filename: "assets/[name]-[contenthash].js",
    chunkFilename: "assets/[name]-[contenthash].js",
    assetModuleFilename: "assets/[name]-[contenthash][ext]",
  },
  devtool: "source-map",
  module: {
    rules: [
      {
        test: /\.css$/i,
        type: "css/auto",
      },
    ],
  },
  stats: {
    all: false,
    assets: true,
    entrypoints: true,
    namedChunkGroups: true,
    chunks: true,
    modules: true,
    errors: true,
    warnings: true,
  },
};
