import { Chip } from './chip';

export default {
  Neutral: <Chip>3</Chip>,
  Pressed: (
    <Chip pressed ariaLabel="Reacted 👍">
      👍 3
    </Chip>
  ),
  Accent: (
    <Chip tone="accent" ariaLabel="Searching only in Dev team">
      Dev team
    </Chip>
  ),
};
