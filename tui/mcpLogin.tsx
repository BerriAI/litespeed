/** @jsxImportSource @opentui/react */
import { useEffect, useState } from 'react';
import { useRenderer } from '@opentui/react';
import { spawn } from 'node:child_process';
import type { McpLoginStart, McpLoginStatus } from '../shared/mcp.js';
import type { TerminalController } from './controller.js';
import { copyTerminalText } from './clipboard.js';
import { Menu } from './ui.js';

export function McpLoginScreen({ controller, name, login, onClose }: { controller: TerminalController; name: string; login: McpLoginStart; onClose(): void }) {
  const renderer = useRenderer(), [status, setStatus] = useState<McpLoginStatus>({ status: 'pending' });
  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await controller.client.api<McpLoginStatus>(`/mcp/login/${login.loginId}`);
        if (!live) return;
        setStatus(next); if (next.status === 'pending') timer = setTimeout(poll, 1500);
      } catch { if (live) setStatus({ status: 'error', error: 'Could not check sign-in. Return and try again.' }); }
    };
    void poll(); return () => { live = false; clearTimeout(timer); };
  }, [controller, login.loginId]);
  const close = async () => {
    try { await controller.client.api(`/mcp/login/${login.loginId}`, undefined, 'DELETE'); onClose(); }
    catch { setStatus({ status: 'error', error: 'Could not cancel sign-in. Try again.' }); }
  };
  const open = () => {
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(command, [login.url], { stdio: 'ignore', shell: false });
    child.once('error', () => controller.notice('Could not open a browser. Copy the sign-in link instead.'));
  };
  return <Menu title={`Sign in · ${name}`} search={false} onClose={() => void close()} header={status.status === 'complete' ? 'Signed in. Return to the integration and choose Reconnect to load tools.' : status.error || 'Complete sign-in in your browser. This link expires in 10 minutes.'} items={[
    ...(status.status === 'pending' ? [
      { id: 'open', label: 'Open sign-in in browser', action: open },
      { id: 'copy', label: 'Copy sign-in link', action: () => { void copyTerminalText(renderer, login.url).catch(() => controller.notice('Could not copy the sign-in link.')); } },
    ] : []),
    { id: 'back', label: status.status === 'pending' ? 'Cancel sign-in' : 'Return to integration', action: () => void close() },
  ]} />;
}
