import { useState } from 'react';
import { View } from 'react-native';
import { LLM_PROVIDER_IDS } from '@zilar/chat-core';

import { AddConnectionForm } from '@/components/connections/add-connection-form';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import type { ProviderConnection } from '@/lib/connections-api';

import type { Connection } from '../../lib/ais-api';
import { ProviderPicker } from './provider-picker';

/**
 * Step 3 of the wizard: pick one of the caller's active provider connections,
 * or add a key inline when there is none, so the wizard never dead-ends.
 */
export function ProviderStep({
  connections,
  value,
  onChange,
  onSaved,
}: {
  connections: readonly Connection[];
  value: string | null;
  onChange: (id: string) => void;
  onSaved: (connection: ProviderConnection) => void;
}) {
  const [adding, setAdding] = useState(true);

  if (connections.length > 0) {
    return <ProviderPicker connections={connections} value={value} onChange={onChange} />;
  }

  return (
    <View className="gap-3">
      <Text className="text-[15px] text-muted-foreground">Add a provider key to continue.</Text>
      {adding ? (
        <AddConnectionForm
          providers={LLM_PROVIDER_IDS}
          onCancel={() => setAdding(false)}
          onSaved={onSaved}
        />
      ) : (
        <Button onPress={() => setAdding(true)}>
          <Text>Add a provider key</Text>
        </Button>
      )}
    </View>
  );
}
