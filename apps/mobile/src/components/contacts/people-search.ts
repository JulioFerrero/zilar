// The `@handle` exact lookup now lives in `@zilar/client-core` (T-2050), so
// the phone and the web run the same controller. Re-exported here so the
// existing mobile importers stay unchanged.
export {
  NO_PERSON_MESSAGE,
  PEOPLE_LOOKUP_ERROR_MESSAGE,
  PEOPLE_RATE_LIMITED_MESSAGE,
  PEOPLE_SEARCH_DEBOUNCE_MS,
  peopleHandleFor,
  PeopleSearchController,
  type PeopleSearchControllerOptions,
  type PeopleSearchView,
} from '@zilar/client-core';
