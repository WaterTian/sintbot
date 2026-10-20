# 安全策略

## 报告漏洞

请**不要**在公开 issue 里报安全问题。用 GitHub 的 [私密漏洞报告](https://github.com/WaterTian/sintbot/security/advisories/new),或发邮件到 support@sintbot.com。

请附上:影响的版本、复现步骤、你判断的影响面。我们会尽快回复。

## 范围

特别关心的几类:

- 群消息或网页内容绕过群的权限档位执行命令(不含「完全访问」档位本来就允许的事);
- 控制台鉴权绕过(局域网密码、公网飞书登录、一次性接管链接);
- 出站消息泄漏配置里的密钥;
- 符号链接等手段绕出项目根目录。

SintBot 的权限模型与已知边界(例如 Bash 没有操作系统级的目录隔离)见 [docs/security.md](./docs/security.md)。
