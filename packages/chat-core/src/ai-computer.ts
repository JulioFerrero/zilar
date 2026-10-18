export type ComputerMode = 'off' | 'cloud' | 'runner' | 'auto';

export interface ComputerChoice {
  mode: ComputerMode;
  label: string;
  description: string;
  disabled: boolean;
}

// `Off` is always offered; `cloud` needs the cloud desk client; `machine` and `auto` need a home machine. A disabled choice shows why in place of its description.
export function computerChoices(cloud: boolean, hasMachine: boolean): ComputerChoice[] {
  return [
    {
      mode: 'off',
      label: 'Off',
      description: 'No computer',
      disabled: false,
    },
    {
      mode: 'cloud',
      label: 'Zilar',
      description: cloud ? 'Runs on a Zilar cloud computer' : 'Needs setup on your server',
      disabled: !cloud,
    },
    {
      mode: 'runner',
      label: 'Machine',
      description: hasMachine ? 'Runs on your home machine' : 'Pick a machine first',
      disabled: !hasMachine,
    },
    {
      mode: 'auto',
      label: 'Auto',
      description: hasMachine
        ? "My machine when it's online, otherwise Zilar cloud"
        : 'Pick a machine first',
      disabled: !hasMachine,
    },
  ];
}
