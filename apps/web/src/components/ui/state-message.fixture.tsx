import { StateMessage } from './state-message';

export default {
  Empty: <StateMessage kind="empty" title="No chats yet" hint="Start one to see it here." />,
  EmptyWithAction: (
    <StateMessage
      kind="empty"
      title="No results"
      hint="Try a different search."
      action={{ label: 'Clear search', onClick: () => {} }}
    />
  ),
  Loading: <StateMessage kind="loading" title="Loading chats" />,
  Inline: <StateMessage kind="loading" size="inline" title="Loading…" />,
  Error: (
    <StateMessage
      kind="error"
      title="Something went wrong."
      hint="Please try again."
      action={{ label: 'Try again', onClick: () => {} }}
    />
  ),
};
