# Litespeed 0.1.16

LiteFusion now connects its specialists automatically, including in existing sessions that were missing saved model connections.

- Connect your gateway and start chatting. The backend discovers matching model identities, keeps explicit choices, and resolves each task to its default model or configured escalation route. If neither is connected, the lead handles the task with a visible explanation.
- Both the terminal and web UI show specialist task coverage, backup usage, and work left to the lead. A gateway with no specialist connections or only the lead model is labeled clearly. First-time setup keeps the detailed roster behind “View model assignments.”
- New setups prefer Opus/high, then Astra/high when supported and listed. If neither is listed, choose your lead once. Existing leads and custom task assignments are preserved.
- Substantial research, implementation, testing and review now default to coherent delegation after brief scoping. Small tasks can stay with the lead. There is no forced worker quota or extra classifier call.
- Discovery is cached and does not run paid probes. Automatic connection repair does not queue an architecture change. Active turns keep their model assignments; explicit model edits show “Model settings updated” and apply after the turn.

Run `litespeed update`, then reopen Litespeed. Existing LiteFusion sessions discover missing connections automatically; no reset or manual session repair is needed.

Gateway listings do not verify credits, tool support or performance. The routing roster remains a research policy awaiting independent evaluation. Local checks use fake gateways and do not benchmark commercial models.

Packages include the terminal runtime and web app for Apple silicon and Intel Macs.
