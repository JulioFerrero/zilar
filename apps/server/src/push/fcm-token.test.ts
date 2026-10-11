import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadPushConfig, pushConfigError, readFcmConfig } from './config';
import { createFcmTokenProvider, FcmTokenError, type FcmFetch } from './fcm-token';

// No real Google call: a key pair is generated in-process and `fetch` is faked.

function rsaKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey };
}

interface TokenExchange {
  count: number;
  bodies: string[];
}

function tokenFetch(exchange: TokenExchange, expiresIn = 3600): FcmFetch {
  return async (_url, init) => {
    exchange.count += 1;
    exchange.bodies.push(init.body);
    return new Response(
      JSON.stringify({ access_token: `token-${exchange.count}`, expires_in: expiresIn }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
}

function newExchange(): TokenExchange {
  return { count: 0, bodies: [] };
}

function first<T>(items: T[]): T {
  const value = items[0];
  if (value === undefined) {
    throw new Error('expected one captured value');
  }
  return value;
}

function decodeJwt(assertion: string): {
  header: { alg: string; typ: string };
  claims: { iss: string; scope: string; aud: string; iat: number; exp: number };
  signature: Buffer;
  signingInput: string;
} {
  const parts = assertion.split('.');
  const [headerPart, claimsPart, signaturePart] = parts;
  if (headerPart === undefined || claimsPart === undefined || signaturePart === undefined) {
    throw new Error('the assertion is not a three-part JWT');
  }
  return {
    header: JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as {
      alg: string;
      typ: string;
    },
    claims: JSON.parse(Buffer.from(claimsPart, 'base64url').toString('utf8')) as {
      iss: string;
      scope: string;
      aud: string;
      iat: number;
      exp: number;
    },
    signature: Buffer.from(signaturePart, 'base64url'),
    signingInput: `${headerPart}.${claimsPart}`,
  };
}

describe('FCM token provider', () => {
  it('signs an RS256 JWT with the service-account claims', async () => {
    const { privateKey, publicKey } = rsaKeyPair();
    const exchange = newExchange();
    const clientEmail = 'push@example.iam.gserviceaccount.com';
    const provider = createFcmTokenProvider({
      serviceAccount: { clientEmail, privateKey },
      fetch: tokenFetch(exchange),
      now: () => 1_700_000_000,
    });

    await provider.token();

    const params = new URLSearchParams(first(exchange.bodies));
    expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const jwt = decodeJwt(params.get('assertion') ?? '');
    expect(jwt.header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(jwt.claims.iss).toBe(clientEmail);
    expect(jwt.claims.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    expect(jwt.claims.aud).toBe('https://oauth2.googleapis.com/token');
    expect(jwt.claims.iat).toBe(1_700_000_000);
    expect(jwt.claims.exp - jwt.claims.iat).toBe(3600);
    expect(
      createVerify('RSA-SHA256').update(jwt.signingInput).end().verify(publicKey, jwt.signature),
    ).toBe(true);
  });

  it('performs one exchange and caches until expires_in - 300 elapses', async () => {
    const { privateKey } = rsaKeyPair();
    const exchange = newExchange();
    let clock = 1_000_000;
    const provider = createFcmTokenProvider({
      serviceAccount: { clientEmail: 'sa@example.com', privateKey },
      fetch: tokenFetch(exchange),
      now: () => clock,
    });

    const firstToken = await provider.token();
    expect(await provider.token()).toBe(firstToken);
    expect(exchange.count).toBe(1);

    // 3299 seconds later the token is still valid.
    clock += 3299;
    expect(await provider.token()).toBe(firstToken);
    expect(exchange.count).toBe(1);

    // The margin (expires_in - 300 = 3300s) forces the refresh.
    clock += 1;
    expect(await provider.token()).not.toBe(firstToken);
    expect(exchange.count).toBe(2);
  });

  it('collapses concurrent callers into one exchange', async () => {
    const { privateKey } = rsaKeyPair();
    const exchange = newExchange();
    const provider = createFcmTokenProvider({
      serviceAccount: { clientEmail: 'sa@example.com', privateKey },
      fetch: tokenFetch(exchange),
      now: () => 1_000_000,
    });

    const calls = [provider.token(), provider.token(), provider.token()];
    const tokens = await Promise.all(calls);

    expect(exchange.count).toBe(1);
    expect(new Set(tokens).size).toBe(1);
  });

  it('throws a status-only error without the assertion or the private key', async () => {
    const { privateKey } = rsaKeyPair();
    const provider = createFcmTokenProvider({
      serviceAccount: { clientEmail: 'sa@example.com', privateKey },
      fetch: async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
      now: () => 1_000_000,
    });

    try {
      await provider.token();
      throw new Error('expected the token request to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(FcmTokenError);
      const message = (error as Error).message;
      expect(message).toContain('HTTP 400');
      expect(message).not.toContain(privateKey);
      expect(message).not.toContain('assertion');
    }
  });
});

describe('push config: FCM', () => {
  const validAccount = JSON.stringify({
    client_email: 'push@example.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nCHANGE_ME\n-----END PRIVATE KEY-----\n',
    project_id: 'zilar-dev',
  });

  it('reads the project id from the service account when FCM_PROJECT_ID is absent', () => {
    const config = loadPushConfig({ FCM_SERVICE_ACCOUNT_JSON: validAccount });

    expect(readFcmConfig(config)?.projectId).toBe('zilar-dev');
    expect(pushConfigError(config)).toBeNull();
  });

  it('lets FCM_PROJECT_ID override the service account project id', () => {
    const config = loadPushConfig({
      FCM_SERVICE_ACCOUNT_JSON: validAccount,
      FCM_PROJECT_ID: 'explicit-project',
    });

    expect(readFcmConfig(config)?.projectId).toBe('explicit-project');
  });

  it('leaves FCM off when neither key is set', () => {
    const config = loadPushConfig({});

    expect(readFcmConfig(config)).toBeNull();
    expect(pushConfigError(config)).toBeNull();
  });

  it('reports a bad FCM_SERVICE_ACCOUNT_JSON by key name only', () => {
    const secret = '{ this is not json';
    const config = loadPushConfig({ FCM_SERVICE_ACCOUNT_JSON: secret });

    const error = pushConfigError(config);
    expect(error).toContain('FCM_SERVICE_ACCOUNT_JSON');
    expect(error ?? '').not.toContain(secret);
  });

  it('reports a service account missing client_email/private_key by key name only', () => {
    const secret = JSON.stringify({ project_id: 'zilar-dev' });
    const config = loadPushConfig({ FCM_SERVICE_ACCOUNT_JSON: secret });

    const error = pushConfigError(config);
    expect(error).toContain('FCM_SERVICE_ACCOUNT_JSON');
    expect(error ?? '').not.toContain(secret);
  });
});
