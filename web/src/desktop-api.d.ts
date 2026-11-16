interface Window {
  bioInfoBuddyDesktop?: {
    platform: 'macos' | 'windows';
    installEnvironment: (id: string) => Promise<void>;
  };
}
