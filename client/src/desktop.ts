declare global {
  interface Window { litespeedDesktop?: { platform: 'darwin'; chooseFolder: () => Promise<string | null>; restartUpdate?: () => Promise<void> }; }
}
export function nativeDesktop() { return window.litespeedDesktop; }
