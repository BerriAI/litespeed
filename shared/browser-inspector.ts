import { z } from 'zod';

export type BrowserElementRegion = { x: number; y: number; width: number; height: number };
export type BrowserStyleChanges = {
  text?: string; fontFamily?: 'system-ui' | 'Arial' | 'Georgia' | 'monospace'; fontSize?: number; fontWeight?: number;
  lineHeight?: number; color?: string; backgroundColor?: string; padding?: number; margin?: number; borderRadius?: number;
};
export type BrowserInspectedElement = {
  id: string; tag: string; selector: string; text: string; editableText: boolean; region: BrowserElementRegion;
  styles: { fontFamily: string; fontSize: string; fontWeight: string; lineHeight: string; color: string; backgroundColor: string; padding: string; margin: string; borderRadius: string };
};
export type BrowserInspectorResult = {
  element?: BrowserInspectedElement; image: string; url: string; title: string; width: number; height: number; capturedAt: number;
};

const color = z.string().regex(/^#[a-f0-9]{6}$/i);
export const browserStyleChangesSchema = z.object({
  text: z.string().max(2000).optional(), fontFamily: z.enum(['system-ui', 'Arial', 'Georgia', 'monospace']).optional(),
  fontSize: z.number().min(6).max(200).optional(), fontWeight: z.number().int().min(100).max(900).multipleOf(100).optional(),
  lineHeight: z.number().min(0.7).max(4).optional(), color: color.optional(), backgroundColor: z.union([color, z.literal('transparent')]).optional(),
  padding: z.number().min(0).max(160).optional(), margin: z.number().min(0).max(160).optional(), borderRadius: z.number().min(0).max(200).optional(),
}).strict();
const regionSchema = z.object({ x: z.number().min(0).max(1280), y: z.number().min(0).max(1200), width: z.number().min(0).max(1280), height: z.number().min(0).max(1200) }).strict();
export const browserInspectedElementSchema = z.object({
  id: z.string().uuid(), tag: z.string().max(100), selector: z.string().max(1000), text: z.string().max(2000), editableText: z.boolean(), region: regionSchema,
  styles: z.object({ fontFamily: z.string().max(500), fontSize: z.string().max(100), fontWeight: z.string().max(100), lineHeight: z.string().max(100), color: z.string().max(100), backgroundColor: z.string().max(100), padding: z.string().max(100), margin: z.string().max(100), borderRadius: z.string().max(100) }).strict(),
}).strict();

// Draft number fields may briefly be outside the preview limits while typing.
export const browserStyleDraftSchema = browserStyleChangesSchema.extend({ fontSize: z.number().optional(), fontWeight: z.number().optional(), lineHeight: z.number().optional(), padding: z.number().optional(), margin: z.number().optional(), borderRadius: z.number().optional() });
