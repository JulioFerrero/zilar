import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { truncateOutput } from '@/lib/routines-format';
import type { ToolRun, ToolRunResult } from '@/lib/tools-api';

import { runStatusText } from './tool-detail-format';
import { fetchCountText } from './tool-actions';

/** The "Show all" / "Show less" ghost button every run block shares. */
function ShowMoreButton({ expanded, onPress }: { expanded: boolean; onPress: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 self-start px-0"
      accessibilityLabel={expanded ? 'Show less' : 'Show all'}
      onPress={onPress}
    >
      <Text className="text-[13px] text-foreground">{expanded ? 'Show less' : 'Show all'}</Text>
    </Button>
  );
}

export function RunRow({
  run,
  expanded,
  onToggleOutput,
}: {
  run: ToolRun;
  expanded: boolean;
  onToggleOutput: () => void;
}) {
  const cut =
    run.status === 'ok' && run.outputText !== null ? truncateOutput(run.outputText) : null;
  return (
    <View className="gap-1 px-2 py-1.5">
      <Text className="text-[13px] text-foreground">{runStatusText(run)}</Text>
      {run.status === 'error' ? (
        <Text className="text-[13px] text-muted-foreground">
          Failed: {run.errorKind ?? 'failed'}
        </Text>
      ) : null}
      {cut !== null ? (
        <View className="gap-1">
          <Text className="font-mono text-[12px] text-muted-foreground">
            {expanded ? (run.outputText ?? '') : cut.preview}
          </Text>
          {cut.truncated ? <ShowMoreButton expanded={expanded} onPress={onToggleOutput} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A failed run (`ok: false`) block plus the ok-run block, like web's
 * `RunResultBlock`: the error kind/message and logs are the tool's own
 * output, not the server envelope, so they may show.
 */
export function RunResultBlock({
  result,
  expanded,
  onToggle,
}: {
  result: ToolRunResult;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (!result.ok) {
    const text =
      result.logs === '' ? result.error.message : `${result.error.message}\n${result.logs}`;
    const cut = truncateOutput(text);
    return (
      <View className="gap-1 px-2">
        <Text className="text-[13px] text-danger">Failed: {result.error.kind}</Text>
        <Text className="font-mono text-[12px] text-muted-foreground">
          {expanded ? text : cut.preview}
        </Text>
        {cut.truncated ? <ShowMoreButton expanded={expanded} onPress={onToggle} /> : null}
      </View>
    );
  }
  const cut = truncateOutput(result.output.text);
  return (
    <View className="gap-1 px-2">
      <Text className="text-[13px] text-muted-foreground">
        Ok in {result.durationMs} ms · {fetchCountText(result.fetchCount)}
      </Text>
      <Text className="font-mono text-[12px] text-muted-foreground">
        {expanded ? result.output.text : cut.preview}
      </Text>
      {cut.truncated ? <ShowMoreButton expanded={expanded} onPress={onToggle} /> : null}
    </View>
  );
}
