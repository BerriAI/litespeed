export type FilePreview = {
  path: string;
  kind: 'text' | 'image' | 'pdf';
  mimeType: string;
  size: number;
  content: string;
  revision?: string;
  truncated?: boolean;
};
