// effect-plain: the wizard form is plain data over the shared create body builders; the key-check helpers live in @zilar/client-core.
import { buildPatch } from '@zilar/chat-core';

export { buildPatch };
export {
  EMPTY_KEY_STATE,
  discardCreatedKey,
  dropCreatedKey,
  keyCheckBaseState,
  keyStateAfterBaseUrlEdit,
  settleNewAiKeyCheck,
} from '@zilar/client-core';
