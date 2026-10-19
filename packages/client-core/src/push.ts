export interface PushPairInput {
  pushJid: string;
  node: string;
  enable: boolean;
}

export type SetPushPair = (input: PushPairInput) => Promise<void>;
