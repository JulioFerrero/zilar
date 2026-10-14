import { Plus } from 'lucide-react-native';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { ACCENT } from '@/lib/colors';

import type { AiLimits, Connection } from '../../lib/ais-api';
import type { WizardForm } from './form';
import { formatLimits } from './limits';
import { providerLabel } from './providers';
import { templateLabel } from './templates';

/** The last wizard step: the values the create call will send. */
export function ReviewStep({
  form,
  limits,
  connection,
}: {
  form: WizardForm;
  limits: AiLimits | null;
  connection: Connection | null;
}) {
  const rows: Array<[string, string]> = [
    ['Name', form.name.trim()],
    ['Template', templateLabel(form.template)],
    ['Provider', connection === null ? '—' : providerLabel(connection.provider)],
    ['Model', form.model.trim()],
    ['Limits', limits === null ? '—' : formatLimits(limits)],
  ];
  return (
    <View className="gap-3">
      <View className="overflow-hidden rounded-xl border border-divider">
        {rows.map(([label, value], index) => (
          <View
            key={label}
            className={
              index === 0
                ? 'flex-row items-start gap-3 px-3 py-2.5'
                : 'flex-row items-start gap-3 border-t border-divider px-3 py-2.5'
            }
          >
            <Text className="w-20 shrink-0 text-[13px] text-muted-foreground">{label}</Text>
            <Text className="min-w-0 flex-1 text-[15px] text-foreground">{value}</Text>
          </View>
        ))}
      </View>
      <View>
        <Text className="text-[13px] font-medium text-muted-foreground">Persona</Text>
        <Text className="mt-1 rounded-lg bg-muted px-3 py-2 text-[14px] text-foreground">
          {form.persona.trim() === '' ? '—' : form.persona}
        </Text>
      </View>
      <View className="flex-row items-center gap-1.5">
        <Plus size={14} color={ACCENT} />
        <Text className="flex-1 text-[13px] text-muted-foreground">
          Creating this AI provisions its chat account and issues a capped provider key.
        </Text>
      </View>
    </View>
  );
}
