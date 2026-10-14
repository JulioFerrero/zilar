// The host-side desk pieces a runner reuses in process (plan §2, §6.1): the
// same jail lifecycle, Docker layer and workspace the cloud sidecar drives.
// Everything here is effect-plain and has no Effect runtime of its own.
export {
  Admission,
  readCgroupMemory,
  type AdmissionOptions,
  type AdmissionResult,
  type PoolMemory,
  type PoolReader,
} from './admission';
export {
  DEFAULT_CGROUP_PARENT,
  DEFAULT_IDLE_MS,
  DEFAULT_MAX_RUNNING,
  DEFAULT_SOCKET_PATH,
  DEFAULT_WORKSPACE_ROOT,
  MEMORY_RATIO_LIMIT,
  loadAgentConfig,
  type AgentConfig,
  type DockerSettings,
  type EgressSettings,
} from './config';
export {
  DESK_LABEL,
  bridgeDaemon,
  createArgs,
  createDockerLayer,
  type DockerLayer,
} from './docker';
export { Lifecycle, type DeskStatus, type LifecycleDeps, type ProvisionResult } from './lifecycle';
export {
  assertSafeId,
  createWorkspaces,
  deskDirectory,
  deskName,
  snapshotPath,
  type Workspaces,
} from './workspace';
