import type { PermissionRequest } from './types.js';


export function approvalPresentation(request: PermissionRequest, actor: string) {
  const args = request.args;
  const value = (key: string) => typeof args[key] === 'string' ? args[key] as string : '';
  const path = request.scopePath || value('path');
  switch (request.tool) {
    case 'bash': case 'verify':
      return { title: `${actor} wants to run a command`, target: `In ${value('cwd') || request.workspace || 'workspace'}`, body: value('command') };
    case 'write_file':
      return { title: `${actor} wants to write a file`, target: path, body: value('content') };
    case 'edit_file':
      return { title: `${actor} wants to edit a file`, target: path, body: `Replace${args.replace_all ? ' every match' : ''}:\n${value('old_string')}\nWith:\n${value('new_string')}` };
    case 'read_file':
      return { title: `${actor} wants to read a file`, target: path, body: '' };
    case 'sidekick': case 'delegate': case 'task':
      return { title: `${actor} wants to ${request.tool === 'sidekick' ? 'ask Sidekick' : request.tool === 'task' ? 'start research' : 'assign a worker'}`, target: value('description'), body: value('prompt') };
    case 'todo_write':
      return { title: `${actor} wants to update the task list`, target: '', body: (Array.isArray(args.todos)?args.todos:[]).map(todo=>`${({completed:'✓',in_progress:'●',pending:'○'} as Record<string,string>)[todo.status]??'○'} ${todo.content}`).join('\n') };
    case 'web_fetch':
      return { title: `${actor} wants to fetch a page`, target: value('url'), body: '' };
    default:
      return { title: `${actor} wants to use ${request.tool.replaceAll('_', ' ')}`, target: request.scopePath || '', body: Object.entries(args).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join('\n') || request.description || '' };
  }
}
