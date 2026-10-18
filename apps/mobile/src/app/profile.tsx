import { Redirect } from 'expo-router';

/**
 * Kept as a redirect: old `zilar://profile` links and notification taps land here, so they keep working.
 */
export default function ProfileRedirect() {
  return <Redirect href="/me" />;
}
