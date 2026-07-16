export function isPrivateQaPluginSdkBuild(env: NodeJS.ProcessEnv): boolean;
export function evaluatePluginSdkDeclarationBudget(input: {
  declarationBytes: number;
  buildPrivateQa: boolean;
}): {
  budgetBytes: number;
  budgetKind: "private-qa-public-entry" | "public";
  shouldFail: boolean;
};
// Budget constants are exported for tests that assert both public and
// private-QA builds stay within intentionally reviewed caps.
export const MAX_PUBLIC_PLUGIN_SDK_DECLARATION_BYTES: 5200000;
export const MAX_PRIVATE_QA_PUBLIC_PLUGIN_SDK_DECLARATION_BYTES: 5225000;
