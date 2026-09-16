# Navigation query breadth: rejected local probes

These read-only development probes used 20 previously inspected training cases, each at its recorded pre-merge checkout. The query was the first 1,000 characters of the curated task. We compared surfaced source paths with the human reference's changed source paths and suggested tests with the original selected test files. Those are descriptive overlap counts, not required-file recall: reference changes can add new files absent from the starting checkout, alternative fixes can touch different files, and the selected tests are not exhaustive. Counts neither establish solver correctness nor held-out generalization.

The baseline is production v34. Two uncommitted experimental variants were tried sequentially on the same desktop:

- **Expanded ranking:** raise scoring terms from 24 to 96; recognize policy/pipeline terms as proxy areas; exclude top-level Python files from provider-directory discovery. Source overlap rose from 28/53 to 30/53, while selected-test overlap fell from 17/49 to 15/49. Bedrock and background retrieval improved, but MCP and streaming lost useful files. Median local lookup time rose from about 167 to 440 ms; shared-host/cache effects prevent a causal timing claim.
- **Expanded areas:** use the complete bounded query for choosing search areas while retaining the original 24 scoring terms. This still displaced streaming results under the 800-file scan and 12-result limits. Extra areas can change which files are scanned and which symbols survive global ranking, even when scoring terms stay unchanged.

Both variants are rejected for promotion and have no paid solver comparison. Patches, per-case measurements and queries are retained. The production source remains unchanged. The probes motivate preserving initial useful results and exposing unsearched areas separately, rather than simply broadening every scan. No next candidate is selected by these counts alone.

With the qualified training snapshots prepared, run `node --import tsx scripts/litellm-harness/studies/navigation-query/audit.mts /path/to/campaign /path/to/output.json` from the runtime checkout being measured. Apply one candidate patch in an isolated copy for that comparison. The script returns paths and aggregate metadata; it does not publish source text or invoke a model.
