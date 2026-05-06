import { getAllAdminSettings } from '@/lib/admin-settings';
import { PlatformSettingsClient } from './_components/PlatformSettingsClient';

export const dynamic = 'force-dynamic';

export default async function PlatformSettingsPage() {
  const settings = await getAllAdminSettings();
  return <PlatformSettingsClient initialSettings={settings} />;
}
