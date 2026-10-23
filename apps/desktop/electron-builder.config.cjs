const fs = require("node:fs");
const path = require("node:path");

const backendDirectory = path.resolve(__dirname, "../backend/dist/quizpilot-backend");
if (!fs.existsSync(backendDirectory)) {
  throw new Error(
    "Bundled backend is missing. Run scripts/build-backend (or scripts/build-backend.ps1) before packaging."
  );
}

module.exports = {
  appId: "ai.quizpilot.desktop",
  productName: "QuizPilot AI",
  copyright: "QuizPilot AI contributors",
  asar: true,
  npmRebuild: false,
  directories: { output: "release" },
  files: [".build/**/*", "renderer/dist/**/*", "package.json"],
  extraResources: [
    { from: "../fixtures", to: "fixtures" },
    { from: backendDirectory, to: "backend" },
  ],
  artifactName: "${productName}-${version}-${os}-${arch}.${ext}",
  linux: {
    target: ["AppImage"],
    category: "Development",
    executableName: "quizpilot-ai",
    description: "Authorized quiz QA automation desktop application",
  },
  win: { target: ["nsis"] },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
  },
  mac: { target: ["dmg", "zip"], category: "public.app-category.developer-tools" },
};
