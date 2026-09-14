import type { LiteFusionCapability } from '../shared/litefusion.js';
import type { ToolDefinition } from '../shared/types.js';

/** Discovery observes the actual advertised tool catalog. It grants no tool
 * permission and makes no claim about hardware, credentials, or live success. */
export function liteFusionEnvironment(definitions:readonly ToolDefinition[]) {
  const names=(pattern:RegExp)=>definitions.filter(tool=>pattern.test(`${tool.function.name} ${tool.function.description??''}`)).map(tool=>tool.function.name);
  const evidence:Record<LiteFusionCapability,string[]>={
    connected_tools:definitions.map(tool=>tool.function.name),
    browser:names(/\b(browser|playwright|puppeteer|selenium)\b|browser_/i),
    desktop:names(/\b(desktop|screen|accessibility|computer use)\b|screenshot|computer_/i),
    pdf:names(/\bpdf\b|pdf_/i),
    gpu:names(/\b(gpu|cuda|rocm)\b/i),
  };
  return {evidence,capabilities:(Object.keys(evidence) as LiteFusionCapability[]).filter(key=>evidence[key].length),note:'Detected from connected tool metadata; runtime permissions and availability still apply. GPU hardware and local PDF tooling are not inferred from a checkbox.'};
}
