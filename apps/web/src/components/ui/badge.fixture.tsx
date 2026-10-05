import { Badge } from './badge';

export default {
  Single: <Badge count={2} />,
  Many: <Badge count={37} />,
  Capped: <Badge count={120} />,
  CustomMax: <Badge count={120} max={9} />,
  Muted: <Badge count={5} muted />,
  Zero: (
    <span className="text-[12px] text-subtle-foreground">
      zero renders nothing
      <Badge count={0} />
    </span>
  ),
};
