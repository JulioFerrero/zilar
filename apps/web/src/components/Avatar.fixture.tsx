import { Avatar } from './Avatar';

const IMAGE =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 40%22%3E%3Crect width=%2240%22 height=%2240%22 fill=%22%23333333%22/%3E%3Ccircle cx=%2220%22 cy=%2215%22 r=%227%22 fill=%22%23ededed%22/%3E%3Cpath d=%22M6 40c0-9 6-14 14-14s14 5 14 14z%22 fill=%22%23ededed%22/%3E%3C/svg%3E';

export default {
  Person: <Avatar seed="julio" name="Julio" />,
  AI: <Avatar seed="ada" name="Ada" ai />,
  Online: <Avatar seed="sam" name="Sam" online />,
  WithImage: <Avatar seed="photo" name="Photo" avatarUrl={IMAGE} />,
  Size32: <Avatar seed="small" name="Sam" size={32} />,
  Size44: <Avatar seed="medium" name="Sam" size={44} />,
  Size54: <Avatar seed="large" name="Sam" size={54} />,
};
