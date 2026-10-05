import { ArrowRight, Plus } from 'lucide-react';
import { Button } from './button';

const VARIANTS = ['default', 'outline', 'secondary', 'ghost', 'destructive', 'link'] as const;

function VariantRow({ size }: { size: 'default' | 'sm' | 'lg' }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {VARIANTS.map((variant) => (
        <Button key={variant} variant={variant} size={size}>
          {variant}
        </Button>
      ))}
    </div>
  );
}

export default {
  Default: <Button>Send</Button>,
  Variants: <VariantRow size="default" />,
  Small: <VariantRow size="sm" />,
  Large: <VariantRow size="lg" />,
  Disabled: (
    <div className="flex flex-wrap items-center gap-2">
      {VARIANTS.map((variant) => (
        <Button key={variant} variant={variant} disabled>
          {variant}
        </Button>
      ))}
    </div>
  ),
  WithIcon: (
    <div className="flex flex-wrap items-center gap-2">
      <Button>
        Next <ArrowRight />
      </Button>
      <Button variant="outline">
        <Plus /> New chat
      </Button>
    </div>
  ),
};
