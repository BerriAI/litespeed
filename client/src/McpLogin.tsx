import { useEffect, useRef, useState } from 'react';
import type { McpLoginStart, McpLoginStatus } from '../../shared/mcp';
import { api } from './api';

export function McpLogin({ login, onClose, onReconnect, onComplete, disabled }: { login: McpLoginStart; onClose(): void; onReconnect(): void; onComplete(): Promise<void>; disabled: boolean }) {
  const complete = useRef(onComplete); complete.current = onComplete;
  const [status, setStatus] = useState<McpLoginStatus>({ status: 'pending' });
  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await api<McpLoginStatus>(`/mcp/login/${login.loginId}`);
        if (!live) return;
        if (next.status === 'complete') await complete.current();
        if (!live) return;
        setStatus(next);
        if (next.status === 'pending') timer = setTimeout(poll, 1500);
      } catch { if (live) setStatus({ status: 'error', error: 'Could not check sign-in. Close this panel and try again.' }); }
    };
    void poll(); return () => { live = false; clearTimeout(timer); };
  }, [login.loginId]);
  async function close() {
    try { await api(`/mcp/login/${login.loginId}`, { method: 'DELETE' }); onClose(); }
    catch { setStatus({ status: 'error', error: 'Could not cancel sign-in. Try closing this panel again.' }); }
  }
  return <div className="auth-card" aria-label="MCP sign-in">
    {status.status === 'pending' && <><a href={login.url} target="_blank" rel="noopener noreferrer">Continue sign-in in your browser ↗</a><p role="status">Waiting for sign-in…</p></>}
    {status.status === 'complete' && <><p role="status">Signed in. Reconnect to load your tools.</p><button className="button primary" disabled={disabled} onClick={() => { onReconnect(); onClose(); }}>Reconnect</button></>}
    {status.status === 'error' && <p role="alert">{status.error}</p>}
    <button className="text-button" onClick={() => void close()}>{status.status === 'pending' ? 'Cancel sign-in' : 'Close sign-in'}</button>
  </div>;
}
