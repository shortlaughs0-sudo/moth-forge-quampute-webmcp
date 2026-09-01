import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';

export type OwnerContext = {
  ownerId: string;
  displayName: string;
  email: string | null;
  local: boolean;
};

export function isPublicDemoMode() {
  return env.PUBLIC_DEMO_MODE?.trim().toLowerCase() === 'true';
}

export async function getOwnerContext(): Promise<OwnerContext | null> {
  const allowedOwner = env.MOTH_OWNER_USER_ID?.trim();
  const allowedEmail = env.MOTH_OWNER_EMAIL?.trim().toLowerCase();
  const publicDemoMode = isPublicDemoMode();
  if (process.env.NODE_ENV === 'production' && !publicDemoMode && !allowedOwner && !allowedEmail) return null;

  const user = await getChatGPTUser();
  if (user) {
    if (!publicDemoMode && allowedOwner && user.userId !== allowedOwner) return null;
    if (!publicDemoMode && allowedEmail && user.email.toLowerCase() !== allowedEmail) return null;
    return {
      ownerId: user.userId,
      displayName: user.fullName ?? user.email,
      email: user.email,
      local: false,
    };
  }

  if (process.env.NODE_ENV !== 'production') {
    return {
      ownerId: 'local-moth',
      displayName: 'Moth',
      email: null,
      local: true,
    };
  }
  return null;
}
