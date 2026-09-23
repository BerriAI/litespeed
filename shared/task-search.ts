export type TaskSearchQuery = { query: string; project?: string; includeArchived?: boolean };
export type TaskSearchItem = { id: string; title: string; project: string; updatedAt: number; archived: boolean; messageId?: string; role?: 'user' | 'assistant'; snippet?: string };
export type TaskSearchResult = { items: TaskSearchItem[]; projects: string[]; more: boolean; indexing: boolean };
