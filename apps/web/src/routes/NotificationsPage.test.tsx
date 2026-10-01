import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderApp } from '@/test/renderApp';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const pushConfig = { vapidPublicKey: 'dGVzdA', pushJid: 'push.galena.test' };

function stubBrowserGlobals(): {
  manager: {
    getSubscription: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
  };
} {
  const subscriptions: Array<{ endpoint: string }> = [];
  const manager = {
    getSubscription: vi.fn(async () =>
      subscriptions.length === 0
        ? null
        : {
            endpoint: subscriptions[0]!.endpoint,
            toJSON: () => ({
              endpoint: subscriptions[0]!.endpoint,
              keys: { p256dh: 'p', auth: 'a' },
            }),
            unsubscribe: async () => {
              subscriptions.length = 0;
              return true;
            },
          },
    ),
    subscribe: vi.fn(async () => {
      subscriptions.push({ endpoint: 'https://push.example.com/sub-1' });
      return {
        endpoint: 'https://push.example.com/sub-1',
        toJSON: () => ({
          endpoint: 'https://push.example.com/sub-1',
          keys: { p256dh: 'p', auth: 'a' },
        }),
        unsubscribe: async () => {
          subscriptions.length = 0;
          return true;
        },
      };
    }),
  };
  const registration = { pushManager: manager };
  Object.defineProperty(window.navigator, 'serviceWorker', {
    value: {
      register: vi.fn(async () => registration),
      getRegistration: vi.fn(async () => registration),
    },
    configurable: true,
  });
  Object.defineProperty(window, 'PushManager', { value: class {}, configurable: true });
  vi.stubGlobal(
    'Notification',
    class {
      static permission = 'granted';
      static requestPermission = vi.fn(async () => 'granted');
    },
  );
  return { manager };
}

function stubFetch(initialDevices: unknown[] = [], showPreviews = true): ReturnType<typeof vi.fn> {
  let devices: unknown[] = [...initialDevices];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace('/api', '');
    const method = init?.method ?? 'GET';
    if (path === '/push/config') {
      return jsonResponse(200, pushConfig);
    }
    if (path === '/push/subscriptions' && method === 'GET') {
      return jsonResponse(200, { devices });
    }
    if (path === '/push/subscriptions' && method === 'POST') {
      devices = [
        ...devices,
        {
          id: 'device-1',
          userAgent: 'Test · Browser',
          createdAt: '2026-09-30T00:00:00Z',
          lastUsedAt: null,
          inactive: false,
        },
      ];
      return jsonResponse(200, { id: 'device-1', node: 'p-device-1', jid: 'push.galena.test' });
    }
    if (path.startsWith('/push/subscriptions/') && method === 'DELETE') {
      devices = devices.filter(
        (device) => (device as { id: string }).id !== decodeURIComponent(path.split('/')[3] ?? ''),
      );
      return jsonResponse(200, { removed: true });
    }
    if (path === '/push/settings' && method === 'GET') {
      return jsonResponse(200, { showPreviews });
    }
    if (path === '/push/settings' && method === 'PUT') {
      return jsonResponse(200, { showPreviews: JSON.parse(String(init?.body)).showPreviews });
    }
    if (path === '/push/test' && method === 'POST') {
      return jsonResponse(200, { sent: true });
    }
    return jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  // stubBrowserGlobals installs these with defineProperty (not stubGlobal),
  // so they survive unstubAllGlobals and must be removed to keep the
  // unsupported-browser test honest.
  delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;
  delete (window as { PushManager?: unknown }).PushManager;
});

describe('NotificationsPage', () => {
  it('renders inside the shared settings shell with the column class', async () => {
    stubBrowserGlobals();
    stubFetch();
    const { container } = renderApp('/settings/notifications');

    expect(await screen.findByText('This device')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByText('Push this device when a message arrives.')).toBeTruthy();
    expect(container.querySelector('.mx-auto.max-w-2xl')).not.toBeNull();
  });

  it('shows the unsupported state without browser push APIs', async () => {
    stubFetch();
    renderApp('/settings/notifications');

    expect(await screen.findByText(/not supported in this browser/)).toBeTruthy();
  });

  it('loads devices, previews and the enable flow', async () => {
    stubBrowserGlobals();
    stubFetch();
    renderApp('/settings/notifications');

    expect(await screen.findByText('This device')).toBeTruthy();
    // The state is said in words, with the action next to it in the card.
    expect(screen.getByText('Not enabled')).toBeTruthy();
    expect(screen.getByText('Devices')).toBeTruthy();
    expect(screen.getByText('Message previews')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Enable on this device/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Enable on this device/ }));
    expect(await screen.findByText('Enabled')).toBeTruthy();
    expect(await screen.findByText(/Push is on for this device/)).toBeTruthy();
  });

  it('unsubscribes the browser subscription when the enable IQ fails (F6)', async () => {
    const { manager } = stubBrowserGlobals();
    stubFetch();
    const { store } = renderApp('/settings/notifications');
    store.setState({
      setPushPair: async () => {
        throw new Error('the chat connection cannot toggle push');
      },
    });

    expect(await screen.findByText('This device')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Enable on this device/ }));

    // The enable fails: the browser subscription created mid-flow is
    // removed again (no orphaned PushManager subscription), and the page
    // reports the offline connection.
    await vi.waitFor(() => {
      expect(manager.subscribe).toHaveBeenCalledTimes(1);
    });
    await screen.findByText(/chat connection is offline/);
    const registration = await window.navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    expect(subscription).toBeNull();
    expect(window.localStorage.getItem('galena:pushDevice')).toBeNull();
  });

  it('unsubscribes the browser subscription when registration fails (N2)', async () => {
    const { manager } = stubBrowserGlobals();
    // Registration throws after the browser subscription was created.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url).replace('/api', '');
        if (path === '/push/config') {
          return jsonResponse(200, pushConfig);
        }
        if (path === '/push/subscriptions' && (init?.method ?? 'GET') === 'POST') {
          return jsonResponse(400, {
            error: { code: 'invalid_subscription', message: 'The push subscription is invalid' },
          });
        }
        if (path === '/push/subscriptions') {
          return jsonResponse(200, { devices: [] });
        }
        if (path === '/push/settings') {
          return jsonResponse(200, { showPreviews: true });
        }
        return jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
      }),
    );
    renderApp('/settings/notifications');

    expect(await screen.findByText('This device')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Enable on this device/ }));

    // The browser subscription created mid-flow is removed again even
    // though the server row never existed, and the page shows the error.
    await vi.waitFor(() => {
      expect(manager.subscribe).toHaveBeenCalledTimes(1);
    });
    await screen.findByText(/invalid/i);
    const registration = await window.navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    expect(subscription).toBeNull();
    expect(window.localStorage.getItem('galena:pushDevice')).toBeNull();
  });

  it('shows the server-off state when push is disabled server-side', async () => {
    stubBrowserGlobals();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).endsWith('/push/config')) {
          return jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
        }
        return jsonResponse(404, { error: { code: 'not_found', message: 'Not found' } });
      }),
    );
    renderApp('/settings/notifications');

    expect(await screen.findByText(/not enabled on this server/)).toBeTruthy();
  });

  it('toggles previews and sends a test notification', async () => {
    stubBrowserGlobals();
    const fetchMock = stubFetch([
      {
        id: 'device-1',
        userAgent: 'Test · Browser',
        createdAt: '2026-09-30T00:00:00Z',
        lastUsedAt: null,
        inactive: false,
      },
    ]);
    window.localStorage.setItem(
      'galena:pushDevice',
      JSON.stringify({ id: 'device-1', node: 'p-device-1' }),
    );
    renderApp('/settings/notifications');

    expect(await screen.findByText(/Push is on for this device/)).toBeTruthy();

    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeTruthy();
    fireEvent.click(checkbox);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/push/settings',
        expect.objectContaining({ method: 'PUT' }),
      );
    });

    fireEvent.click(screen.getByRole('button', { name: /Send a test notification/ }));
    expect(await screen.findByText(/Sent — close this tab/)).toBeTruthy();
  });

  it('clears the local handle when this device is removed from the list', async () => {
    stubBrowserGlobals();
    stubFetch([
      {
        id: 'device-1',
        userAgent: 'Test · Browser',
        createdAt: '2026-09-30T00:00:00Z',
        lastUsedAt: null,
        inactive: false,
      },
    ]);
    window.localStorage.setItem(
      'galena:pushDevice',
      JSON.stringify({ id: 'device-1', node: 'p-device-1' }),
    );
    renderApp('/settings/notifications');

    expect(await screen.findByText(/Push is on for this device/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    // The row is gone and the page no longer treats this browser as the
    // stored device — the enable button returns immediately.
    expect(await screen.findByRole('button', { name: /Enable on this device/ })).toBeTruthy();
    expect(window.localStorage.getItem('galena:pushDevice')).toBeNull();
  });
});
