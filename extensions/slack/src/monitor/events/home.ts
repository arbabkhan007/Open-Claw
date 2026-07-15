// Slack plugin module implements home behavior.
import { readFile } from "node:fs/promises";
import type { SlackEventMiddlewareArgs } from "@slack/bolt";
import type { HomeView } from "@slack/types";
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import { danger } from "openclaw/plugin-sdk/runtime-env";
import { mergeSlackAccountConfig } from "../../accounts.js";
import { validateSlackBlocksArray } from "../../blocks-input.js";
import type { SlackMonitorContext } from "../context.js";
import type { SlackAppHomeOpenedEvent } from "../types.js";

const SLACK_APP_HOME_MAX_BLOCKS = 100;

export function buildSlackHomeView(slashCommandName?: string): HomeView {
  const startSessionText = slashCommandName
    ? `Send a DM, mention OpenClaw in a channel, or use \`/${slashCommandName}\` to start a session.`
    : "Send a DM or mention OpenClaw in a channel to start a session.";
  return {
    type: "home",
    callback_id: "openclaw:home",
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "OpenClaw",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: startSessionText,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "This Home tab is safe to show to any workspace member who opens the app.",
          },
        ],
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeSlackHomeView(raw: unknown): HomeView {
  if (!isRecord(raw)) {
    throw new Error("Slack App Home view must be an object");
  }
  if (raw.type !== undefined && raw.type !== "home") {
    throw new Error('Slack App Home view type must be "home"');
  }
  return {
    ...raw,
    type: "home",
    blocks: validateSlackBlocksArray(raw.blocks, { maxBlocks: SLACK_APP_HOME_MAX_BLOCKS }),
  } as HomeView;
}

async function readSlackHomeViewFromPath(viewPath: string): Promise<HomeView> {
  const raw = await readFile(viewPath, "utf-8");
  try {
    return normalizeSlackHomeView(JSON.parse(raw));
  } catch (err) {
    throw new Error(
      `failed to parse Slack App Home view JSON at ${viewPath}: ${formatErrorMessage(err)}`,
    );
  }
}

async function resolveSlackHomeView(
  ctx: SlackMonitorContext,
  slashCommandName?: string,
): Promise<HomeView> {
  const appHome = mergeSlackAccountConfig(ctx.cfg, ctx.accountId).appHome;
  if (!appHome) {
    return buildSlackHomeView(slashCommandName);
  }
  try {
    if (typeof appHome.viewPath === "string" && appHome.viewPath.trim()) {
      return await readSlackHomeViewFromPath(appHome.viewPath);
    }
    if (appHome.view !== undefined) {
      return normalizeSlackHomeView(appHome.view);
    }
  } catch (err) {
    ctx.runtime.error?.(danger(`slack app home view config failed: ${formatErrorMessage(err)}`));
  }
  return buildSlackHomeView(slashCommandName);
}

export function registerSlackHomeEvents(params: {
  ctx: SlackMonitorContext;
  slashCommandName?: string;
  trackEvent?: () => void;
}) {
  const { ctx, slashCommandName, trackEvent } = params;

  ctx.app.event(
    "app_home_opened",
    async ({ event, body }: SlackEventMiddlewareArgs<"app_home_opened">) => {
      try {
        if (ctx.shouldDropMismatchedSlackEvent(body)) {
          return;
        }
        trackEvent?.();

        const payload = event as SlackAppHomeOpenedEvent;
        if (!payload.user || payload.tab === "messages") {
          return;
        }

        await ctx.app.client.views.publish({
          token: ctx.botToken,
          user_id: payload.user,
          view: await resolveSlackHomeView(ctx, slashCommandName),
        });
      } catch (err) {
        ctx.runtime.error?.(danger(`slack app home handler failed: ${formatErrorMessage(err)}`));
      }
    },
  );
}
