import {
  IntegrationsApiError,
  type IntegrationsApi,
  type IntegrationsStatus,
  type SaveEmailSettingsInput,
  type SaveVoiceTranscriptionInput,
} from '../../lib/integrations-api';

/**
 * Mock integrations API for `EXPO_PUBLIC_ZILAR_MOCK=1` or `?mock=<scenario>`.
 * It lives beside the hook (not in `src/mock/`) so this task touches only its
 * allowed files; the pattern mirrors `components/connections/connections-mock.ts`.
 *
 * Secrets are write-only, exactly like the server: saving a bot token only
 * flips `configured`/`source`, and saving email keeps `from` but drops the
 * key the moment the row is built.
 */

export type IntegrationsMockScenario = 'default' | 'unconfigured' | 'not-owner' | 'error';

export function integrationsMockScenario(
  env: Record<string, string | undefined>,
  params?: Record<string, string | string[] | undefined>,
  paramAllowed = false,
): IntegrationsMockScenario | null {
  const rawParam = params?.['mock'];
  const param = paramAllowed ? (Array.isArray(rawParam) ? rawParam[0] : rawParam) : undefined;
  const requested = param !== undefined ? param : env['EXPO_PUBLIC_ZILAR_MOCK'];
  if (requested === undefined || requested === '' || requested === '0') {
    return null;
  }
  if (requested === '1') {
    return normalizeScenario(env['EXPO_PUBLIC_ZILAR_MOCK_SCENARIO']) ?? 'default';
  }
  return normalizeScenario(requested);
}

function normalizeScenario(value: string | undefined): IntegrationsMockScenario | null {
  switch (value) {
    case 'default':
    case 'unconfigured':
    case 'not-owner':
    case 'error':
      return value;
    default:
      return null;
  }
}

interface MockIntegrationsState {
  telegramConfigured: boolean;
  telegramSource: 'stored' | null;
  emailConfigured: boolean;
  emailSource: 'stored' | null;
  emailFrom: string | null;
  voiceConfigured: boolean;
  voiceBaseUrl: string | null;
  voiceModel: string | null;
}

// Kept at module scope so mutations survive navigation between the screens.
const states = new Map<IntegrationsMockScenario, MockIntegrationsState>();

function seedState(scenario: IntegrationsMockScenario): MockIntegrationsState {
  if (scenario === 'default') {
    return {
      telegramConfigured: true,
      telegramSource: 'stored',
      emailConfigured: true,
      emailSource: 'stored',
      emailFrom: 'Zilar <hello@example.com>',
      voiceConfigured: false,
      voiceBaseUrl: null,
      voiceModel: null,
    };
  }
  return {
    telegramConfigured: false,
    telegramSource: null,
    emailConfigured: false,
    emailSource: null,
    emailFrom: null,
    voiceConfigured: false,
    voiceBaseUrl: null,
    voiceModel: null,
  };
}

function stateFor(scenario: IntegrationsMockScenario): MockIntegrationsState {
  const existing = states.get(scenario);
  if (existing !== undefined) {
    return existing;
  }
  const created = seedState(scenario);
  states.set(scenario, created);
  return created;
}

/**
 * Clears the per-scenario state. Tests call this between cases so they do
 * not depend on the order they run in.
 */
export function resetIntegrationsMock(): void {
  states.clear();
}

function snapshot(state: MockIntegrationsState): IntegrationsStatus {
  return {
    telegram: { configured: state.telegramConfigured, source: state.telegramSource },
    email: {
      configured: state.emailConfigured,
      source: state.emailSource,
      from: state.emailFrom,
    },
    voiceTranscription: {
      configured: state.voiceConfigured,
      baseUrl: state.voiceBaseUrl,
      model: state.voiceModel,
    },
    canManage: true,
  };
}

/** An `IntegrationsApi` backed by the mock data, for offline UI work and screenshots. */
export function createMockIntegrationsApi(
  scenario: IntegrationsMockScenario = 'default',
): IntegrationsApi {
  const state = stateFor(scenario);

  const guardStatus = (): void => {
    if (scenario === 'not-owner') {
      throw new IntegrationsApiError(404, 'not_found', 'Not found');
    }
    if (scenario === 'error') {
      throw new IntegrationsApiError(500, 'server_error', 'Mock failure');
    }
  };

  return {
    async getIntegrationsStatus() {
      guardStatus();
      return snapshot(state);
    },
    async saveTelegramBotToken(botToken: string) {
      guardStatus();
      void botToken;
      state.telegramConfigured = true;
      state.telegramSource = 'stored';
    },
    async removeTelegramBotToken() {
      guardStatus();
      state.telegramConfigured = false;
      state.telegramSource = null;
    },
    async saveEmailSettings(input: SaveEmailSettingsInput) {
      guardStatus();
      state.emailConfigured = true;
      state.emailSource = 'stored';
      state.emailFrom = input.from;
    },
    async getVoiceTranscriptionStatus() {
      guardStatus();
      return { enabled: state.voiceConfigured };
    },
    async saveVoiceTranscriptionSettings(input: SaveVoiceTranscriptionInput) {
      guardStatus();
      state.voiceConfigured = true;
      state.voiceBaseUrl = input.baseUrl;
      state.voiceModel = input.model ?? 'whisper-1';
    },
    async removeVoiceTranscriptionSettings() {
      guardStatus();
      state.voiceConfigured = false;
      state.voiceBaseUrl = null;
      state.voiceModel = null;
    },
  };
}
