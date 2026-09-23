import type { Session } from './types.js';

export type ScheduleTiming =
  | { kind: 'once'; at: number }
  | { kind: 'hourly'; every: number }
  | { kind: 'daily'; time: string; timezone: string }
  | { kind: 'weekly'; time: string; timezone: string; days: number[] };
export type ScheduleSelection = Pick<Session, 'providerId' | 'model' | 'mode' | 'permissionMode'> &
  Partial<Pick<Session, 'architecture' | 'planner' | 'shunt' | 'modelReasoning' | 'outputStyle' | 'commandSandbox'>>;
export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  workspace: string;
  timing: ScheduleTiming;
  selection: ScheduleSelection;
  status: 'active' | 'paused' | 'completed';
  createdAt: number;
  updatedAt: number;
  revision: number;
  nextRunAt: number | null;
}
export type ScheduleRunStatus = 'starting' | 'running' | 'waiting' | 'completed' | 'failed' | 'interrupted' | 'skipped' | 'missed';
export interface ScheduleRun {
  id: string;
  scheduleId: string;
  name: string;
  sessionId: string | null;
  trigger: 'scheduled' | 'manual';
  scheduledAt: number;
  startedAt: number;
  endedAt?: number;
  status: ScheduleRunStatus;
  error?: string;
}
export interface ScheduleList { schedules: ScheduledTask[]; runs: ScheduleRun[]; running: boolean; }

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function scheduleLabel(timing: ScheduleTiming): string {
  if (timing.kind === 'once') return new Date(timing.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  if (timing.kind === 'hourly') return timing.every === 1 ? 'Every hour' : `Every ${timing.every} hours`;
  const [hour, minute] = timing.time.split(':').map(Number);
  const time = new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const days = timing.kind === 'daily' ? 'Every day' : [...timing.days].sort().join() === '1,2,3,4,5' ? 'Weekdays' : [...timing.days].sort().map(day => weekdays[day]).join(', ');
  return `${days} at ${time}`;
}
export const scheduleRunLabels: Record<ScheduleRunStatus, string> = {
  starting: 'Starting', running: 'Working', waiting: 'Needs attention', completed: 'Completed', failed: 'Failed', interrupted: 'Interrupted', skipped: 'Skipped', missed: 'Missed',
};
