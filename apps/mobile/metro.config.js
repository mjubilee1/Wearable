const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

const rnFirebaseAuth = path.join(
  workspaceRoot,
  "node_modules/@firebase/auth/dist/rn/index.js",
);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform !== "web" &&
    (moduleName === "firebase/auth" || moduleName === "@firebase/auth")
  ) {
    return { type: "sourceFile", filePath: rnFirebaseAuth };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
