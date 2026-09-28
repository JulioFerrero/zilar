import './polyfills';

import {
  createXmppCore,
  type ChatMessage,
  type ConnectionStatus,
  type XmppCore,
} from '@galena/xmpp-core';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { readSpikeEnvFromProcess } from './config';
import { requestXmppToken } from './fetch-token';
import { nativeCapabilities } from './polyfills';

type LogLine = { id: number; text: string };

let logSequence = 0;

function shorten(jid: string): string {
  return jid.length > 42 ? `${jid.slice(0, 20)}…${jid.slice(-20)}` : jid;
}

export default function SpikeScreen() {
  const env = useRef(readSpikeEnvFromProcess()).current;

  const [service, setService] = useState(env.service);
  const [domain, setDomain] = useState(env.domain);
  const [apiUrl, setApiUrl] = useState(env.apiUrl);
  const [sessionToken, setSessionToken] = useState('');
  const [selfJid, setSelfJid] = useState(env.selfJid);
  const [selfToken, setSelfToken] = useState(env.selfToken);
  const [peerJid, setPeerJid] = useState(env.peerJid);
  const [peerToken, setPeerToken] = useState(env.peerToken);
  const [text, setText] = useState('hello from the spike');

  const [logs, setLogs] = useState<LogLine[]>([]);
  const [selfStatus, setSelfStatus] = useState<ConnectionStatus>('offline');
  const [peerStatus, setPeerStatus] = useState<ConnectionStatus>('offline');
  const [selfBound, setSelfBound] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const selfCore = useRef<XmppCore | null>(null);
  const peerCore = useRef<XmppCore | null>(null);
  const autoStarted = useRef(false);

  const log = (message: string) => {
    console.log(`[spike] ${message}`);
    logSequence += 1;
    const line: LogLine = { id: logSequence, text: message };
    setLogs((previous) => [line, ...previous].slice(0, 200));
  };

  useEffect(() => {
    const capabilities = nativeCapabilities();
    log('spike screen mounted');
    log(
      `native globals: nextTick=${capabilities.nextTick} btoa=${capabilities.btoa} ` +
        `atob=${capabilities.atob} randomUUID=${capabilities.randomUUID} ` +
        `TextEncoder=${capabilities.textEncoder}`,
    );
    const subscription = AppState.addEventListener('change', (state) => {
      log(`AppState: ${state}`);
      if (state === 'active') {
        log(
          `on active: self=${selfCore.current?.status() ?? 'n/a'} ` +
            `peer=${peerCore.current?.status() ?? 'n/a'}`,
        );
      }
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (autoStarted.current) return;
    const hasConfig = env.selfJid !== '' && env.selfToken !== '';
    if (!hasConfig) return;
    autoStarted.current = true;
    log('auto-connect: spike config present');
    setTimeout(() => {
      void (async () => {
        await connect();
        await new Promise((resolve) => setTimeout(resolve, 500));
        await send();
        await new Promise((resolve) => setTimeout(resolve, 1200));
        log('reconnect demo: disconnecting then reconnecting');
        await disconnect();
        await connect();
        log('reconnect demo: done');
      })();
    }, 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function credentialsFor(
    label: string,
    jid: string,
    token: string,
    useSession: boolean,
  ): () => Promise<{ jid: string; token: string }> {
    return async () => {
      log(`getToken called for ${label}`);
      if (useSession && sessionToken !== '') {
        const fetched = await requestXmppToken(apiUrl, sessionToken);
        return { jid: fetched.jid, token: fetched.token };
      }
      return { jid, token };
    };
  }

  function wireCore(
    label: string,
    core: XmppCore,
    onMessage: (message: ChatMessage) => void,
  ): XmppCore {
    core.on('status', (status) => {
      log(`${label} status: ${status}`);
      if (label === 'self') setSelfStatus(status);
      else setPeerStatus(status);
    });
    core.on('message', onMessage);
    core.on('error', (error) => log(`${label} error: ${error.message}`));
    return core;
  }

  async function connect() {
    if (busy) return;
    setBusy(true);
    log(`connecting: service=${service} domain=${domain} self=${selfJid || '(none)'}`);

    try {
      if (selfJid && selfToken) {
        const core = wireCore(
          'self',
          createXmppCore({
            service,
            domain,
            getToken: credentialsFor('self', selfJid, selfToken, sessionToken !== ''),
          }),
          (message) => {
            log(
              `self ← message from ${shorten(message.fromJid)} [${message.kind}]: ` +
                `${message.body ?? '(no body)'}`,
            );
          },
        );
        selfCore.current = core;
        await core.connect();
        setSelfBound(core.me());
        log(`self online as ${core.me() ?? '(unknown)'}`);
      }

      if (peerJid && peerToken) {
        const core = wireCore(
          'peer',
          createXmppCore({
            service,
            domain,
            getToken: credentialsFor('peer', peerJid, peerToken, false),
          }),
          (message) => {
            log(
              `peer ← message from ${shorten(message.fromJid)} [${message.kind}]: ` +
                `${message.body ?? '(no body)'}`,
            );
            if (!message.outgoing && message.body && message.chatJid === selfJid) {
              void core
                .sendMessage(message.chatJid, 'chat', `echo: ${message.body}`)
                .then(() => log(`peer replied to ${shorten(message.chatJid)}`))
                .catch((error: unknown) => log(`peer reply failed: ${String(error)}`));
            }
          },
        );
        peerCore.current = core;
        await core.connect();
        log(`peer online as ${core.me() ?? '(unknown)'}`);
      }
    } catch (error) {
      log(`connect failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    log('disconnecting both');
    await selfCore.current?.disconnect().catch(() => undefined);
    await peerCore.current?.disconnect().catch(() => undefined);
    selfCore.current = null;
    peerCore.current = null;
    setSelfStatus('offline');
    setPeerStatus('offline');
    setSelfBound(undefined);
  }

  async function send() {
    const core = selfCore.current;
    if (!core || !text.trim() || !peerJid) {
      log('cannot send: not connected or no peer JID');
      return;
    }
    try {
      const result = await core.sendMessage(peerJid, 'chat', text.trim());
      log(`self → sent "${text.trim()}" (id ${result.id})`);
    } catch (error) {
      log(`send failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>XMPP spike (T-0004)</Text>

      <ScrollView style={styles.form} keyboardShouldPersistTaps="handled">
        <Field label="service" value={service} onChange={setService} />
        <Field label="domain" value={domain} onChange={setDomain} />
        <Field label="apiUrl" value={apiUrl} onChange={setApiUrl} />
        <Field
          label="session token (optional)"
          value={sessionToken}
          onChange={setSessionToken}
          secure
        />
        <Field label="self JID" value={selfJid} onChange={setSelfJid} />
        <Field label="self token" value={selfToken} onChange={setSelfToken} secure />
        <Field label="peer JID" value={peerJid} onChange={setPeerJid} />
        <Field label="peer token" value={peerToken} onChange={setPeerToken} secure />

        <Text style={styles.status}>
          self: <Status value={selfStatus} /> {selfBound ? `(${shorten(selfBound)})` : ''}
        </Text>
        <Text style={styles.status}>
          peer: <Status value={peerStatus} />
        </Text>

        <View style={styles.row}>
          <Pressable
            style={[styles.button, busy && styles.buttonDisabled]}
            onPress={connect}
            disabled={busy}
          >
            <Text style={styles.buttonText}>Connect</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={disconnect}>
            <Text style={styles.buttonText}>Disconnect</Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          <TextInput
            style={styles.messageInput}
            value={text}
            onChangeText={setText}
            placeholder="message"
            placeholderTextColor="#999"
          />
          <Pressable style={styles.button} onPress={send}>
            <Text style={styles.buttonText}>Send to peer</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Text style={styles.logHeader}>log (newest first)</Text>
      <ScrollView style={styles.logs}>
        {logs.map((line) => (
          <Text key={line.id} style={styles.logLine}>
            {line.text}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

function Status({ value }: { value: ConnectionStatus }) {
  const color = value === 'online' ? '#1a9c4b' : value === 'offline' ? '#b91c1c' : '#b45309';
  return <Text style={{ color, fontWeight: '700' }}>{value}</Text>;
}

function Field({
  label,
  value,
  onChange,
  secure,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  secure?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a', paddingTop: 60, paddingHorizontal: 12 },
  title: { color: '#e2e8f0', fontSize: 18, fontWeight: '700', marginBottom: 8 },
  form: { maxHeight: 360, flexGrow: 0 },
  field: { marginBottom: 6 },
  fieldLabel: { color: '#64748b', fontSize: 11 },
  fieldInput: {
    backgroundColor: '#1e293b',
    color: '#e2e8f0',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 12,
  },
  status: { color: '#cbd5e1', fontSize: 13, marginVertical: 4 },
  row: { flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'center' },
  button: {
    backgroundColor: '#2563eb',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#ffffff', fontWeight: '600', fontSize: 13 },
  messageInput: {
    flex: 1,
    backgroundColor: '#1e293b',
    color: '#e2e8f0',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
  },
  logHeader: { color: '#64748b', fontSize: 12, marginTop: 10, marginBottom: 4 },
  logs: { flex: 1 },
  logLine: { color: '#94a3b8', fontSize: 11, fontFamily: 'Menlo', marginBottom: 2 },
});
