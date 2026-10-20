# 安装

[English](../install.md) · 简体中文

新用户用[一键安装](#一键安装)最省事;手动装就是三步:装包 → `sintbot setup` → `sintbot service install`。下面按平台补充细节。

## 一键安装

macOS / Linux(Linux 为实验性支持):

```bash
curl -fsSL https://sintbot.com/install.sh | bash
```

脚本依次做这些事,每一步先检查、已经有的跳过,要改系统的先问你(回车 = 同意):

1. **Node 22+**:没有或版本太旧时,Mac 上有 Homebrew 就用它装 / 升级;没有 Homebrew(或在 Linux 上)会给出 [nodejs.org](https://nodejs.org) 的下载地址后停下,装好 Node 再运行一次脚本。
2. **npm 源**:你配过 npm 源就照用;还是官方源时先试连一下,连不上(国内常见)本次改用国内镜像 `registry.npmmirror.com`。
3. **装 sintbot**:`npm i -g sintbot`。npm 全局目录没有写权限时不会用 sudo,而是给出改装到用户目录的命令。
4. **配置向导** `sintbot setup`:第一步检查 Claude Code,没装会问要不要现在装(见下一节);之后是地区、模型(当场试跑一轮)、聊天平台、项目根目录、第一个群。**先按 [platforms/](./platforms/) 建好机器人、拉进群**,向导里才有凭据可填。
5. **常驻服务**:问要不要 `sintbot service install`(崩溃自动拉起、登录后自启)。

- 想先看看它会做什么:`curl -fsSL https://sintbot.com/install.sh | bash -s -- --dry-run`(只打印,不执行);脚本源码就是仓库根目录的 [install.sh](../../install.sh)。
- 没有可交互的终端时(如 CI),向导和常驻服务这两步会跳过,只装包。
- Windows 不支持一键安装,按下面手动来。

## Claude Code:安装与登录

SintBot 每一轮都调用本机的 `claude` 命令行干活(Codex 群调用 `codex`),所以这台机器上要有 Claude Code —— 用 DeepSeek 等模型时也一样,它是执行框架,只是不用登录。

**安装**,任选一种:

- 让向导装:`sintbot setup` 第一步发现没装会问「现在安装 Claude Code?」,回车就装(就是下一条的 npm 命令,源连不上会自动换镜像)。
- npm:`npm i -g @anthropic-ai/claude-code`(国内连不上官方源时加 `--registry https://registry.npmmirror.com`)。
- 官方安装程序:见 [Claude Code 安装说明](https://code.claude.com/docs/zh-CN/setup)。

装好后 `claude --version` 能打出版本号即可。升级用 `claude update`(npm 装的也可以 `npm i -g @anthropic-ai/claude-code@latest`)。

**认证**,按要用的模型选一种:

| 要用的模型 | 怎么做 |
|---|---|
| DeepSeek / 智谱 GLM / MiniMax / 火山方舟等(用 API key) | **不用登录**,装好即可;key 在向导里粘贴,见 [models.md](./models.md#三步接上-deepseek-等模型) |
| Claude,用订阅(Pro / Max) | 终端跑 `claude auth login`,在打开的浏览器里登录;`claude auth status` 查看是否已登录 |
| Claude,用 Anthropic API key(按量计费) | `claude auth login --console`;或把 `ANTHROPIC_API_KEY` 放进守护进程的环境 |

- 没有屏幕的机器(如当服务器用的 Mac mini):用屏幕共享(`vnc://机器IP`)进桌面跑一次 `claude auth login`,登录态落盘后无人值守也能用。
- 用个人订阅服务多人群聊的条款问题,见 [中文 README](../../README.zh-CN.md#安全须知)的「安全须知」。
- 验证:`claude --version` → `claude auth status`(用订阅时)→ `sintbot agent run "用一句话自我介绍"`(先在终端试一轮,只读)。

## 前置

| 要求 | 检查 | 说明 |
|---|---|---|
| Node ≥ 22 | `node -v` | 当前 LTS 即可(浏览器接管页要用 Node 自带的 WebSocket) |
| Claude Code | `claude --version` | 可以让 `sintbot setup` 替你装;安装与登录见上一节。只用 DeepSeek 等 API key 模型的话装了不登录也行 |
| Codex CLI(可选) | `codex --version` | 有 ChatGPT 账号才用得上:GPT 群与生图。`npm i -g @openai/codex` 后 `codex login`(浏览器 OAuth,要图形界面) |

`sintbot setup` 第一步会检查这三样:缺 Claude Code 会问要不要现在装(默认装),缺 Codex 也会问(默认不装);两者的登录状态在模型那一步一起显示。

## 1. 装包

```bash
npm i -g sintbot
sintbot version
```

包名是 **`sintbot`**(npm 上叫 `sbot` 的是别人的包,别装错)。装出两个同义命令:`sbot` 和 `sintbot`。

> ⚠ 同一台机器同时有 Homebrew 的 node 和 nvm 的 node 时,`npm i -g` 装进的是**当前 shell 那份**。常驻服务用的是装服务那一刻的 node(`sintbot service install` 会把路径写进服务),两者对不上就会出现「升级了但跑的还是旧版」。用 `sintbot service install --dry-run` 看服务里写的是哪个 node。

从源码跑:

```bash
git clone https://github.com/WaterTian/sintbot.git && cd sintbot
npm install
npm link            # 可选:把 sbot 命令链到全局
```

## 2. 配置:`sintbot setup`

交互式向导,回车即默认(方括号里的值,`(Y/n)` 大写的那个)。**开始前先按 [platforms/](./platforms/) 把机器人建好、拉进一个群**,向导里才有凭据可填、有群可绑。依次问:

1. **地区**:「这台机器在中国大陆吗?」(默认按系统时区猜)。决定有国际站的厂商连哪个站、要不要问代理、聊天平台推荐哪个
2. **模型**:先显示 Claude 订阅、ChatGPT(Codex)的登录状态和已有 key 的模型,按这个顺序推荐:
   - Claude 已登录 → 默认 Claude;否则 Codex 已登录 → 默认 Codex。此时只问要不要再加一个用 API key 的模型
   - 都没有 → **推荐 DeepSeek**:告诉你去 platform.deepseek.com 拿 key,粘贴后**当场试跑一轮**。也可以选别家(智谱 GLM / MiniMax / 火山方舟)、另开终端登录 Claude 或 Codex 后回来重新检测,或先跳过
   - 智谱 GLM、MiniMax 有国际站(Z.ai / minimax.io),会问 key 是哪个站开的 —— 选错会 401
   - 试跑失败会说原因:key 不对、余额不足或没实名、连不上(是不是开着全局代理)、模型名不对;可以重新粘贴再试
   - 有多个能用的模型时问默认用哪个(群里 `/model` 随时切);默认模型还没试跑过会问要不要试一轮
   - 没装或没登录 codex 时,codex 预设和「额度用完自动切到 codex」不写进配置。Kimi 不在预设里,要在控制台「模型 · 库 → 添加模型 → 自定义」添加。见 [models.md](./models.md)
   - **代理分流**:只有在中国大陆、且用到 Claude / ChatGPT 时才问。官方 Claude / ChatGPT 走代理,国内模型端点与飞书直连;`noProxy` 按你启用的 provider 自动生成
3. **机器人名**:群里怎么称呼它(默认 SintBot)
4. **聊天平台**:飞书 / Slack / 企业微信,空格分隔可多选(默认 `feishu`,在中国大陆推荐飞书;`none` = 先不接)。每个平台填完凭据会问**要不要预检**,默认是 —— 预检会用你填的凭据真连一次平台接口(飞书还会顺手填上 `botOpenId`;选否就让你手填,可留空,留空的后果见 [feishu.md](./platforms/feishu.md))。飞书另问要不要配管理员(建群时自动拉入)
5. **项目根目录**:群项目都放这里面(默认 `~/Projects`,多个用 `;` 分隔,不存在会问要不要创建),控制台只认这里面的目录
6. **绑第一个群**(可选,默认否):选平台 → 选群(飞书会用凭据调接口列出机器人所在的群,拉不到就手填群 ID;企业微信要先在群里 @ 过机器人,或者先跳过、之后在控制台选)→ 填项目目录(不存在会问要不要创建)→ 选模型

配置写到 `~/.sbot/config.json`(权限 600);当前目录已有 `sbot.config.json` 时更新那份。再跑一次 `sintbot setup` 只补缺项,不动已填的(飞书预检每次都会再问,可以借此补上 `botOpenId`)。之后的日常改动(绑群、切模型、权限)在控制台里做:`sintbot ui`。

向导最后自动跑 `sintbot doctor`。✗(失败)必须处理,!(警告)看内容。

## 3. 常驻:`sintbot service install`

```bash
sintbot service install                      # 写入并启动服务
sintbot service install --ui-host 0.0.0.0    # 控制台对局域网开放(先 sintbot ui --set-password)
sintbot service status | restart | logs | uninstall
```

- **macOS**:写 `~/Library/LaunchAgents/com.sbot.daemon.plist`(LaunchAgent,随用户登录启动,崩溃 15 秒后拉起)
- **Linux**(实验性:1.0 只用单元测试核对过生成的单元文件,没在真机上装过):写 `~/.config/systemd/user/sbot.service`;要开机就起(不必先登录)再跑一次 `loginctl enable-linger $USER`
- 日志:`~/.sbot/logs/err.log`(`sintbot service logs` 看末尾)
- 服务里固定的是:node 的路径、sbot 入口、配置文件绝对路径,以及当前 shell 的 PATH(`claude` / `codex` 所在目录排最前)。**换了 node、挪了配置、新装了 claude 之后,重跑一次 `sintbot service install`**
- node 路径:Homebrew 装的 node 实际在带版本号的目录里,升级后旧路径就没了 —— install 会换成指向同一个程序、不带版本号的路径(如 `/opt/homebrew/bin/node`)。nvm / volta 这类找不到稳定路径的照用原路径,并提醒你换 node 版本后重装服务
- 环境变量:服务里**没有**你 shell 里的变量。配置里写了 `"env:变量名"` 的,install 会点名哪些在服务里拿不到;加 `--pass-env` 把这些值写进服务定义(文件权限设为 600,`--dry-run` 打印时值是遮住的),或者干脆在配置里填明文(配置文件本身就是 600)
- 控制台对外(`--ui-host` 非本机地址)而没设密码时,install 直接拒绝 —— 否则服务每次一启动就退出
- ⚠ 装了服务就别再手动 `sintbot start`:同一个系统用户只允许一个守护进程(锁文件 `~/.sbot/daemon.lock`),第二个会报出已在运行的那个的 pid 后退出。另一台机器或另一个系统用户用**同一个机器人应用**再起一个的话:飞书和 Slack 会把每条消息**随机交给其中一个连接**(另一个就收不到),企业微信则是新连接顶掉旧连接,10 分钟内被顶两次就不再重连

### 升级

```bash
npm i -g sintbot@latest && sintbot service restart
```

重启会中止正在跑的轮次;被中止的那一轮在重启后自动重做,群里会说一声。最稳妥的做法是挑控制台「概览」里各群都空闲的时候重启。

## macOS:当服务器用的 Mac mini

无人值守要满足:不休眠、断电自恢复、重启后自动进桌面。

```bash
sudo pmset -a sleep 0 disablesleep 1 autorestart 1 powernap 0
```

再到「系统设置 → 用户与群组」打开**自动登录**。LaunchAgent 要有用户会话才会启动(它要读 `~/.claude` / `~/.codex` 的登录态和钥匙串),不开自动登录,重启后服务不会起来。

`codex login` 要浏览器:用屏幕共享(`vnc://机器IP`)进桌面做一次,凭据落盘后无人值守也能用。

## Windows

> 1.0 没有在 Windows 真机上验证过(持续集成只跑 Linux)。下面几条按代码行为写成,遇到问题请提 issue。

- `claude` 若是 npm 装的,实际是 `claude.cmd` 垫片 —— 已自动处理,配置里写 `claude` 即可
- 服务化:`sintbot service install` 在 Windows 上不自动装,而是打印 [NSSM](https://nssm.cc/) 与 pm2 的现成命令,照着执行即可。用 NSSM 时,API key 和代理变量要用 `nssm set SintBot AppEnvironmentExtra …` 带进服务环境
- 项目根目录默认 `D:\Projects`(没有 D 盘则 `%USERPROFILE%\Projects`)

## 代理

在中国大陆:官方 Claude、ChatGPT / Codex、Slack 要走代理,国内模型端点、飞书、企业微信直连。setup 里开「代理分流」后,配置里的 `proxy` 块会:

- 注入到每次 spawn 的 `claude` / `codex` 子进程(不覆盖 shell 里已有的值);
- 也用于守护进程自己连 Slack(Node 的 `fetch` / WebSocket 不读 `HTTP_PROXY` 环境变量,所以单独处理)。

**国内模型端点要直连**:DeepSeek、智谱、MiniMax、火山方舟绕到境外再连回来,既慢,也可能触发对方的风控。setup 开代理分流时,`noProxy` 会按你启用的 provider 自动生成;如果是自己在 shell 里配的代理,把这些域名加进 `NO_PROXY`:

```bash
export NO_PROXY=api.deepseek.com,open.bigmodel.cn,api.minimaxi.com,ark.cn-beijing.volces.com,localhost,127.0.0.1
```

验证代理通没通:`curl -I https://chatgpt.com/` 返回 403 就是通了(Cloudflare 拦裸 curl);超时或连接被拒才是不通。

## 常见问题

| 现象 | 原因与做法 |
|---|---|
| 体检或群里报「未登录」/ `Not logged in` | 默认模型还是 `claude`,但这台机器没登录 Claude。只用 DeepSeek 等:重跑 `sintbot setup` 选模型,或群里 `/model deepseek`、控制台给群换模型;要用 Claude 就跑 `claude auth login` |
| 试跑报「key 不对」(401) | key 没复制完整,或 key 和站点不是同一个(智谱 / MiniMax 的中国站与国际站互不通用)。重跑 `sintbot setup` 重新选站点、粘贴 |
| 报余额不足 / 未实名 | 到厂商后台充值、完成实名后再试 |
| 很慢或连不上国内模型 | 开着全局代理(梯子)时请求会绕到境外:把模型域名设成直连,见上文「代理」 |
| npm 安装很慢或失败 | 加 `--registry https://registry.npmmirror.com`;一键安装和向导会自动换 |
| 全局安装报权限错误(EACCES) | 别用 sudo,把 npm 全局目录改到用户目录,做法见上文「一键安装」第 3 条 |
| GitHub 打不开 | 中文介绍和安装步骤在[官网](https://sintbot.com/zh/)上都有;英文 README 在 [npmmirror 的包页](https://npmmirror.com/package/sintbot)上也能看到 |
| 群里 @ 了没反应 | `sintbot doctor` 看平台那几行;`sintbot service logs` 看最近的错误 |

## 卸载

```bash
sintbot service uninstall
npm rm -g sintbot
rm -rf ~/.sbot          # 配置、会话账本、日志都在这里;项目目录不受影响
```
