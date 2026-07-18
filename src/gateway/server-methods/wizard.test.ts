import { expectDefined } from "@openclaw/normalization-core";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../../runtime.js";
import type { WizardPrompter } from "../../wizard/prompts.js";
import { createWizardSessionTracker } from "../server-wizard-sessions.js";
import { wizardHandlers } from "./wizard.js";

type WizardFlow = "setup" | "channels";

type WizardResult = {
  sessionId: string;
  done: boolean;
  status: "running" | "done" | "cancelled" | "error";
  step?: { id: string };
  error?: string;
};

function responsePayload(respond: ReturnType<typeof vi.fn>): WizardResult {
  expect(respond).toHaveBeenCalledOnce();
  const [ok, payload, error] = respond.mock.calls[0] ?? [];
  expect(ok).toBe(true);
  expect(error).toBeUndefined();
  return payload as WizardResult;
}

async function runWizardExit(flow: WizardFlow, exitCode: number): Promise<WizardResult> {
  const tracker = createWizardSessionTracker();
  const runner = async (runtime: RuntimeEnv, prompter: WizardPrompter) => {
    await prompter.outro(exitCode === 0 ? "complete" : "invalid configuration");
    runtime.exit(exitCode);
  };
  const context = {
    ...tracker,
    wizardRunner: async (_opts: unknown, runtime: RuntimeEnv, prompter: WizardPrompter) =>
      runner(runtime, prompter),
    channelWizardRunner: async (_opts: unknown, runtime: RuntimeEnv, prompter: WizardPrompter) =>
      runner(runtime, prompter),
  };
  const startRespond = vi.fn();
  await expectDefined(
    wizardHandlers["wizard.start"],
    "wizard.start test invariant",
  )({
    params: flow === "channels" ? { flow } : { mode: "local" },
    respond: startRespond,
    context,
  } as never);
  const start = responsePayload(startRespond);
  expect(start).toMatchObject({ done: false, status: "running" });
  expect(start.step?.id).toBeTruthy();

  const nextRespond = vi.fn();
  await expectDefined(
    wizardHandlers["wizard.next"],
    "wizard.next test invariant",
  )({
    params: {
      sessionId: start.sessionId,
      answer: { stepId: start.step?.id, value: null },
    },
    respond: nextRespond,
    context,
  } as never);
  return responsePayload(nextRespond);
}

describe("wizard gateway runtime", () => {
  it.each<WizardFlow>(["setup", "channels"])(
    "keeps the gateway alive when the %s wizard exits successfully",
    async (flow) => {
      await expect(runWizardExit(flow, 0)).resolves.toMatchObject({
        done: true,
        status: "done",
        error: undefined,
      });
    },
  );

  it.each<WizardFlow>(["setup", "channels"])(
    "reports a non-zero %s wizard exit as a session error",
    async (flow) => {
      const result = await runWizardExit(flow, 1);
      expect(result).toMatchObject({ done: true, status: "error" });
      expect(result.error).toContain("exit 1");
    },
  );
});
