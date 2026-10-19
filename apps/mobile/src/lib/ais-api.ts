import type { AiCatalog, AiComputerOptions } from '@zilar/api-contract';
import {
  type Connection,
  type CreateAiInput,
  type PublicAi,
  type UpdateAiInput,
} from '@zilar/client-core';

/**
 * Errors are the shared `ApiError`, so screens branch on `status` without parsing the message.
 */

export type {
  AiLimits,
  AiTemplate,
  Connection,
  CreateAiInput,
  PublicAi,
  UpdateAiInput,
} from '@zilar/client-core';

export interface AisApi {
  listAis(): Promise<PublicAi[]>;
  createAi(input: CreateAiInput): Promise<PublicAi>;
  updateAi(id: string, input: UpdateAiInput): Promise<PublicAi>;
  deleteAi(id: string): Promise<void>;
  listConnections(): Promise<Connection[]>;
  getAiCatalog(): Promise<AiCatalog>;
  getComputerOptions(): Promise<AiComputerOptions>;
  // The server answers the fresh public AI, so the list can swap the row against server truth without a second GET.
  stopAi(id: string): Promise<PublicAi>;
  resumeAi(id: string): Promise<PublicAi>;
  stopAiTurn(id: string, chatJid: string): Promise<{ stopped: boolean }>;
}
