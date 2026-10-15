import { appRouter } from "@ai-first-ts/api/routers/index";
import { devToolsMiddleware } from "@ai-sdk/devtools";
import { google } from "@ai-sdk/google";
import { trpcServer } from "@hono/trpc-server";
import {
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  convertToModelMessages,
  wrapLanguageModel,
} from "ai";
import { initLogger } from "evlog";
import { createAILogger, createEvlogIntegration } from "evlog/ai";
import { createAuthMiddleware, type BetterAuthInstance } from "evlog/better-auth";
import { createFsDrain } from "evlog/fs";
import { evlog, type EvlogVariables } from "evlog/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { createContext } from "./context";
import { desktopOrigins, ENV } from "./env.server";
import { auth } from "./services";

initLogger({
  env: { service: "ai-first-ts-server" },
});

const identifyUser = createAuthMiddleware(auth as BetterAuthInstance, {
  exclude: ["/api/auth/**"],
  maskEmail: true,
});

const app = new Hono<EvlogVariables>();

app.use(evlog({ drain: process.env.NODE_ENV === "production" ? undefined : createFsDrain() }));
app.use("*", async (c, next) => {
  await identifyUser(c.get("log"), c.req.raw.headers, c.req.path);
  await next();
});

app.use(
  "/*",
  cors({
    origin: [ENV.CORS_ORIGIN, ...desktopOrigins],
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", async (c) => auth.handler(c.req.raw));

app.use(
  "/trpc/*",
  trpcServer({
    endpoint: "/trpc",
    router: appRouter,
    createContext: (_opts, context) => {
      return createContext({ context });
    },
  }),
);

app.post("/ai", async (c) => {
  const body = await c.req.json();
  const uiMessages = body.messages || [];
  const ai = createAILogger(c.get("log"));
  const model = wrapLanguageModel({
    model: google("gemini-2.5-flash"),
    middleware: devToolsMiddleware(),
  });
  const result = streamText({
    model: ai.wrap(model),
    messages: await convertToModelMessages(uiMessages),
    telemetry: {
      isEnabled: true,
      integrations: [createEvlogIntegration(ai)],
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
});

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
