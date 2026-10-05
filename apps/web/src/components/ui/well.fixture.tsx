import { Well } from './well';

export default {
  Default: <Well className="px-4 py-3 text-sm text-muted-foreground">Search chats</Well>,
  Composer: (
    <Well className="flex items-center gap-2 rounded-[14px] p-2">
      <span className="px-2 text-sm text-muted-foreground">Message Ada</span>
    </Well>
  ),
};
