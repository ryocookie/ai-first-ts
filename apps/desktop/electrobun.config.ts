import type { ElectrobunConfig } from "electrobun";

const webBuildDir = "../web/dist";

export default {
  app: {
    name: "ai-first-ts",
    identifier: "dev.bettertstack.ai-first-ts.desktop",
    version: "0.0.1",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    mainProcess: "cottontail",
    cottontail: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      [webBuildDir]: "views/mainview",
    },
    watchIgnore: [`${webBuildDir}/**`],
    mac: {
      bundleCEF: true,
      defaultRenderer: "cef",
    },
    linux: {
      bundleCEF: true,
      defaultRenderer: "cef",
    },
    win: {
      bundleCEF: true,
      defaultRenderer: "cef",
    },
  },
} satisfies ElectrobunConfig;
