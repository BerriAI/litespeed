export interface SigningConfiguration { identity: string; profile: string; team: string; keychain?: string }
export type SigningTool = (command: string, args: string[]) => string;
export function signingConfiguration(env?: NodeJS.ProcessEnv): SigningConfiguration | null;
export function signingTargets(app: string): Promise<Array<{ path: string; executable: boolean }>>;
export const runSigningTool: SigningTool;
export function signDesktopApp(app: string, configuration: SigningConfiguration, run?: SigningTool): Promise<void>;
export function notarize(archive: string, stapleTarget: string, configuration: SigningConfiguration, run?: SigningTool): void;
export function signDiskImage(disk: string, configuration: SigningConfiguration, run?: SigningTool): void;
