import type { GatewayBrowserClient } from "../../api/gateway.ts";
import type { ApplicationContext, ApplicationGatewaySnapshot } from "../../app/context.ts";
import type { ChatPageHost } from "./chat-state.ts";

export type ChatPaneConnectionScope = {
  context: ApplicationContext;
  state: ChatPageHost;
  client: GatewayBrowserClient;
  generation: number;
  sessions: ApplicationContext["sessions"];
  auth: NonNullable<ApplicationGatewaySnapshot["hello"]>["auth"] | undefined;
};
