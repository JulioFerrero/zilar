import { Redirect } from 'expo-router';

/**
 * The old `/profile` route, kept as a link: it opens the own profile screen at
 * `/me`, the same screen the Settings profile card opens. A `zilar://profile`
 * deep link passes through `+native-intent.tsx` unchanged and lands here, so a
 * redirect file keeps old links and notification taps working.
 */
export default function ProfileRedirect() {
  return <Redirect href="/me" />;
}
