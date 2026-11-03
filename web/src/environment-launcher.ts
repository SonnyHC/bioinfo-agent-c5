export const launcherActionIds = [
  'single-cell-windows', 'single-cell-macos',
  'spatial-windows', 'spatial-macos',
  'case-single-cell-windows', 'case-single-cell-macos',
  'case-spatial-windows', 'case-spatial-macos',
] as const;

export function launcherUrl(id: string): string {
  if (!launcherActionIds.some(action => action === id)) throw new Error('未知环境。');
  return `bioinfobuddy://install/${id}`;
}

export const launcherDownloads = {
  macos: '/resources/launcher/BioInfoBuddy-Launcher-macOS.zip',
  windows: '/resources/launcher/BioInfoBuddy-Launcher-Windows.zip',
};
