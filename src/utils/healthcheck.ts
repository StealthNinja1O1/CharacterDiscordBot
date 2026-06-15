/**
  * Healthcheck server and bot status tracking.
 */

import type { DiscordBot } from "../classes/DiscordBot.js";

export interface BotStatus {
  ready: boolean;
  startedAt: number;
  lastLlmCall: number | null;
  bot: DiscordBot | null;
}

const status: BotStatus = {
  ready: false,
  startedAt: Date.now(),
  lastLlmCall: null,
  bot: null,
};

export const botStatus: BotStatus = status;

export function setBotReady(bot: DiscordBot) {
  status.bot = bot;
  status.ready = true;
}

export function recordLlmCall() {
  status.lastLlmCall = Date.now();
}

export function startHealthcheckServer(port: number): (() => void) | null {
  if (typeof Bun === "undefined") {
    console.warn("[health] Bun runtime not detected, healthcheck server disabled");
    return null;
  }

  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/healthz" || url.pathname === "/health") {
        const uptimeMs = Date.now() - status.startedAt;
        const lastLlmCallAgo =
          status.lastLlmCall !== null ? Date.now() - status.lastLlmCall : null;

        // Gather per-channel queue depths from the bot if available
        let queueDepth: Record<string, number> = {};
        if (status.bot) {
          try {
            queueDepth = status.bot.getQueueDepths();
          } catch {
          }
        }

        const body = {
          ready: status.ready,
          uptime: uptimeMs,
          lastLlmCall: status.lastLlmCall,
          lastLlmCallAgoMs: lastLlmCallAgo,
          queueDepth,
        };

        return new Response(JSON.stringify(body, null, 2), {
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Not found. Try /healthz\n", { status: 404 });
    },
  });

  console.log(`[health] Healthcheck server listening on http://localhost:${server.port}/healthz`);

  return () => {
    server.stop();
    console.log("[health] Healthcheck server stopped");
  };
}
