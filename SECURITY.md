# Security policy

English · [简体中文](./SECURITY.zh-CN.md)

## Reporting a vulnerability

Please **do not** report security issues in public issues. Use GitHub's [private vulnerability reporting](https://github.com/WaterTian/sintbot/security/advisories/new), or email support@sintbot.com.

Please include:

- the affected version
- steps to reproduce
- the impact as you assess it

We will reply as soon as we can.

## Scope

We are especially interested in:

- group messages or web content that execute commands beyond the group's permission level (excluding what "full access" already allows);
- bypasses of console authentication: the LAN password, public Feishu sign-in, or single-use takeover links;
- outgoing messages that leak secrets from the config;
- escaping the projects folder through symlinks or similar tricks.

For SintBot's permission model and its known limits (for example, Bash has no OS-level directory isolation), see [docs/security.md](./docs/security.md).
