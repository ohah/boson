import path from "node:path";
import rspack from "@rspack/core";

export const RSPACK_GRAPH_PROFILE_NAMES = Object.freeze({
  runtime: "default-runtime",
  module: "output-module",
  modernModule: "modern-module-preserve-modules",
});

export function createRspackGraphConfig({
  profile,
  outputDir,
  fixtureRoot,
  graphPlugin,
  virtualModules = {},
  entry = { main: "src/main.js" },
  preserveModulesRoot = "src",
  additionalPlugins = [],
  additionalPluginNames = [],
  additionalModuleRules = [],
}) {
  const profileName = typeof profile === "string" ? profile : profile?.name;
  if (!Object.values(RSPACK_GRAPH_PROFILE_NAMES).includes(profileName)) {
    throw new Error(`지원하지 않는 Rspack 출력 profile입니다: ${profileName}`);
  }
  if (typeof outputDir !== "string" || typeof fixtureRoot !== "string") {
    throw new Error("outputDir와 fixtureRoot 경로가 필요합니다.");
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.keys(entry).length === 0) {
    throw new Error("entry에는 하나 이상의 이름 있는 경로가 필요합니다.");
  }
  if (typeof preserveModulesRoot !== "string" || path.isAbsolute(preserveModulesRoot) || preserveModulesRoot.split(/[\\/]/).includes("..")) {
    throw new Error("preserveModulesRoot는 fixture 내부 상대 경로여야 합니다.");
  }
  if (!Array.isArray(additionalPlugins) || !Array.isArray(additionalPluginNames)
    || additionalPlugins.length !== additionalPluginNames.length
    || additionalPlugins.some((plugin) => !plugin || typeof plugin.apply !== "function")
    || additionalPluginNames.some((name) => typeof name !== "string" || name.length === 0)) {
    throw new Error("추가 plugin 구현과 profile 이름 배열이 일치해야 합니다.");
  }
  if (!Array.isArray(additionalModuleRules) || additionalModuleRules.some((rule) =>
    !rule || !(rule.test instanceof RegExp) || rule.type !== "asset/resource")) {
    throw new Error("추가 module rule은 명시적인 asset/resource 규칙이어야 합니다.");
  }

  const normalizedEntry = Object.fromEntries(Object.entries(entry).map(([name, source]) => {
    if (typeof source !== "string" || source.length === 0 || path.isAbsolute(source) || source.split(/[\\/]/).includes("..")) {
      throw new Error(`entry 경로가 fixture 내부 상대 경로가 아닙니다: ${source}`);
    }
    const sourceKey = source.replace(/^\.\//, "").replaceAll("\\", "/");
    return [name, `./${sourceKey}`];
  }));
  const profileEntry = Object.fromEntries(Object.entries(normalizedEntry).map(([name, source]) => [name, source.slice(2)]));

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
        preserveModules: path.join(fixtureRoot, preserveModulesRoot),
      },
    });
  }

  const config = {
    context: fixtureRoot,
    mode: "production",
    target: ["web", "es2022"],
    entry: normalizedEntry,
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
      rules: [{ test: /\.css$/i, type: "css/auto" }, ...additionalModuleRules],
    },
    plugins: [
      ...(hasVirtualModules ? [new rspack.experiments.VirtualModulesPlugin(virtualModules)] : []),
      graphPlugin,
      ...additionalPlugins,
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
      entry: profileEntry,
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
      output: profileOutputFingerprint(profileName, preserveModulesRoot.replaceAll("\\", "/").replace(/^\.\//, "")),
      experiments: { outputModule: profileName === RSPACK_GRAPH_PROFILE_NAMES.module },
      optimization: { runtimeChunk: false, splitChunks: false },
      module: {
        rules: [
          { test: "\\.css$", type: "css/auto" },
          ...additionalModuleRules.map((rule) => ({ test: String(rule.test), type: rule.type })),
        ],
      },
      plugins: [
        ...(hasVirtualModules ? ["RspackVirtualModulesPlugin:fixture-manifest"] : []),
        "SpinonRspackModuleGraphAdapter:capture-only",
        ...additionalPluginNames,
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

function profileOutputFingerprint(profileName, preserveModulesRoot = "src") {
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
      preserveModulesRoot,
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
