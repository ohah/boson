import path from "node:path";
import rspack from "@rspack/core";

export const RSPACK_GRAPH_PROFILE_NAMES = Object.freeze({
  runtime: "default-runtime",
  module: "output-module",
  modernModule: "modern-module-preserve-modules",
});

export function createRspackGraphConfig({ profile, outputDir, fixtureRoot, graphPlugin, virtualModules = {} }) {
  const profileName = typeof profile === "string" ? profile : profile?.name;
  if (!Object.values(RSPACK_GRAPH_PROFILE_NAMES).includes(profileName)) {
    throw new Error(`지원하지 않는 Rspack 출력 profile입니다: ${profileName}`);
  }
  if (typeof outputDir !== "string" || typeof fixtureRoot !== "string") {
    throw new Error("outputDir와 fixtureRoot 경로가 필요합니다.");
  }

  const output = {
    path: outputDir,
    clean: false,
    publicPath: "./",
    filename: "assets/[name]-[contenthash].js",
    chunkFilename: "assets/[name]-[contenthash].js",
    assetModuleFilename: "assets/[name]-[contenthash][ext]",
  };
  const experiments = {};
  const hasVirtualModules = Object.keys(virtualModules).length > 0;

  if (profileName === RSPACK_GRAPH_PROFILE_NAMES.module) {
    experiments.outputModule = true;
    Object.assign(output, {
      module: true,
      chunkFormat: "module",
      chunkLoading: "import",
      iife: false,
    });
  }

  if (profileName === RSPACK_GRAPH_PROFILE_NAMES.modernModule) {
    Object.assign(output, {
      filename: "[name].js",
      chunkFilename: "[name].js",
      library: {
        type: "modern-module",
        preserveModules: path.join(fixtureRoot, "src"),
      },
    });
  }

  const config = {
    context: fixtureRoot,
    mode: "production",
    target: ["web", "es2022"],
    entry: { main: "./src/main.js" },
    resolve: {
      alias: {
        "@graph": path.join(fixtureRoot, "src"),
      },
      aliasFields: ["browser"],
      conditionNames: ["webpack", "production", "browser"],
      exportsFields: ["exports"],
      extensions: [],
      importsFields: ["imports"],
      mainFiles: ["index"],
      mainFields: ["browser", "module", "..."],
      modules: ["node_modules"],
      byDependency: {
        esm: {
          aliasFields: ["browser"],
          conditionNames: ["import", "module", "..."],
          extensions: [".js", ".json"],
          mainFields: ["browser", "module", "..."],
        },
        "css-import": cssResolverOptions(),
        "css-import-local-module": cssResolverOptions(),
        "css-import-global-module": cssResolverOptions(),
      },
    },
    externals: [],
    externalsPresets: { web: true },
    output,
    experiments,
    devtool: false,
    optimization: {
      runtimeChunk: false,
      splitChunks: false,
    },
    module: {
      rules: [{ test: /\.css$/i, type: "css/auto" }],
    },
    plugins: [
      ...(hasVirtualModules ? [new rspack.experiments.VirtualModulesPlugin(virtualModules)] : []),
      graphPlugin,
    ],
    stats: {
      all: false,
      assets: true,
      entrypoints: true,
      chunks: true,
      ids: true,
      chunkModules: true,
      modules: true,
      reasons: true,
      errors: true,
      warnings: true,
    },
  };

  return {
    config,
    profile: {
      name: profileName,
      context: "fixtureRoot",
      mode: "production",
      target: ["web", "es2022"],
      entry: { main: "src/main.js" },
      resolve: {
        alias: { "@graph": "src" },
        aliasFields: ["browser"],
        conditionNames: ["webpack", "production", "browser"],
        exportsFields: ["exports"],
        extensions: [],
        importsFields: ["imports"],
        mainFiles: ["index"],
        mainFields: ["browser", "module", "..."],
        modules: ["node_modules"],
        byDependency: {
          esm: {
            aliasFields: ["browser"],
            conditionNames: ["import", "module", "..."],
            extensions: [".js", ".json"],
            mainFields: ["browser", "module", "..."],
          },
          "css-import": cssResolverFingerprint(),
          "css-import-local-module": cssResolverFingerprint(),
          "css-import-global-module": cssResolverFingerprint(),
        },
      },
      externals: [],
      externalsPresets: { web: true },
      output: profileOutputFingerprint(profileName),
      experiments: { outputModule: profileName === RSPACK_GRAPH_PROFILE_NAMES.module },
      optimization: { runtimeChunk: false, splitChunks: false },
      module: { rules: [{ test: "\\.css$", type: "css/auto" }] },
      plugins: [
        ...(hasVirtualModules ? ["RspackVirtualModulesPlugin:fixture-manifest"] : []),
        "SpinonRspackModuleGraphAdapter:capture-only",
      ],
      devtool: false,
      stats: {
        all: false,
        assets: true,
        entrypoints: true,
        chunks: true,
        ids: true,
        chunkModules: true,
        modules: true,
        reasons: true,
        errors: true,
        warnings: true,
      },
    },
  };
}

function profileOutputFingerprint(profileName) {
  const common = {
    clean: false,
    publicPath: "./",
    filename: "assets/[name]-[contenthash].js",
    chunkFilename: "assets/[name]-[contenthash].js",
    assetModuleFilename: "assets/[name]-[contenthash][ext]",
    module: false,
    chunkFormat: null,
    chunkLoading: null,
    iife: null,
    libraryType: null,
    preserveModulesRoot: null,
  };

  if (profileName === RSPACK_GRAPH_PROFILE_NAMES.module) {
    return {
      ...common,
      module: true,
      chunkFormat: "module",
      chunkLoading: "import",
      iife: false,
    };
  }

  if (profileName === RSPACK_GRAPH_PROFILE_NAMES.modernModule) {
    return {
      ...common,
      libraryType: "modern-module",
      preserveModulesRoot: "src",
      filename: "[name].js",
      chunkFilename: "[name].js",
    };
  }

  return common;
}

function cssResolverOptions() {
  return {
    mainFiles: [],
    mainFields: ["style", "..."],
    conditionNames: ["production", "style"],
    extensions: [".css"],
    preferRelative: true,
  };
}

function cssResolverFingerprint() {
  return {
    mainFiles: [],
    mainFields: ["style", "..."],
    conditionNames: ["production", "style"],
    extensions: [".css"],
    preferRelative: true,
  };
}
