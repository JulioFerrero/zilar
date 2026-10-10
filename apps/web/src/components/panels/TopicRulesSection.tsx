import { AlwaysAllowedList } from '../approvals/AlwaysAllowedList';

/** The topic's Always-allowed rules, read-only: rows show the topic name. */
export function TopicRulesSection({
  groupId,
  topicId,
  topicName,
}: {
  groupId: string;
  topicId: string;
  topicName: string;
}) {
  return (
    <section aria-label={`Always allowed in ${topicName}`}>
      <AlwaysAllowedList scope={{ groupId }} topicId={topicId} topicName={topicName} readOnly />
    </section>
  );
}
