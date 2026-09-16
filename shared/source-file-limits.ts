/** The two LiteLLM price maps already exceed the ordinary 2 MiB source limit.
 * Keep their bounded edit, history and restore limits consistent. Match exact
 * workspace-relative paths so similarly named files elsewhere keep the default.
 * This is a size allowance only; ordinary path and permission checks still run.
 */
export function sourceFileByteLimit(relativePath:string, ordinaryLimit:number):number {
  return relativePath==='model_prices_and_context_window.json'||relativePath==='litellm/model_prices_and_context_window_backup.json'
    ? Math.min(4*1024*1024,ordinaryLimit*2) : ordinaryLimit;
}
