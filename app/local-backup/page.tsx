import { LocalBackupClient } from './local-backup-client';

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

function getFirstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LocalBackupPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const mode = getFirstQueryValue(params.mode) || 'download';
  const outputPath = getFirstQueryValue(params.outputPath) || 'seed/user-backup.zip';
  const autoRun = getFirstQueryValue(params.autostart) !== '0';

  return <LocalBackupClient mode={mode} outputPath={outputPath} autoRun={autoRun} />;
}
