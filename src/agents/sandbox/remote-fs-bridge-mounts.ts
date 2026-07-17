import path from "node:path";
import {
  isExistingWorkspaceSkillMountSource,
  resolveMaterializedSandboxSkillsWorkspaceDir,
} from "./workspace-mounts.js";

export type RemoteMountSource = "workspace" | "agent" | "protectedSkill";

export type MountInfo = {
  localRoot: string;
  containerRoot: string;
  writable: boolean;
  source: RemoteMountSource;
};

export function buildRemoteProtectedSkillMounts(params: {
  localRoot: string;
  skillsWorkspaceDir?: string;
  workspaceContainerRoot: string;
  agentContainerRoot: string;
  includeAgentMount: boolean;
}): MountInfo[] {
  const materializedSkillsWorkspaceDir = path.resolve(
    params.skillsWorkspaceDir ?? resolveMaterializedSandboxSkillsWorkspaceDir(params.localRoot),
  );
  const mounts: Array<MountInfo & { allowedRoot: string }> = [
    createProtectedMount(params.localRoot, params.workspaceContainerRoot, "skills"),
    createProtectedMount(params.localRoot, params.workspaceContainerRoot, ".agents/skills"),
    createProtectedMount(
      materializedSkillsWorkspaceDir,
      params.workspaceContainerRoot,
      "skills",
      ".openclaw/sandbox-skills/skills",
    ),
  ];
  if (params.includeAgentMount) {
    mounts.push(
      createProtectedMount(params.localRoot, params.agentContainerRoot, "skills"),
      createProtectedMount(params.localRoot, params.agentContainerRoot, ".agents/skills"),
      createProtectedMount(
        materializedSkillsWorkspaceDir,
        params.agentContainerRoot,
        "skills",
        ".openclaw/sandbox-skills/skills",
      ),
    );
  }
  return mounts
    .filter((mount) =>
      isExistingWorkspaceSkillMountSource({
        rootDir: mount.allowedRoot,
        hostPath: mount.localRoot,
      }),
    )
    .map(({ allowedRoot: _allowedRoot, ...mount }) => mount);
}

export function compareRemoteMountsByContainerPath(a: MountInfo, b: MountInfo): number {
  return b.containerRoot.length - a.containerRoot.length || mountPriority(b) - mountPriority(a);
}

export function compareRemoteMountsByLocalPath(a: MountInfo, b: MountInfo): number {
  return b.localRoot.length - a.localRoot.length || mountPriority(b) - mountPriority(a);
}

function createProtectedMount(
  allowedRoot: string,
  containerRoot: string,
  localSuffix: string,
  containerSuffix = localSuffix,
): MountInfo & { allowedRoot: string } {
  return {
    localRoot: path.join(allowedRoot, ...localSuffix.split("/")),
    containerRoot: path.posix.join(containerRoot, containerSuffix),
    writable: false,
    source: "protectedSkill",
    allowedRoot,
  };
}

function mountPriority(mount: MountInfo): number {
  if (mount.source === "protectedSkill") {
    return 2;
  }
  if (mount.source === "agent") {
    return 1;
  }
  return 0;
}
