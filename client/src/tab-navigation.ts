import type { KeyboardEvent } from 'react';

/** The standard arrow-key interaction for a horizontal tab list. */
export function navigateTabs(event: KeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const current = (event.target as HTMLElement).closest('[role="tab"]');
  if (!current) return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')];
  const index = tabs.indexOf(current as HTMLButtonElement);
  if (index < 0 || !tabs.length) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus(); tabs[next].click();
}
