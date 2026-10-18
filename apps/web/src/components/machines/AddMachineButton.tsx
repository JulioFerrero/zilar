import { Plus } from 'lucide-react';
import { Button } from '@/components/ais/AiPageShell';

interface AddMachineButtonProps {
  onClick: () => void;
}

export function AddMachineButton({ onClick }: AddMachineButtonProps) {
  return (
    <Button type="button" size="lg" onClick={onClick}>
      <Plus aria-hidden="true" />
      Add machine
    </Button>
  );
}
