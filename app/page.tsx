import { getChatGPTUser, requireChatGPTUser } from './chatgpt-auth';
import ForgeStudio from './forge-studio';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await getChatGPTUser()
    ?? (process.env.NODE_ENV === 'production' ? await requireChatGPTUser('/') : null);

  return <ForgeStudio displayName={user?.fullName ?? user?.email ?? 'Moth'} />;
}
