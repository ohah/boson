import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  context: path.join(here, "fixture"),
  mode: "production",
  resolve: {
    alias: {
      "@theme": path.join(here, "fixture/src/alias"),
    },
  },
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
  optimization: {
    splitChunks: {
      chunks: "all",
      cacheGroups: {
        sharedRuntime: {
          test: /[\\/]src[\\/]shared[\\/]runtime\.js$/,
          name: "shared-runtime",
          chunks: "all",
          enforce: true,
        },
      },
    },
  },
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
    chunkModules: true,
    modules: true,
    reasons: true,
    moduleAssets: true,
    providedExports: true,
    source: true,
    errors: true,
    warnings: true,
  },
};
