# Install and start using SintBot with an AI assistant

[简体中文](./zh-CN/AI-ASSISTED-INSTALL.md) · English

An AI assistant can install SintBot only if it can use a **local terminal on the computer where SintBot will run**. A chat-only session or cloud shell cannot install it on your Mac. If the assistant cannot reach that terminal, run the install command in Terminal on the target computer, then ask the assistant to continue with verification.

The one-line installer supports macOS and Linux (Linux support is experimental). Windows users should follow the [manual install steps](./install.md#windows).

## Shortest path

1. **Inspect first.** Check the target OS, Node version, installed SintBot version and service state. Do not read or print configuration or credentials.
2. **Pick the right path.** For a fresh install, download the official installer to a temporary file, inspect it, and run its no-change preview; execute that same file after approval. For an upgrade, update only the package; do not repeat model setup or its trial. Restarting a running service can announce the upgrade to connected groups.
3. **Confirm once.** Before changing anything, give one short summary of Homebrew Node changes, the required Claude Code CLI if missing, the selected model and possible trial charge, and whether the background service will be installed or restarted. Ask only for choices that are still needed. After approval, answer installer prompts using those choices; do not ask for the same approval again. Stop and ask if an unexpected change appears.
4. **Run locally.** Use the target computer's interactive terminal. Let the user sign in themselves and type API keys directly at SintBot's masked terminal prompt. Never copy credentials into chat or the agent transcript, and do not use `sudo`.
5. **Complete the first use.** Check the version, health and service state. In the console, follow **Get started**: confirm a usable model, connect a chat platform if needed, bind one group to one project folder, then send a read-only test request. To test a model before connecting a platform, use **Playground**.

If the user needs to create or approve a chat-platform app, guide them with the relevant [platform setup guide](./platforms/). The user enters credentials directly in the local console. Ask for only the next decision needed; do not make them repeat information already provided.

## If the assistant cannot use a local terminal

Do not run a real installation on another computer or in a cloud shell. A no-change `--dry-run` preview is fine, but without an interactive terminal a real install stops when Node 22+ is missing; if Node is present, it may install only the package and report incomplete setup. Have the user run the [one-line install](./install.md#one-line-install) on the target computer, then continue verification.

## Copyable request

```text
Help me install or upgrade SintBot on this computer and get through the first use. Use only the local terminal on the computer where it will run. First check the OS, Node version, SintBot version and service state; do not read configuration or credentials.

For a fresh install, download the official installer to a temporary file, inspect it and run its no-change preview; execute that same file after approval. For an upgrade, update only the package; do not rerun model setup or its trial. Before changes, give me one concise summary covering Node / Claude Code installs, model choice and possible trial cost, and background-service install or restart (including any group notice). Ask once for the decisions needed. After I approve, answer matching installer prompts from my choices without asking again; stop if a new change is required.

Use the target computer's interactive terminal. I will sign in and type any API key directly at the masked local prompt; never put credentials in chat. Do not use sudo or reset existing data. After installation, verify the version, health and service state, then guide me through the console's Get started steps. We can use Playground first, or connect a platform, bind one group to one project and send a read-only test. Ask only for the next required choice; stop on errors and explain the cause.
```

## Give an AI agent a clear task

For coding work, include the goal, acceptance criteria and constraints. For example:

```text
Goal: …
Done means: …
Constraints: …

Read the project's instructions and current state first. If the request is clear, proceed; ask only when a missing fact blocks the work. Finish with a short summary of changes, checks and anything still open.
```
