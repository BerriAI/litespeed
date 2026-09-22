# Litespeed 0.1.22

Enable **Allow all tools** directly from an approval prompt and keep the task moving.

- Terminal approval prompts now offer **5 Allow all tools**. Browser approval cards expose the same action. It resumes pending actions and applies to the session and its workers across turns and restarts.
- Permissions use the same **Allow all tools** label throughout the app, replacing **Full access**. Remembering one tool or path remains a separate scoped choice.
- Quick setup now shows Permissions in both clients. Select **Allow all tools** and save to use it for new sessions in this project. Terminal setup offers an explicit three-mode picker.
- Explicit ask/deny rules, Plan mode, and profile restrictions still apply.
- Includes the terminal clipboard image display fixes already merged on main.

Run `litespeed update`, then reopen Litespeed. For the current session, open `/permissions` and select **Allow all tools**, or press **5** when a routine approval appears. To save a project default, use `/setup` → **Permissions** → **Allow all tools**, then save the setup.

Includes bundled runtimes and the web/terminal apps for Apple silicon and Intel Macs.
