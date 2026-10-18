import { RequireUser } from '@/auth/RequireAuth';
import { Effect } from 'effect';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { isWaiting, useAction } from '@/lib/effect/use-action';
import { AuthCard } from '../../auth/AuthCard';
import { safeTarget } from '../../auth/guard';
import { useAuthStore } from '../../auth/session';

function NameForm() {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const me = useAuthStore((state) => state.me);
  const setName = useAuthStore((state) => state.setName);
  const [name, setNameInput] = useState(me?.name ?? '');
  const [error, setError] = useState<string | undefined>(undefined);
  const [saveState, save] = useAction((trimmed: string) =>
    Effect.gen(function* () {
      setError(undefined);
      const result = yield* Effect.tryPromise({
        try: () => setName(trimmed),
        catch: (cause) => cause,
      }).pipe(Effect.orElseSucceed(() => ({ ok: false })));
      if (!result.ok) {
        setError('Could not save your name. Try again.');
        return;
      }
      const from = safeTarget(params.from);
      router.replace(from !== '/' ? (from as Href) : ('/welcome/handle' as Href));
    }),
  );
  const busy = isWaiting(saveState);

  const submit = (): void => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError('Enter your name');
      return;
    }
    save(trimmed);
  };

  return (
    <AuthCard title="What should we call you?">
      <Text className="mt-1 text-center text-[15px] text-muted-foreground">
        Your friends will see this name.
      </Text>
      <Text className="mt-6 text-[14px] font-medium text-foreground">Name</Text>
      <TextField
        accessibilityLabel="Name"
        autoFocus
        maxLength={64}
        editable={!busy}
        value={name}
        onChangeText={setNameInput}
        placeholder="Your name"
        className="mt-1"
      />
      {error !== undefined && (
        <Text accessibilityRole="alert" className="mt-2 text-[14px] text-danger">
          {error}
        </Text>
      )}
      <Button
        accessibilityLabel="Continue"
        disabled={busy}
        onPress={submit}
        variant="default"
        size="lg"
        className="mt-4"
      >
        <Text>Continue</Text>
      </Button>
    </AuthCard>
  );
}

export default function NameRoute() {
  return (
    <RequireUser>
      <NameForm />
    </RequireUser>
  );
}
