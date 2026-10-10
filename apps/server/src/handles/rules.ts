// Handle rules (T-0163) live in @zilar/protocol so web and mobile share them;
// the server stays the authority and imports them from here.
export {
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  RESERVED_HANDLES,
  classifyHandle,
  isReservedHandle,
  isValidHandleShape,
  normalizeHandle,
  suggestHandle,
  type HandleAvailabilityReason,
} from '@zilar/protocol';
