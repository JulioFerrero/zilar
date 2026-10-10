import { Plus } from 'lucide-react';
import { Button } from '@/components/ais/AiPageShell';

interface AddMachineButtonProps {
  onClick: () => void;
}

/** The one "Add machine" button every machines section header uses. */
export function AddMachineButton({ onClick }: AddMachineButtonProps) {
  return (
    <Button type="button" size="lg" className="rounded-full px-5" onClick={onClick}>
      <Plus aria-hidden="true" />
      Add machine
    </Button>
  );
}
