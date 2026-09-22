# Litespeed 0.1.23

Start with a ready-to-use Sidekick Fusion setup. Connect your gateway and review the selected models immediately.

- New setups choose the latest available Astra driver and Sol sidekick, with Shunt off.
- Driver fallbacks: Astra → Fable → Opus → Sol. Sidekick fallbacks: Sol → Opus → Sonnet. Each role chooses the latest available version within the first matching family.
- A gateway with Fable 5.1 and Opus 5.5, but no Astra or Sol, automatically gets Fable 5.1 as driver and Opus 5.5 as sidekick. If none of the supported families are available, setup asks you to choose a model.
- All choices remain editable. Reopening setup shows your saved configuration.
- Gateway discovery includes available family routes omitted from LiteLLM's standard model list. Sol 6 uses the Responses API for streaming, reasoning, tool calls, and tool-result continuation.
- Includes v0.1.22's **Allow all tools** permission option in setup and live approval prompts.

Run `litespeed update`, then reopen Litespeed. Use `/setup` to review or edit your saved choices.

Includes bundled runtimes and the web/terminal apps for Apple silicon and Intel Macs.
