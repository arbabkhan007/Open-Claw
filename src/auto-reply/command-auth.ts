import { expectDefined } from "@openclaw/normalization-core";
/** Command authorization helpers for owner and allowlist checks. */
import {
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
} from "@openclaw/normalization-core/string-coerce";
import { normalizeStringEntries } from "@openclaw/normalization-core/string-normalization";
import {
  getLoadedChannelPluginById,
  listLoadedChannelPlugins,
} from "../channels/plugins/registry-loaded.js";
import type { ChannelPlugin } from "../channels/plugins/types.plugin.js";
import type { ChannelId } from "../channels/plugins/types.public.js";
import { normalizeAnyChannelId } from "../channels/registry.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  INTERNAL_MESSAGE_CHANNEL,
  isInternalMessageChannel,
  normalizeMessageChannel,
} from "../utils/message-channel.js";
import { isNativeCommandTurn, resolveCommandTurnContext } from "./command-turn-context.js";
import { shouldUseFromAsSenderFallback } from "./sender-identity.js";
import type { MsgContext } from "./templating.js";

export type CommandAuthorization = {
  providerId?: ChannelId;
  ownerList: string[];
  senderId?: string;
  senderIsOwner: boolean;
  isAuthorizedSender: boolean;
  from?: string;
  to?: string;
};

type InferredProviderCandidate = {
  providerId: ChannelId;
  hadResolutionError: boolean;
};

type InferredProviderProbe = {
  candidates: InferredProviderCandidate[];
  droppedResolutionError: boolean;
};

type ProviderAllowFromResolution = {
  allowFrom: Array<string | number>;
  allowFromPrepared: PreparedAllowFromList;
  hadResolutionError: boolean;
};

type OwnerAuthorizationState = {
  allowAll: boolean;
  ownerAllowAll: boolean;
  ownerCandidatesForCommands: string[];
  ownerCandidatesForCommandsSet: ReadonlySet<string>;
  explicitOwners: string[];
  ownerList: string[];
  ownerSet: ReadonlySet<string>;
};

function resolveProviderFromContext(
  ctx: MsgContext,
  cfg: OpenClawConfig,
): { providerId: ChannelId | undefined; hadResolutionError: boolean } {
  const explicitMessageChannels = [ctx.Surface, ctx.OriginatingChannel, ctx.Provider]
    .map((value) => normalizeMessageChannel(value))
    .filter((value): value is string => Boolean(value));
  const explicitMessageChannel = explicitMessageChannels.find(
    (value) => value !== INTERNAL_MESSAGE_CHANNEL,
  );
  if (!explicitMessageChannel && explicitMessageChannels.includes(INTERNAL_MESSAGE_CHANNEL)) {
    return { providerId: undefined, hadResolutionError: false };
  }
  const direct =
    normalizeAnyChannelId(explicitMessageChannel ?? undefined) ??
    (explicitMessageChannel as ChannelId | undefined) ??
    normalizeAnyChannelId(ctx.Provider) ??
    normalizeAnyChannelId(ctx.Surface) ??
    normalizeAnyChannelId(ctx.OriginatingChannel);
  if (direct) {
    return { providerId: direct, hadResolutionError: false };
  }
  const candidates = [ctx.From, ctx.To]
    .filter((value): value is string => Boolean(value?.trim()))
    .flatMap((value) => value.split(":").map((part) => part.trim()));
  for (const candidate of candidates) {
    const normalizedCandidateChannel = normalizeMessageChannel(candidate);
    if (normalizedCandidateChannel === INTERNAL_MESSAGE_CHANNEL) {
      return { providerId: undefined, hadResolutionError: false };
    }
    const normalized =
      normalizeAnyChannelId(normalizedCandidateChannel ?? undefined) ??
      (normalizedCandidateChannel as ChannelId | undefined) ??
      normalizeAnyChannelId(candidate);
    if (normalized) {
      return { providerId: normalized, hadResolutionError: false };
    }
  }
  const inferredProviders = probeInferredProviders(ctx, cfg);
  const inferred = inferredProviders.candidates;
  if (inferred.length === 1) {
    return {
      providerId: expectDefined(inferred[0], "inferred entry at 0").providerId,
      hadResolutionError: expectDefined(inferred[0], "inferred entry at 0").hadResolutionError,
    };
  }
  return {
    providerId: undefined,
    hadResolutionError:
      inferredProviders.droppedResolutionError ||
      inferred.some((entry) => entry.hadResolutionError),
  };
}

function probeInferredProviders(ctx: MsgContext, cfg: OpenClawConfig): InferredProviderProbe {
  let droppedResolutionError = false;
  const candidates = listLoadedChannelPlugins()
    .map((plugin) => {
      const resolvedAllowFrom = buildProviderAllowFromResolution({
        plugin: plugin as ChannelPlugin,
        cfg,
        accountId: ctx.AccountId,
      });
      if (resolvedAllowFrom.allowFromPrepared.list.length === 0) {
        if (resolvedAllowFrom.hadResolutionError) {
          droppedResolutionError = true;
        }
        return null;
      }
      return {
        providerId: plugin.id,
        hadResolutionError: resolvedAllowFrom.hadResolutionError,
      };
    })
    .filter((value): value is InferredProviderCandidate => Boolean(value));
  return {
    candidates,
    droppedResolutionError,
  };
}

function formatAllowFromList(params: {
  plugin?: ChannelPlugin;
  cfg: OpenClawConfig;
  accountId?: string | null;
  allowFrom: Array<string | number>;
}): string[] {
  const { plugin, cfg, accountId, allowFrom } = params;
  if (!allowFrom || allowFrom.length === 0) {
    return [];
  }
  if (plugin?.config?.formatAllowFrom) {
    return plugin.config.formatAllowFrom({ cfg, accountId, allowFrom });
  }
  return normalizeStringEntries(allowFrom);
}

function normalizeAllowFromEntry(params: {
  plugin?: ChannelPlugin;
  cfg: OpenClawConfig;
  accountId?: string | null;
  value: string;
}): string[] {
  const normalized = formatAllowFromList({
    plugin: params.plugin,
    cfg: params.cfg,
    accountId: params.accountId,
    allowFrom: [params.value],
  });
  return normalized.filter((entry) => entry.trim().length > 0);
}

function isWildcardAllowFromEntry(entry: string): boolean {
  return entry.trim() === "*";
}

function hasWildcardAllowFrom(list: string[]): boolean {
  return list.some((entry) => isWildcardAllowFromEntry(entry));
}

function stripWildcardAllowFrom(list: string[]): string[] {
  return list.filter((entry) => !isWildcardAllowFromEntry(entry));
}

/**
 * Allow-from lists compiled once per raw config array identity (compare
 * src/config/group-policy.ts). Config arrays are process-stable between config
 * reloads and plugin formatAllowFrom is deterministic for a given
 * (cfg, accountId, allowFrom), so recompiling per inbound message made large
 * ownerAllowFrom configs O(n) on every message (#50289). Lists and sets are
 * shared across messages — treat them as immutable.
 */
type PreparedAllowFromList = {
  list: string[];
  set: ReadonlySet<string>;
  hasWildcard: boolean;
  /** Wildcards dropped and duplicates collapsed once at prepare time. */
  stripped: string[];
  strippedSet: ReadonlySet<string>;
};

type ParsedOwnerAllowFromEntry = { channel?: ChannelId; value: string };

type CompiledAllowFromSource = {
  ownerEntries?: ParsedOwnerAllowFromEntry[];
  // Provider filtering and plugin/account formatting produce different lists
  // from one raw array; keys stay bounded by providers × accounts actually seen.
  prepared: Map<string, PreparedAllowFromList>;
};

const compiledAllowFromSources = new WeakMap<Array<string | number>, CompiledAllowFromSource>();

// Frozen so an accidental downstream mutation of a shared prepared list throws
// instead of silently corrupting every config/message that shares the singleton.
const EMPTY_PREPARED_ALLOW_FROM: PreparedAllowFromList = Object.freeze({
  list: Object.freeze([]) as string[],
  set: new Set<string>(),
  hasWildcard: false,
  stripped: Object.freeze([]) as string[],
  strippedSet: new Set<string>(),
});

function compiledAllowFromSource(raw: Array<string | number>): CompiledAllowFromSource {
  let compiled = compiledAllowFromSources.get(raw);
  if (!compiled) {
    compiled = { prepared: new Map() };
    compiledAllowFromSources.set(raw, compiled);
  }
  return compiled;
}

function preparedScopeKey(
  scope: "owner" | "format",
  params: { providerId?: ChannelId; plugin?: ChannelPlugin; accountId?: string | null },
): string {
  return `${scope}\u0000${params.providerId ?? ""}\u0000${params.plugin?.id ?? ""}\u0000${params.accountId ?? ""}`;
}

function buildPreparedAllowFromList(list: string[]): PreparedAllowFromList {
  if (list.length === 0) {
    return EMPTY_PREPARED_ALLOW_FROM;
  }
  const stripped = Array.from(new Set(stripWildcardAllowFrom(list)));
  return {
    list,
    set: new Set(list),
    hasWildcard: hasWildcardAllowFrom(list),
    stripped,
    strippedSet: new Set(stripped),
  };
}

function prepareFormattedAllowFromList(params: {
  plugin?: ChannelPlugin;
  cfg: OpenClawConfig;
  accountId?: string | null;
  allowFrom: Array<string | number>;
}): PreparedAllowFromList {
  if (params.allowFrom.length === 0) {
    return EMPTY_PREPARED_ALLOW_FROM;
  }
  const compiled = compiledAllowFromSource(params.allowFrom);
  const key = preparedScopeKey("format", params);
  const cached = compiled.prepared.get(key);
  if (cached) {
    return cached;
  }
  const prepared = buildPreparedAllowFromList(formatAllowFromList(params));
  compiled.prepared.set(key, prepared);
  return prepared;
}

function resolveProviderAllowFrom(params: {
  plugin?: ChannelPlugin;
  cfg: OpenClawConfig;
  accountId?: string | null;
}): {
  allowFrom: Array<string | number>;
  hadResolutionError: boolean;
} {
  const { plugin, cfg, accountId } = params;
  const providerId = plugin?.id;
  if (!plugin?.config?.resolveAllowFrom) {
    return {
      allowFrom: resolveFallbackAllowFrom({ cfg, providerId, accountId }),
      hadResolutionError: false,
    };
  }

  try {
    const allowFrom = plugin.config.resolveAllowFrom({ cfg, accountId });
    if (allowFrom == null) {
      return {
        allowFrom: [],
        hadResolutionError: false,
      };
    }
    if (!Array.isArray(allowFrom)) {
      console.warn(
        `[command-auth] resolveAllowFrom returned an invalid allowFrom for provider "${providerId}", falling back to config allowFrom: invalid_result`,
      );
      return {
        allowFrom: resolveFallbackAllowFrom({ cfg, providerId, accountId }),
        hadResolutionError: true,
      };
    }
    return {
      allowFrom,
      hadResolutionError: false,
    };
  } catch (err) {
    console.warn(
      `[command-auth] resolveAllowFrom threw for provider "${providerId}", falling back to config allowFrom: ${describeAllowFromResolutionError(err)}`,
    );
    return {
      allowFrom: resolveFallbackAllowFrom({ cfg, providerId, accountId }),
      hadResolutionError: true,
    };
  }
}

function buildProviderAllowFromResolution(params: {
  plugin?: ChannelPlugin;
  cfg: OpenClawConfig;
  accountId?: string | null;
  providerId?: ChannelId;
  forceFallbackResolutionError?: boolean;
}): ProviderAllowFromResolution {
  const providerId = params.providerId ?? params.plugin?.id;
  const resolvedAllowFrom = params.forceFallbackResolutionError
    ? {
        allowFrom: resolveFallbackAllowFrom({
          cfg: params.cfg,
          providerId,
          accountId: params.accountId,
        }),
        hadResolutionError: true,
      }
    : resolveProviderAllowFrom({
        plugin: params.plugin,
        cfg: params.cfg,
        accountId: params.accountId,
      });
  return {
    ...resolvedAllowFrom,
    allowFromPrepared: prepareFormattedAllowFromList({
      plugin: params.plugin,
      cfg: params.cfg,
      accountId: params.accountId,
      allowFrom: resolvedAllowFrom.allowFrom,
    }),
  };
}

function describeAllowFromResolutionError(err: unknown): string {
  if (err instanceof Error) {
    const name = normalizeOptionalString(err.name) ?? "";
    return name || "Error";
  }
  return "unknown_error";
}

function parseOwnerAllowFromEntries(raw: Array<string | number>): ParsedOwnerAllowFromEntry[] {
  const entries: ParsedOwnerAllowFromEntry[] = [];
  for (const entry of raw) {
    const trimmed = normalizeOptionalString(String(entry ?? "")) ?? "";
    if (!trimmed) {
      continue;
    }
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex > 0) {
      const prefix = trimmed.slice(0, separatorIndex);
      const channel = normalizeAnyChannelId(prefix);
      if (channel) {
        const remainder = trimmed.slice(separatorIndex + 1).trim();
        if (remainder) {
          entries.push({ channel, value: remainder });
        }
        continue;
      }
    }
    entries.push({ value: trimmed });
  }
  return entries;
}

function prepareOwnerAllowFromList(params: {
  plugin?: ChannelPlugin;
  cfg: OpenClawConfig;
  accountId?: string | null;
  providerId?: ChannelId;
  allowFrom?: Array<string | number>;
}): PreparedAllowFromList {
  const raw = params.allowFrom ?? params.cfg.commands?.ownerAllowFrom;
  if (!Array.isArray(raw) || raw.length === 0) {
    return EMPTY_PREPARED_ALLOW_FROM;
  }
  const compiled = compiledAllowFromSource(raw);
  const key = preparedScopeKey("owner", params);
  const cached = compiled.prepared.get(key);
  if (cached) {
    return cached;
  }
  compiled.ownerEntries ??= parseOwnerAllowFromEntries(raw);
  const filtered: string[] = [];
  for (const entry of compiled.ownerEntries) {
    // Channel-prefixed entries require a known matching provider; webchat leaves it unset.
    if (entry.channel && (!params.providerId || entry.channel !== params.providerId)) {
      continue;
    }
    filtered.push(entry.value);
  }
  const prepared = buildPreparedAllowFromList(
    formatAllowFromList({
      plugin: params.plugin,
      cfg: params.cfg,
      accountId: params.accountId,
      allowFrom: filtered,
    }),
  );
  compiled.prepared.set(key, prepared);
  return prepared;
}

/**
 * Resolves the commands.allowFrom list for a given provider.
 * Returns the provider-specific list if defined, otherwise the "*" global list.
 * Returns null if commands.allowFrom is not configured at all (fall back to channel allowFrom).
 */
function resolveCommandsAllowFromList(params: {
  plugin?: ChannelPlugin;
  cfg: OpenClawConfig;
  accountId?: string | null;
  providerId?: ChannelId;
}): PreparedAllowFromList | null {
  const { plugin, cfg, accountId, providerId } = params;
  const commandsAllowFrom = cfg.commands?.allowFrom;
  if (!commandsAllowFrom || typeof commandsAllowFrom !== "object") {
    return null; // Not configured, fall back to channel allowFrom
  }

  // Check provider-specific list first, then fall back to global "*"
  const providerKey = providerId ?? "";
  const providerList = commandsAllowFrom[providerKey];
  const globalList = commandsAllowFrom["*"];

  const rawList = Array.isArray(providerList) ? providerList : globalList;
  if (!Array.isArray(rawList)) {
    return null; // No applicable list found
  }

  return prepareFormattedAllowFromList({
    plugin,
    cfg,
    accountId,
    allowFrom: rawList,
  });
}

function resolveOwnerCandidatesForCommands(params: {
  plugin?: ChannelPlugin;
  cfg: OpenClawConfig;
  accountId?: string | null;
  to?: string;
  allowAll: boolean;
  allowFromPrepared: PreparedAllowFromList;
}): { list: string[]; set: ReadonlySet<string> } {
  if (params.allowAll) {
    return EMPTY_PREPARED_ALLOW_FROM;
  }
  const { stripped, strippedSet } = params.allowFromPrepared;
  if (stripped.length > 0 || !params.to) {
    return { list: stripped, set: strippedSet };
  }
  const normalizedTo = Array.from(
    new Set(
      normalizeAllowFromEntry({
        plugin: params.plugin,
        cfg: params.cfg,
        accountId: params.accountId,
        value: params.to,
      }),
    ),
  );
  return normalizedTo.length > 0
    ? { list: normalizedTo, set: new Set(normalizedTo) }
    : EMPTY_PREPARED_ALLOW_FROM;
}

function resolveOwnerAuthorizationState(params: {
  plugin?: ChannelPlugin;
  cfg: OpenClawConfig;
  accountId?: string | null;
  providerId?: ChannelId;
  to?: string;
  allowFromPrepared: PreparedAllowFromList;
  hadResolutionError: boolean;
  configOwnerAllowFrom?: Array<string | number>;
  contextOwnerAllowFrom?: Array<string | number>;
}): OwnerAuthorizationState {
  const configOwner = prepareOwnerAllowFromList({
    plugin: params.plugin,
    cfg: params.cfg,
    accountId: params.accountId,
    providerId: params.providerId,
    allowFrom: params.configOwnerAllowFrom,
  });
  const contextOwner = prepareOwnerAllowFromList({
    plugin: params.plugin,
    cfg: params.cfg,
    accountId: params.accountId,
    providerId: params.providerId,
    allowFrom: params.contextOwnerAllowFrom,
  });
  const allowAll =
    !params.hadResolutionError &&
    (params.allowFromPrepared.list.length === 0 || params.allowFromPrepared.hasWildcard);
  const ownerCandidatesForCommands = resolveOwnerCandidatesForCommands({
    plugin: params.plugin,
    cfg: params.cfg,
    accountId: params.accountId,
    to: params.to,
    allowAll,
    allowFromPrepared: params.allowFromPrepared,
  });
  const ownerAllowAll = configOwner.hasWildcard;
  const explicitOwners = configOwner.stripped;
  const explicitOverrides = contextOwner.stripped;
  const owners =
    explicitOwners.length > 0
      ? { list: explicitOwners, set: configOwner.strippedSet }
      : ownerAllowAll
        ? EMPTY_PREPARED_ALLOW_FROM
        : explicitOverrides.length > 0
          ? { list: explicitOverrides, set: contextOwner.strippedSet }
          : ownerCandidatesForCommands;
  return {
    allowAll,
    ownerAllowAll,
    ownerCandidatesForCommands: ownerCandidatesForCommands.list,
    ownerCandidatesForCommandsSet: ownerCandidatesForCommands.set,
    explicitOwners,
    ownerList: owners.list,
    ownerSet: owners.set,
  };
}

function resolveCommandSenderAuthorization(params: {
  commandAuthorized: boolean;
  enforceOwnerForCommands: boolean;
  nativeCommandAuthorized: boolean;
  isOwnerForCommands: boolean;
  senderCandidates: string[];
  commandsAllowFrom: PreparedAllowFromList | null;
  providerResolutionError: boolean;
  commandsAllowFromConfigured: boolean;
}): boolean {
  if (params.enforceOwnerForCommands && !params.isOwnerForCommands) {
    return false;
  }
  if (
    params.commandsAllowFrom !== null ||
    (params.providerResolutionError && params.commandsAllowFromConfigured)
  ) {
    const commandsAllowFrom = params.commandsAllowFrom;
    const commandsAllowAll =
      !params.providerResolutionError && Boolean(commandsAllowFrom?.hasWildcard);
    const matchedCommandsAllowFrom = commandsAllowFrom?.list.length
      ? params.senderCandidates.find((candidate) => commandsAllowFrom.set.has(candidate))
      : undefined;
    return (
      !params.providerResolutionError && (commandsAllowAll || Boolean(matchedCommandsAllowFrom))
    );
  }
  return params.commandAuthorized && (params.isOwnerForCommands || params.nativeCommandAuthorized);
}

function resolveSenderCandidates(params: {
  plugin?: ChannelPlugin;
  providerId?: ChannelId;
  cfg: OpenClawConfig;
  accountId?: string | null;
  senderId?: string | null;
  senderE164?: string | null;
  from?: string | null;
  chatType?: string | null;
}): string[] {
  const { plugin, cfg, accountId } = params;
  const candidates: string[] = [];
  const pushCandidate = (value?: string | null) => {
    const trimmed = normalizeOptionalString(value) ?? "";
    if (!trimmed) {
      return;
    }
    candidates.push(trimmed);
  };
  if (plugin?.commands?.preferSenderE164ForCommands) {
    pushCandidate(params.senderE164);
    pushCandidate(params.senderId);
  } else {
    pushCandidate(params.senderId);
    pushCandidate(params.senderE164);
  }
  if (
    candidates.length === 0 &&
    shouldUseFromAsSenderFallback({ from: params.from, chatType: params.chatType })
  ) {
    pushCandidate(params.from);
  }

  const normalized: string[] = [];
  for (const sender of candidates) {
    const entries = normalizeAllowFromEntry({ plugin, cfg, accountId, value: sender });
    for (const entry of entries) {
      if (!normalized.includes(entry)) {
        normalized.push(entry);
      }
    }
  }
  return normalized;
}

function resolveFallbackAllowFrom(params: {
  cfg: OpenClawConfig;
  providerId?: ChannelId;
  accountId?: string | null;
}): Array<string | number> {
  const providerId = normalizeOptionalString(params.providerId);
  if (!providerId) {
    return [];
  }
  const channels = params.cfg.channels as
    | Record<
        string,
        | {
            allowFrom?: Array<string | number>;
            dm?: { allowFrom?: Array<string | number> };
            accounts?: Record<
              string,
              {
                allowFrom?: Array<string | number>;
                dm?: { allowFrom?: Array<string | number> };
              }
            >;
          }
        | undefined
      >
    | undefined;
  const channelCfg = channels?.[providerId];
  const accountCfg =
    resolveFallbackAccountConfig(channelCfg?.accounts, params.accountId) ??
    resolveFallbackDefaultAccountConfig(channelCfg);
  const allowFrom =
    accountCfg?.allowFrom ??
    accountCfg?.dm?.allowFrom ??
    channelCfg?.allowFrom ??
    channelCfg?.dm?.allowFrom;
  return Array.isArray(allowFrom) ? allowFrom : [];
}

function resolveFallbackAccountConfig(
  accounts:
    | Record<
        string,
        | {
            allowFrom?: Array<string | number>;
            dm?: { allowFrom?: Array<string | number> };
          }
        | undefined
      >
    | undefined,
  accountId?: string | null,
) {
  const normalizedAccountId = normalizeOptionalLowercaseString(accountId);
  if (!accounts || !normalizedAccountId) {
    return undefined;
  }
  const direct = accounts[normalizedAccountId];
  if (direct) {
    return direct;
  }
  const matchKey = Object.keys(accounts).find(
    (key) => normalizeOptionalLowercaseString(key) === normalizedAccountId,
  );
  return matchKey ? accounts[matchKey] : undefined;
}

function resolveFallbackDefaultAccountConfig(
  channelCfg:
    | {
        allowFrom?: Array<string | number>;
        dm?: { allowFrom?: Array<string | number> };
        defaultAccount?: string;
        accounts?: Record<
          string,
          | {
              allowFrom?: Array<string | number>;
              dm?: { allowFrom?: Array<string | number> };
            }
          | undefined
        >;
      }
    | undefined,
) {
  const accounts = channelCfg?.accounts;
  if (!accounts) {
    return undefined;
  }
  const preferred =
    resolveFallbackAccountConfig(accounts, channelCfg?.defaultAccount) ??
    resolveFallbackAccountConfig(accounts, "default");
  if (preferred) {
    return preferred;
  }
  const definedAccounts = Object.values(accounts).filter(Boolean);
  return definedAccounts.length === 1 ? definedAccounts[0] : undefined;
}

export function resolveCommandAuthorization(params: {
  ctx: MsgContext;
  cfg: OpenClawConfig;
  commandAuthorized: boolean;
}): CommandAuthorization {
  const { ctx, cfg, commandAuthorized } = params;
  const { providerId, hadResolutionError: providerResolutionError } = resolveProviderFromContext(
    ctx,
    cfg,
  );
  const plugin = providerId
    ? ((getLoadedChannelPluginById(providerId) as ChannelPlugin | undefined) ?? undefined)
    : undefined;
  const from = normalizeOptionalString(ctx.From) ?? "";
  const to = normalizeOptionalString(ctx.To) ?? "";
  const commandsAllowFromConfigured = Boolean(
    cfg.commands?.allowFrom && typeof cfg.commands.allowFrom === "object",
  );

  // Check if commands.allowFrom is configured (separate command authorization)
  const commandsAllowFrom = resolveCommandsAllowFromList({
    plugin,
    cfg,
    accountId: ctx.AccountId,
    providerId,
  });

  const resolvedAllowFrom = buildProviderAllowFromResolution({
    plugin,
    cfg,
    accountId: ctx.AccountId,
    providerId,
    forceFallbackResolutionError: providerResolutionError,
  });
  const ownerState = resolveOwnerAuthorizationState({
    plugin,
    cfg,
    accountId: ctx.AccountId,
    providerId,
    to,
    allowFromPrepared: resolvedAllowFrom.allowFromPrepared,
    hadResolutionError: resolvedAllowFrom.hadResolutionError,
    configOwnerAllowFrom: cfg.commands?.ownerAllowFrom,
    contextOwnerAllowFrom: ctx.OwnerAllowFrom,
  });

  const senderCandidates = resolveSenderCandidates({
    plugin,
    providerId,
    cfg,
    accountId: ctx.AccountId,
    senderId: ctx.SenderId,
    senderE164: ctx.SenderE164,
    from,
    chatType: ctx.ChatType,
  });
  const matchedSender = ownerState.ownerList.length
    ? senderCandidates.find((candidate) => ownerState.ownerSet.has(candidate))
    : undefined;
  const matchedCommandOwner = ownerState.ownerCandidatesForCommands.length
    ? senderCandidates.find((candidate) => ownerState.ownerCandidatesForCommandsSet.has(candidate))
    : undefined;
  const senderId = matchedSender ?? senderCandidates[0];

  const enforceOwner = Boolean(plugin?.commands?.enforceOwnerForCommands);
  const senderIsOwnerByIdentity = Boolean(matchedSender);
  const senderIsOwnerByScope =
    isInternalMessageChannel(ctx.Provider) &&
    Array.isArray(ctx.GatewayClientScopes) &&
    ctx.GatewayClientScopes.includes("operator.admin");
  const ownerAllowlistConfigured = ownerState.ownerAllowAll || ownerState.explicitOwners.length > 0;
  const senderIsOwner = senderIsOwnerByIdentity || senderIsOwnerByScope || ownerState.ownerAllowAll;
  const requireOwner = enforceOwner || ownerAllowlistConfigured;
  const isOwnerForCommands = !requireOwner
    ? true
    : ownerState.ownerAllowAll
      ? true
      : ownerAllowlistConfigured
        ? senderIsOwner
        : senderIsOwnerByScope || Boolean(matchedCommandOwner);
  const nativeCommandAuthorized =
    commandAuthorized && isNativeCommandTurn(resolveCommandTurnContext(ctx)) && !requireOwner;
  const isAuthorizedSender = resolveCommandSenderAuthorization({
    commandAuthorized,
    enforceOwnerForCommands: enforceOwner,
    nativeCommandAuthorized,
    isOwnerForCommands,
    senderCandidates,
    commandsAllowFrom,
    providerResolutionError,
    commandsAllowFromConfigured,
  });

  return {
    providerId,
    ownerList: ownerState.ownerList,
    senderId: senderId || undefined,
    senderIsOwner,
    isAuthorizedSender,
    from: from || undefined,
    to: to || undefined,
  };
}
