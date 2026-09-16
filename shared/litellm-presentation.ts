/** Labels for host-generated harness context, with its full text kept available. */
export function litellmHarnessNoteTitle(content:string):string|undefined {
  if(content.startsWith('LiteLLM starting locations (automatically retrieved from this workspace).'))return 'LiteLLM code and test map';
  if(content.startsWith('LiteLLM exploration checkpoint:'))return 'LiteLLM investigation checkpoint';
  if(content.startsWith('LiteLLM verification checkpoint:'))return 'LiteLLM test checkpoint';
  if(content.startsWith('LiteLLM change review.'))return 'LiteLLM change review';
}
