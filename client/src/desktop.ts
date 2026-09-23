declare global {
  interface Window { litespeedDesktop?: { platform: 'darwin'; chooseFolder: () => Promise<string | null> }; }
}
export function nativeDesktop() { return window.litespeedDesktop; }
