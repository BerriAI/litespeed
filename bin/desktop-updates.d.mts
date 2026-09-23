import type { UpdateStatus } from '../shared/updates.js';
export interface DesktopRelease { schema: 1; version: string; build: number; platform: string; tag?: string; asset: {file: string; size: number; sha256: string}; }
export interface DesktopInstallation { app: string; root: string; release: { schema: 1; version: string; build: number; platform: string }; }
export interface DesktopHandoff { version: string; build: number; commit(): Promise<void>; cancel(): Promise<void>; complete(): Promise<void>; }
export function desktopNewer(a: {version: string; build: number}, b: {version: string; build: number}): boolean;
export function desktopManifest(value: unknown, platform?: string): DesktopRelease;
export function latestDesktop(): Promise<DesktopRelease | undefined>;
export function desktopInstallation(root: string): Promise<DesktopInstallation | null>;
export function desktopUpdateInProgress(directory: string, ownId?: string): Promise<boolean>;
export function validateDesktopTree(root: string): Promise<void>;
export function validateDesktopBundle(app: string, release: DesktopRelease): Promise<void>;
export function unpackDesktopUpdate(archive: string, destination: string, release: DesktopRelease): Promise<string>;
export function desktopUpdateService(options: {installation: DesktopInstallation; directory: string; fetchLatest?: () => Promise<DesktopRelease | undefined>; download?: (release: DesktopRelease, destination: string) => Promise<void>; validate?: typeof validateDesktopBundle}): {status(force?: boolean): Promise<UpdateStatus>; install(): Promise<UpdateStatus>; prepareRestart(input: {appPid?: number; base: string; storeId: string}): Promise<DesktopHandoff>};
