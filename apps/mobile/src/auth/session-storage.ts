/** Where the bearer session token is persisted between app launches. */
export interface SessionStorage {
  getToken(): Promise<string | undefined>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
}

/** In-memory storage for tests; never used by the app. */
export function createMemorySessionStorage(initial?: string): SessionStorage {
  let token: string | undefined = initial;
  return {
    getToken: () => Promise.resolve(token),
    setToken: (next) => {
      token = next;
      return Promise.resolve();
    },
    clearToken: () => {
      token = undefined;
      return Promise.resolve();
    },
  };
}
