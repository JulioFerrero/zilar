/**
 * Mobile's entry point for the settings-hub rows. The data lives in
 * `@zilar/chat-core` so the web `/settings` hub renders the same rows; this
 * module stays as the import path the mobile screens already use.
 */
export {
  SETTINGS_GROUP_ORDER,
  SETTINGS_ITEMS,
  type SettingsGroup,
  type SettingsIconId,
  type SettingsItem,
  type SettingsItemShape,
} from '@zilar/chat-core';
