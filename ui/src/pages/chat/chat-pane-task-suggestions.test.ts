/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  TaskSuggestion,
  TaskSuggestionEvent,
  TaskSuggestionsAcceptResult,
  TaskSuggestionsListResult,
} from "../../../../packages/gateway-protocol/src/index.js";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import type { ApplicationContext } from "../../app/context.ts";
import type { SessionCapability } from "../../lib/sessions/index.ts";
import "./chat-pane.ts";
import type { ChatPageHost } from "./chat-state.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

type TestChatPane = HTMLElement & {
  context: ApplicationContext;
  state: ChatPageHost;
  connectedClient: GatewayBrowserClient | null;
  connectionGeneration: number;
  acceptTaskSuggestion: (suggestion: TaskSuggestion) => Promise<void>;
  handleTaskSuggestionEvent: (event: TaskSuggestionEvent) => void;
  refreshTaskSuggestions: () => Promise<void>;
  taskSuggestions: TaskSuggestion[];
  onPaneSessionChange?: (paneId: string, sessionKey: string) => void;
};

const suggestion: TaskSuggestion = {
  id: "task_123",
  title: "Remove stale adapter",
  prompt: "Delete the stale adapter and update tests.",
  tldr: "The adapter is unreachable and adds maintenance cost.",
  cwd: "/repo",
  sessionKey: "agent:main:current",
  agentId: "main",
  createdAt: 1,
};

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function createTestChatPane(client: GatewayBrowserClient, sessions: SessionCapability) {
  const pane = document.createElement("openclaw-chat-pane") as unknown as TestChatPane;
  Object.defineProperty(pane, "isConnected", { configurable: true, value: true });
  pane.context = {
    gateway: {
      snapshot: {
        client,
        connected: true,
        hello: { features: { methods: ["taskSuggestions.list"] } },
      },
    },
    agents: { state: { agentsList: null } },
    sessions,
  } as unknown as ApplicationContext;
  pane.state = {
    client,
    connected: true,
    connectionEpoch: 4,
    requestUpdate: vi.fn(),
    sessionKey: "agent:main:current",
    sessions,
  } as unknown as ChatPageHost;
  pane.connectedClient = client;
  pane.connectionGeneration = 4;
  return pane;
}

describe("chat pane task suggestion lifecycle", () => {
  it("keeps accept ownership when the resolved event arrives before the response", async () => {
    const accepted = createDeferred<TaskSuggestionsAcceptResult>();
    const client = {
      request: vi.fn((method: string) =>
        method === "taskSuggestions.accept"
          ? accepted.promise
          : Promise.resolve({ suggestions: [] } satisfies TaskSuggestionsListResult),
      ),
    } as unknown as GatewayBrowserClient;
    const pane = createTestChatPane(client, {} as SessionCapability);
    const navigate = vi.fn();
    pane.onPaneSessionChange = navigate;

    const pending = pane.acceptTaskSuggestion(suggestion);
    pane.handleTaskSuggestionEvent({
      action: "resolved",
      taskId: suggestion.id,
      resolution: "accepted",
    });
    accepted.resolve({ taskId: suggestion.id, key: "agent:main:task" });

    await pending;
    expect(navigate).toHaveBeenCalledWith("single", "agent:main:task");
  });

  it("drops an accept response after a same-client reconnect", async () => {
    const accepted = createDeferred<TaskSuggestionsAcceptResult>();
    const client = {
      request: vi.fn(() => accepted.promise),
    } as unknown as GatewayBrowserClient;
    const pane = createTestChatPane(client, {} as SessionCapability);
    const navigate = vi.fn();
    pane.onPaneSessionChange = navigate;

    const pending = pane.acceptTaskSuggestion(suggestion);
    pane.connectionGeneration += 1;
    accepted.resolve({ taskId: suggestion.id, key: "agent:main:stale" });

    await pending;
    expect(navigate).not.toHaveBeenCalled();
  });

  it("drops a list response after a same-client reconnect", async () => {
    const listed = createDeferred<TaskSuggestionsListResult>();
    const client = {
      request: vi.fn(() => listed.promise),
    } as unknown as GatewayBrowserClient;
    const pane = createTestChatPane(client, {} as SessionCapability);

    const pending = pane.refreshTaskSuggestions();
    pane.connectionGeneration += 1;
    listed.resolve({ suggestions: [suggestion] });

    await pending;
    expect(pane.taskSuggestions).toEqual([]);
  });
});
