import { ChevronRight, Search } from 'lucide-react';

export type SettingsSection = 'providers' | 'general' | 'permissions' | 'integrations' | 'usage' | 'profiles' | 'browser';
export type SettingsSearchEntry = { title: string; section: SettingsSection; target?: string; description: string; keywords: string };
const sections: Record<SettingsSection, string> = { providers: 'Providers', general: 'General', permissions: 'Permissions', integrations: 'Integrations', usage: 'Usage', profiles: 'Project profiles', browser: 'Browser' };
const entries: SettingsSearchEntry[] = [
  { title: 'Provider connection', section: 'providers', target: 'provider-connection', description: 'Provider name, API format and server address.', keywords: 'base url gateway litellm proxy endpoint openai anthropic chatgpt connect' },
  { title: 'API keys and sign-in', section: 'providers', target: 'provider-credentials', description: 'Connect an account or update a provider key.', keywords: 'password credential authentication token account login codex' },
  { title: 'Model IDs', section: 'providers', target: 'provider-models', description: 'Models available through the selected provider.', keywords: 'custom model aliases discovery list' },
  { title: 'Context window limits', section: 'providers', target: 'context-limits', description: 'Set a verified limit for a specific model.', keywords: 'override tokens budget length maximum' },
  { title: 'Claude caching aliases', section: 'providers', target: 'cache-aliases', description: 'Identify gateway models that route to Claude.', keywords: 'anthropic cache prompt cost' },
  { title: 'Workspace folder', section: 'general', target: 'workspace', description: 'The default project for new tasks.', keywords: 'path directory location project files' },
  { title: 'Default provider and model', section: 'general', target: 'defaults', description: 'Starting model choices for new tasks.', keywords: 'new session default model provider' },
  { title: 'Default permissions', section: 'general', target: 'default-permissions', description: 'Choose when Litespeed asks before acting.', keywords: 'ask first auto automatic access allow tools edits commands approval' },
  { title: 'Appearance', section: 'general', target: 'appearance', description: 'Use a light, dark or system theme.', keywords: 'color colour theme mode display' },
  { title: 'Notifications', section: 'general', target: 'notifications', description: 'Get notified when work finishes or needs approval.', keywords: 'alert desktop notification sound response finished' },
  { title: 'Agent memory', section: 'general', target: 'memory', description: 'Enable memory and review, pin or delete recorded facts.', keywords: 'notes remember saved memories forgetting privacy' },
  { title: 'Tool permission rules', section: 'permissions', target: 'permission-rules', description: 'Always ask, allow or deny specific tools and paths.', keywords: 'bash command file access pattern grant' },
  { title: 'Command confinement', section: 'permissions', target: 'command-confinement', description: 'Keep supported commands inside the current task’s workspace.', keywords: 'sandbox shell bash workspace project access' },
  { title: 'Project allow rules', section: 'permissions', target: 'project-allow-rules', description: 'Review or revoke this project’s allowed tools.', keywords: 'permission trust rules project access' },
  { title: 'Project hooks', section: 'permissions', target: 'project-hooks', description: 'Review and enable or disable automatic project commands.', keywords: 'hook trust command startup stop scripts project access' },
  { title: 'Remembered project approvals', section: 'permissions', target: 'project-approvals', description: 'Review or clear tools previously allowed for this project.', keywords: 'remember permission approvals grant revoke reset project access' },
  { title: 'Connected tools', section: 'integrations', target: 'connected-tools', description: 'Configure MCP servers, connections and sign-in.', keywords: 'mcp integration oauth auth connect stdio http sse plugin tools import cache' },
  { title: 'Browser search engine', section: 'browser', target: 'browser-search', description: 'Search with Google, DuckDuckGo or Bing.', keywords: 'address url default search engine' },
  { title: 'Browsing history', section: 'browser', target: 'browser-history', description: 'Remember recent pages and address suggestions.', keywords: 'visited website browsing history privacy saved pages' },
  { title: 'Automatic downloads', section: 'browser', target: 'browser-auto-downloads', description: 'Save a copy when a download finishes.', keywords: 'auto downloads automatically saving files' },
  { title: 'Download folder', section: 'browser', target: 'browser-download-folder', description: 'Choose where browser downloads are saved.', keywords: 'download location directory path destination' },
  { title: 'Clear browser history', section: 'browser', target: 'browser-clear-history', description: 'Remove saved page titles and addresses.', keywords: 'delete forget clear browsing history suggestions privacy' },
  { title: 'Website data', section: 'browser', target: 'browser-data', description: 'Reset this browser’s cookies, storage and website sign-ins.', keywords: 'cookies login sign out clear reset browser profile privacy' },
  { title: 'Token usage', section: 'usage', description: 'Review recorded tokens and requests by model and day.', keywords: 'billing budget cost requests statistics report cache' },
  { title: 'Project profiles', section: 'profiles', description: 'Choose reusable instructions, skills and tool access.', keywords: 'agents prompts instructions skills tools project profile persona' },
];

export function settingsSearch(query: string, includeProfiles: boolean) {
  const terms = query.toLocaleLowerCase().normalize('NFKC').trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return entries.filter(entry => (includeProfiles || entry.section !== 'profiles') && terms.every(term => `${entry.title} ${sections[entry.section]} ${entry.description} ${entry.keywords}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => terms.filter(term => b.title.toLowerCase().includes(term)).length - terms.filter(term => a.title.toLowerCase().includes(term)).length);
}

export function SettingsSearchResults({ query, results, onSelect, onClear }: { query: string; results: SettingsSearchEntry[]; onSelect: (entry: SettingsSearchEntry) => void; onClear: () => void }) {
  return <section className="settings-search-results" aria-label="Settings search results">
    <div className="section-heading"><div><h3>Search settings</h3><p role="status">{results.length ? `${results.length} ${results.length === 1 ? 'result' : 'results'} for “${query.trim()}”` : `No settings found for “${query.trim()}”`}</p></div></div>
    {results.length ? <div className="settings-result-list" onKeyDown={event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return; event.preventDefault();
      const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')], index = buttons.findIndex(button => button === document.activeElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}>{results.map(entry => <button key={entry.title} data-setting-result onClick={() => onSelect(entry)}><span><strong>{entry.title}</strong><small>{entry.description}</small></span><span className="settings-result-section">{sections[entry.section]}</span><ChevronRight size={15} /></button>)}</div> : <div className="settings-search-empty"><Search size={23} /><p>Try a setting such as appearance, downloads or API keys.</p><button className="button secondary" onClick={onClear}>Clear search</button></div>}
  </section>;
}
