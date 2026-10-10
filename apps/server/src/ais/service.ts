// Barrel for the AI service (T-0956): the original `ais/service.ts` was split
// into feature modules (`queries`, `provisioning`, `provisioning-keys`,
// `provisioning-xmpp`, `persona`, `status`). Importers keep this path and every
// name and kind it exported before.

export { MAX_MONTHLY_USD } from '@zilar/api-contract';

export type {
  AiLimits,
  AiLogger,
  AiServiceDeps,
  CreateAiInput,
  PublicAi,
  UpdateAiInput,
} from './persona';
export { CHAT_PERSONA_MAX_LENGTH, revertPersonaFromChat, setPersonaFromChat } from './persona';

export type { ActiveAiForGateway, AiLifecycleEvent } from './queries';
export {
  findOwnedAi,
  getOwnedAi,
  listActiveAisForGateway,
  listAis,
  onAiLifecycle,
} from './queries';

export { createAi, updateAi } from './provisioning';

export type { ChangeAiModelInput } from './provisioning-keys';
export {
  VIRTUAL_KEY_BUDGET_DURATION,
  changeAiModel,
  ensureAiModel,
  virtualKeyAlias,
} from './provisioning-keys';

export { aiLocalpart, deleteAi } from './provisioning-xmpp';

export type { AssignMachineInput } from './status';
export { assignMachine, resumeAi, stopAi } from './status';
