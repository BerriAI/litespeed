/** @jsxImportSource @opentui/react */
import { Fragment } from 'react';
import { formatChord, parseBinding } from './keymap.js';
import { KEYBIND_DEFAULTS, LEADER_DEFAULT, type BindingValue } from './keybinds.js';
import { useTheme } from './context.js';
import { toHex } from './theme.js';
import { Button } from './ui.js';

export function shortcutLabel(action:string,bindings:Record<string,BindingValue>):string {
  const binding=parseBinding(bindings[action]??KEYBIND_DEFAULTS[action]??false)[0];
  if(!binding)return 'Unbound';
  const leader=bindings.leader??LEADER_DEFAULT;
  return formatChord(binding.steps,typeof leader==='string'?leader:LEADER_DEFAULT).replace(/\breturn\b/g,'enter').replace(/\b[a-z][a-z0-9]*/g,word=>word[0].toUpperCase()+word.slice(1));
}
export interface FooterAction { id:string; label:string; shortcut:string; onPress:()=>void; disabled?:boolean; optional?:boolean }
export const footerText=(action:FooterAction)=>`${action.label} [${action.shortcut}]`;
const length=(items:FooterAction[])=>items.reduce((n,item)=>n+footerText(item).length+2,Math.max(0,items.length-1));
/** Drop only optional editing help, then wrap whole actions instead of clipping controls. */
export function footerRows(width:number,message:FooterAction[],session:FooterAction[]) {
  if(length(message)+length(session)+2>width)message=message.filter(item=>!item.optional);
  if(length(message)+length(session)+2<=width)return [{message,session}];
  const wrap=(items:FooterAction[])=>{const rows:FooterAction[][]=[];for(const item of items){if(!rows.length||length([...rows.at(-1)!,item])>width)rows.push([]);rows.at(-1)!.push(item);}return rows;};
  return [...wrap(message).map(message=>({message,session:[]})),...wrap(session).map(session=>({message:[],session}))];
}
export function Footer({width,message,session}:{width:number;message:FooterAction[];session:FooterAction[]}) {
  const theme=useTheme(),rows=footerRows(width,message,session);
  const group=(items:FooterAction[])=>items.map((item,index)=><Fragment key={item.id}>{index>0&&<text fg={toHex(theme.textMuted)}>·</text>}<Button tone="muted" disabled={item.disabled} onPress={item.onPress}>{footerText(item)}</Button></Fragment>);
  return <box flexDirection="column" flexShrink={0} height={rows.length}>{rows.map((row,index)=><box key={index} height={1} flexDirection="row" flexShrink={0}>{group(row.message)}<box flexGrow={1}/>{group(row.session)}</box>)}</box>;
}
