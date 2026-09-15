import { Redirect } from 'expo-router';
import React from 'react';

import { useAuthStore } from '@/store/auth';

/** Entry gate: routes to the phone sign-in, the profile step, or the app. */
export default function Index() {
  const token = useAuthStore((s) => s.token);
  const needsProfile = useAuthStore((s) => s.needsProfile);

  if (!token) return <Redirect href="/(auth)/phone" />;
  if (needsProfile) return <Redirect href="/(auth)/role" />;
  return <Redirect href="/(app)" />;
}
