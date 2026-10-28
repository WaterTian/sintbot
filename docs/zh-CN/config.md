# 配置

[English](../config.md) · 简体中文

**位置**:按顺序找,先找到哪个用哪个 —— `--config <路径>` > `$SBOT_CONFIG` > 当前目录的 `sbot.config.json` > `~/.sbot/config.json`。`sintbot setup` 新建时写最后那个。`sintbot doctor` 第二行显示实际用的是哪个。

**改了就生效**:守护进程会热重载配置文件,不用重启。日常的绑群、切模型、改权限建议在控制台(`sintbot ui`)里做,它会校验后再写回。

**密钥**:任何密钥字段都可以写 `"env:变量名"`,从环境变量读。常驻服务里没有你 shell 的变量:`sintbot service install` 会把这些值写进服务定义(见 [install.md](./install.md#3-常驻sintbot-service-install))。

带完整注释的示例:[sbot.config.example.json](../../sbot.config.example.json)(`_` 开头的键是注释,程序忽略)。

## 顶层

| 键 | 说明 |
|---|---|
| `providers` / `defaultProvider` | 模型,见 [models.md](./models.md) |
| `feishu` / `slack` / `wecom` | 聊天平台,配了哪个接哪个,可以同时配。见 [platforms/](./platforms/) |
| `groups` | 群 → 项目,见下 |
| `projectsRoots` | 项目根目录(字符串或数组,认 `~`;默认 `~/Projects`)。控制台只允许绑定这里面的目录 |
| `agent` | `maxTurnTimeMins`(单轮墙钟上限,默认 30)· `maxConcurrent`(全局同时跑几轮,默认 2)· `autocompactTokens`(会话超过多少 token 自动压缩,默认 40 万,0 = 关)· `bin`(claude 可执行名)。示例里的 `agent.permissionMode` 不起作用(doctor 里那一行显示的也是它)—— 执行模式按群设,见下 |
| `proxy` | `{ http, https, noProxy }`:代理分流,见 [install.md](./install.md#代理) |
| `timezone` | 产品时区(IANA 名,默认 `Asia/Shanghai`):消息时间戳、定时任务、控制台时钟都按它,与主机时区无关 |
| `brand` | 机器人在群里的名字(默认 SintBot) |
| `alerts` | `{ chatId }`:运维告警群(不要绑项目) |
| `ui` | 控制台:`publicUrl`(公网入口,见 [PUBLIC-ACCESS.md](./PUBLIC-ACCESS.md))· `auth`(由 `sintbot ui --set-password` 写入) |
| `preview` | 群预览服务:端口段、闲置回收、监听地址,见 [PREVIEW.md](./PREVIEW.md) |
| `browser` | `{ cdpUrl, takeoverMinutes }`:常驻浏览器地址与接管链接时效,见 [BROWSER.md](./BROWSER.md) |
| `instance` | 这台机器在反馈本里怎么自称(多台机器汇总时区分用) |

## 群

```jsonc
"groups": {
  "oc_xxxxxxxx": {                        // 群 / 频道 id
    "workdir": "/Users/me/Projects/app",  // 项目目录(绝对路径)
    "provider": "claude",                 // 不写 = defaultProvider
    "platform": "feishu",                 // feishu | slack | wecom;能从 id 形态认出时可省
    "permissionMode": "dontAsk",          // dontAsk(默认,白名单外自动拒)| bypassPermissions(全放行)
    "allowedTools": ["Read", "Grep", "Glob", "Edit", "Write", "Bash(npm *)"],
    "disallowedTools": [],
    "plugins": { "mcp": ["chrome-devtools"] },  // 可选:按群启用用户级 MCP(写了就严格只加载这些 + 项目自带的)
    "redactPii": true,                    // 出站遮手机号 / 邮箱(默认开)
    "paused": false                       // 暂停:不处理消息、不跑定时任务、不播报
  }
}
```

权限的含义与风险见 [security.md](./security.md)。控制台「群 · 项目」卡上的三档预设(只读 / 开发 / 全信任)就是在填 `allowedTools` / `disallowedTools`。
