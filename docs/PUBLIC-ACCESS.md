# 控制台公网访问 —— SSH 反向隧道 + nginx + 用飞书账号登录

> 把只绑局域网的控制台安全地开到公网:靠一台有公网 IP 的服务器做入口,登录用飞书账号(不再有口令要记)。
> 本文只讲机制、约束与验收;你自己实例的地址、用户名、端口建议另记一份本地文档,**不要提交进任何仓库**。
> 局域网访问、访问密码与飞书登录的机制见 [DESIGN.md §4.9](../DESIGN.md#49-控制台与访问安全);安装见 [install.md](./zh-CN/install.md)。

## 一、拓扑

```
手机/电脑 ──HTTPS──► 公网服务器 nginx ──► 127.0.0.1:1417x ──SSH 反向隧道──► Mac 的 192.168.x.x:4600(控制台)
                     TLS · 限速 · 封两个接口                                    唯一的门:「用飞书登录」
```

- 家里或办公室的 Mac 通常在 NAT 后面、没有公网入口 ⇒ 只能**出站**建隧道:每台 Mac 一个 launchd 常驻项跑 `ssh -N -R`,把自己的控制台端口打到服务器的环回端口。
- 服务器 nginx 终结 HTTPS(复用现成证书)、限速、把两个接口直接 403,再反代到隧道端口。**nginx 不做认证**,认证在控制台自己那一层。
- 一台 Mac 一个子域名:控制台前端的 API 全是根路径,挂不了子路径。

## 二、登录:用飞书账号,只放行管理员

第一次进入:点「用飞书登录」→ 手机上飞书 App 接管、点一下授权(电脑上飞书扫一下或已登录的客户端点一下)→ 回到控制台。之后 **30 天内不再输任何东西**,守护进程重启也不登出。

- **谁能进**:只有「设置 → 飞书应用」里管理员名单上的人。名单本来就是「谁能替这台机器说话」,登录复用同一份;不在名单里的人授权成功也会被拒,并进审计。
- **怎么开**:设置页「用飞书登录控制台」填公网地址(`https://域名`,不带路径),页面会显示回调地址,把它加进飞书开放平台该应用的「安全设置 → 重定向 URL」(完整路径,必须 HTTPS)。多台机器是多个飞书应用,各配各的。登记**即时生效、不用发版**;没登记时点「用飞书登录」会停在飞书的报错页(错误码 20029「redirect_uri 请求不合法」)—— 用 curl 打授权接口也能判:没登记返回 200 报错页,登记后返回 302。
- **入口什么时候亮**:公网地址 + 应用凭证 + 管理员名单三样齐才亮;缺哪样设置页会说。没亮时登录页只有密码框,不会把人锁在外面。
- **密码登录还在**:本机与局域网 IP 上仍可用;公网域名上登录页不出密码框,而且密码登录接口被 nginx 直接 403 ⇒ **公网没有任何可猜的口令**。
- **登出**:设置页「退出登录」只作废本设备这次会话;「退出所有设备」吊销这台机器签发过的全部登录(手机丢了用这个)。
- **名单删人、换密码即生效**:会话落盘意味着它活得比进程久,所以每条会话记着签发时的身份线索,配置一变(管理员名单 / 密码)旧会话在下一次请求就失效,不用等 30 天。

流程细节(标准 OAuth 2.0 授权码):起跳接口签一次性 state(10 分钟、上限一万,太小会被人刷满挤掉别人的)→ 302 到飞书授权页 → 回调校验 state → 换 `user_access_token` → 取 `open_id` → 对照名单 → 签会话 → 落地页把令牌写进浏览器存储再回首页。登录令牌不经 URL;事件流那条令牌走 URL query,靠 nginx 关访问日志、并把该路径的错误日志压到 crit 级兜住(隧道一断,nginx 会把请求行写进错误日志)。

## 二之一、从零开通的顺序(每步独立可验)

1. **DNS**:给每台 Mac 一个子域名,A 记录指向公网服务器。
2. **服务器**(按 §四,只新增不改旧):建隧道用户 → 装两把受限公钥 → sshd `Match User` 片段(`sshd -t` → 两个视角对照 → `reload`)→ 两个 nginx 站点文件(`nginx -t` → 查别人半成品 → `reload`,伪造 Host 验默认站没变)。
3. **Mac**(按 §五):生成隧道密钥 → 种 `known_hosts` 并与另一台比对指纹 → 手动 `ssh -N -R` 试一次(服务器上端口在听、穿隧道能取到登录页且不注入令牌、错 Host 被 403)→ 装 launchd 常驻 → 杀掉一次看它自动重连。
4. **控制台**:设置页填公网地址;页面显示的回调地址抄进飞书开放平台「安全设置 → 重定向 URL」;确认设置页显示「飞书登录已就绪」。
5. **验收**:按 §六 逐行跑,再用真人的飞书账号从公网走一遍「用飞书登录 → 授权 → 进控制台」,并在手机上试一次。
6. **记档**:服务器上留 README(新增了什么、怎么看活着没、怎么撤),实例值记在本机的私有文档里。

## 三、三条来自控制台代码的硬约束(不满足就是安全事故)

| 约束 | 来源 | 后果 |
|---|---|---|
| **隧道对端必须是 Mac 的局域网地址,绝不能是 127.0.0.1:4600** | 控制台对来自本机环回的请求**免密注入令牌**(按 TCP 源地址判) | 指错 = 公网全员免密。代码侧另有一道保险:带 `X-Forwarded-*` 头的环回请求不算本机(本机浏览器不会带,nginx 一定带) |
| **nginx 必须把 `Host` 改写成 `192.168.x.x:4600`** | 控制台 Host 白名单只认环回与私网 IPv4(防 DNS 重绑定) | 不改写 = 控制台 403 |
| **`/api/events` 不许进访问日志** | 事件流的令牌走 URL query | 进日志 = 令牌落盘 |
| **接管浏览器的推流 `/api/browser/stream` 令牌走请求头** | 用 fetch 流式读,不用 EventSource ⇒ 不进 URL,访问日志无需再排除 | —— |
| **一次性链接的票在 URL 片段里(`/browser#k=<票>`)** | 片段不会发给服务器 ⇒ 访问日志里没有票;页面上点「开始接管」才 POST 兑换 | 裸 GET(链接预览 / 扫描)抓不走票 |
| **nginx 必须传 `X-Forwarded-Proto: https`** | 接管 cookie 据此加 `Secure`;控制台据此判「不是本机」 | 不传 = cookie 少一道 Secure |

另:控制台**不校验 Origin/Referer**(反代后浏览器带公网域名的 Origin 不会被拒)、请求体上限 1MB(nginx 默认 `client_max_body_size 1m` 正好对齐)、未认证的接口只有密码登录与飞书登录的起跳、回调三条(后两条只认 GET)。

## 四、服务器侧要加的东西(且只加这些)

| 类型 | 内容 | 要点 |
|---|---|---|
| 系统用户 | 一个无 shell 的隧道专用用户 | `useradd -m -s /usr/sbin/nologin` |
| 公钥 | 每台 Mac 一行 | `restrict,port-forwarding,permitlisten="127.0.0.1:1417x" ssh-ed25519 …` —— 只能在指定环回端口监听,开不了 shell |
| sshd 片段 | `sshd_config.d/` 里一个 **`Match User <隧道用户>`** 块 | 关密码登录、`AllowTcpForwarding remote`、`PermitTTY no`、**`ClientAliveInterval 30` + `ClientAliveCountMax 3`** |
| nginx 站点 | 每台 Mac 一个独立文件 | 80 → 301 https;443 = 证书 + HSTS + `X-Frame-Options DENY` + `Referrer-Policy same-origin` + 反代;`= /api/plugins/exec` 与 `= /api/login` 直接 403;`^~ /api/auth/feishu/` 限速;`= /api/events` 关访问日志、错误日志压到 crit;**`^~ /api/browser/` 不限速**(见下,必须排在 `/` 之前);`/` 宽松限速 |

**为什么探活参数要写在 `Match User` 里而不是全局**:反向隧道最经典的故障是 Mac 断网后服务器上的死会话继续占着端口,新隧道 `ExitOnForwardFailure` 反复退出。探活让死会话在 90 秒左右被踢掉。写全局会影响服务器上所有人的会话;写在 `Match User` 里只影响隧道用户,用 `sshd -T -C user=root` 与 `user=<隧道用户>` 对照即可证明不外泄。实测:冻结 Mac 端 ssh 进程后,服务器 121 秒释放端口,launchd 重拉后端口回来。

**nginx 文件名要排在 `conf.d` 最后**(如 `zz-` 前缀):nginx 对「未知 Host」取该端口**第一个** server 块当默认站。新文件按字母序排到前面就会抢走原来的默认站 —— 别人用 IP 直连看到的东西会变。用 `Host: evil.example` 的对照组打一下就能发现。

**接管浏览器要单独一段,且必须排在 `location /` 之前**:接管页把输入事件 33ms 一批送出 ≈ **30 r/s**,撞上 `/` 的 `120r/m burst=60`,拖一下滑块约两秒就 503(群成员看到的是「输入没送到」);推流又是长连接,`/` 的短读超时也扛不住。

```
# 站点文件顶部(server 块外,仍是 http 上下文 —— 不必碰 nginx.conf)
# ⚠ 多台机器时 zone 名要按机器分(sbot_conn_a / sbot_conn_b):两份站点文件同名 zone 会 nginx -t 报重复
limit_conn_zone $binary_remote_addr zone=sbot_conn_17x:1m;
# 上游连接复用:不复用 = 每个请求在 SSH 隧道里新开一条通道,白付约 100 ms(实测新连 130~160 ms / 复用 40 ms)。
# 要配合 server 级的 proxy_http_version 1.1 + proxy_set_header Connection "" 才生效;keepalive_timeout 必须比控制台 Node 端的
# 空闲超时(默认 5 秒)短,否则 nginx 会拿着一条对端刚关掉的连接去发请求。下面所有 proxy_pass 都指向它。
upstream sbot_up_17x { server 127.0.0.1:1417x; keepalive 8; keepalive_timeout 4s; }

location ^~ /api/browser/ {
    # 本段刻意不写 limit_req,只挡并发滥用。16 = 两个看客共用一个出口 IP 也够:
    # HTTP/1.1 浏览器对单主机最多 6 条连接 + 1 条推流,一个看客 ≤ 7。
    limit_conn sbot_conn_17x 16;
    proxy_pass http://sbot_up_17x;
    # proxy_buffering off · proxy_read_timeout 1h · Host 改写 · X-Forwarded-Proto 都在 server 级,
    # 这里直接继承,不必重写(重写了反而会与 server 级分叉)。
}
```

验收(从另一台机器打公网入口,`curl -Z`):`/api/browser/tabs` 6 并发 ×100 全 401、零 503;12 并发 ×100 仍零 503(证明 16 生效);对照 `/api/state` 6 并发 ×100 得 50 个 503(证明 `/` 的限速仍在);服务器上其他站点 reload 后仍 200。⚠ **验收的并发数必须低于 `limit_conn`**,否则测到的是并发上限不是限速豁免(比如 20 并发会打出一片 503,看起来像「没生效」)。

## 五、Mac 侧

`~/Library/LaunchAgents/com.sbot.tunnel.plist`,`KeepAlive` + `RunAtLoad` + `ThrottleInterval 15`,与 daemon 同一套管法:

```
/usr/bin/ssh -N -i ~/.ssh/sbot_tunnel -p <端口> \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes \
  -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=20 \
  -R 127.0.0.1:1417x:192.168.x.x:4600 <隧道用户>@<服务器>
```

- `known_hosts` 先用 `ssh-keyscan -p <端口>` 种好,并**与另一台 Mac 记录的指纹比对**(同一把才是同一台机器)。
- 日志写到 plist 的 `StandardErrorPath`(ssh -N 正常时一个字不打)。想要每行带时间戳:ProgramArguments 第一项换成一个包装脚本,它把自己的输出接到打时间戳的子进程后 `exec` 成 ssh —— ssh 仍是 launchd 眼里的主进程,kickstart / bootout 信号直达。停:`launchctl bootout gui/$(id -u)/com.sbot.tunnel`。
- 隧道 `-R` 的对端钉死了 Mac 的局域网 IP:**IP 漂了隧道就指向死地址,公网 502 且不自愈** ⇒ 在路由器上给 Mac 固定 IP(DHCP 保留)。
- **每日回收一次隧道**(另一个 LaunchAgent,如 `com.sbot.tunnel-recycle.plist`):`StartCalendarInterval` 挑一个没人用的时刻跑 `launchctl kickstart -k gui/$(id -u)/com.sbot.tunnel`。**为什么**:KeepAlive 只在断线时重连,一条 TCP 连接连续活一周左右后可能拥塞窗口塌到个位数、重传几千次;症状不是「打不开」而是**接管画面一开推流就把发送队列塞满,输入每个事件 1~2 秒、滑块拖不动**,踢一次立刻恢复。取证:服务器 `ss -tin state established "( sport = :<sshd 端口> )"` 看 cwnd / retrans,Mac `netstat -an -p tcp | grep <服务器>.<端口>` 看 Send-Q(钉在 131072 = 满)。代价是公网控制台断约 2 秒,接管页自己重连画面。

## 六、验收(必带对照组)

| 检查 | 期望 | 对照 |
|---|---|---|
| 公网裸打 `/` | 200 登录页,页面**不含**注入的 32 位令牌,只有「用飞书登录」没有密码框 | 局域网 IP 打开:按钮与密码框都有 |
| 公网 `POST /api/login` | 403(来自 nginx) | 局域网上同一请求 200/401(来自控制台) |
| 公网 `GET /api/auth/feishu/start` | 302,Location 是飞书授权页,带已登记的回调地址 | 没配公网地址的机器:400 且说缺哪样 |
| 伪造 `Host` 打服务器 | 落到原来的默认站(200) | 不是控制台页面 |
| `POST /api/plugins/exec` | 403(来自 nginx) | `/api/state` 无令牌 401(来自控制台) |
| 飞书授权后回调 | 落地页 200,浏览器存储里有 48 位令牌,`/api/state` 200 | 名单外的账号:403 且无令牌;重放同一个 state:400 |
| `/api/events?token=` | 5 秒内收到 `event: hello` | 访问日志里 `api/events` 0 行、`api/state` ≥1 行 |
| 限速对 `/api/browser/` 放行 —— **必须 `curl -Z`(并发 + 复用连接)连发 N 个**,逐个新建 TLS 太慢打不到阈值、对照组会假绿 | `/api/browser/input` 连发 N 个,零 503 | `/api/state` 连发同样 N 个,应出现 503(证明限速还在) |
| 重启守护进程 | 令牌仍有效 | 「退出登录」后 401 |
| 从管理员名单删掉某人 | 那人的会话下一次请求即 401 | 没删的人仍 200 |
| 换 / 删控制台密码 | 密码签的会话 401 | 飞书签的仍 200 |
| 「退出所有设备」 | 所有令牌 401 | —— |
| 本机环回请求带 `X-Forwarded-For` | 不注入免密令牌 | 不带该头的本机请求照旧免密 |
| 冻结 Mac 端 ssh(`kill -STOP`) | 服务器 ≈90~120 秒释放端口 | `kill -CONT` + kill 后 launchd 重拉、端口回来 |
| 上游连接复用 | 经 nginx 连打 4 次 `/api/state`:首个约 150~200 ms(新开通道),之后每个约 80 ms;`ss -tnp` 见 nginx→1417x 的空闲连接 | 间隔 0 / 3.5 / 4.5 / 5.5 秒混合 GET 与 POST 各 8 轮,只许 401 / 410,不许 502(陈旧连接竞态) |
| `sintbot doctor` / 控制台「访问地址」卡 | 不受影响 | —— |
| 从境外出口(代理)打 | 与服务器本机打一致 | —— |

## 七、服务器是共用的时候

- **只新增文件,不改任何现有文件**:不碰 `sshd_config` 本体、`nginx.conf`、任何现有站点、证书、防火墙、别人的密钥。
- **不开 ufw**:先 `ss -ltnp` 盘点,别的项目往往直接对公网监听着端口,开了就全断。
- **不给别的项目的部署 key 加限制**,隧道用自己的用户与 key。
- **不动 root 的密码登录**:先看 `auth.log` 谁在用密码登录 —— 那可能是服务器的其他使用者。
- **nginx reload 前查别人有没有改了没 reload 的半成品**:判据是 **worker 进程的启动时间**(reload 会重生 worker;主进程时间没用)与 `conf.d/*` 的 mtime 比;`nginx -t` 若因别人的文件失败就停下。
- **sshd 用 `systemctl reload ssh` 不用 restart**,改前另开一条会话保底,`sshd -t` 通过才 reload。
- **每个新增文件头两行写明归属与「删掉会断什么」**,并在服务器上留一份 README(新增了什么、怎么看活着没、怎么撤)—— 别人看见才不会当垃圾清掉。
- 动手前跟服务器的其他使用者打一声招呼。

## 八、口令、会话与升级路径

- 公网上没有口令。局域网密码登录仍在,密码放在密码管理器里,**不要写进仓库或任何文档**。
- 会话令牌落盘(`~/.sbot/ui-sessions.json`,0600),固定 30 天;设置页「退出登录」作废本设备的,「退出所有设备」全吊销。
- 已知局限:单独起的控制台进程(`sintbot ui`)与守护进程自带的控制台若**同时**开着,各持一份内存表、整文件覆盖同一份会话文件 —— 只会丢登录,不会越权;平时只跑守护进程那一份就没有这个问题。
- 想更安全:nginx 层再加**客户端证书**(私有 CA 给每台设备签证书,没证书连门都敲不响),飞书登录照旧 —— nginx 一处改,其余不动。
- 可选的 sbot 小改动(未做):`ui.trustProxy` —— 放行指定 Host、关闭同机免密、审计 IP 取 `X-Forwarded-For`;做了之后隧道对端可以指环回,顺手根治上面「IP 漂移」那条。
- 可选第二期:把控制台以网页应用形式加进飞书工作台,从飞书里打开时连那一次授权点击都省掉(飞书文档确认此免登只在客户端内生效)。

## 九、卸载(按顺序,每步独立可逆)

服务器:删两个 nginx 文件 → `nginx -t` → reload;删 sshd 片段 → `sshd -t` → reload;`userdel -r` 隧道用户;删日志。
Mac:`launchctl bootout gui/$(id -u)/com.sbot.tunnel` → 删 plist → 删 `~/.ssh/sbot_tunnel*`;设置页清空公网地址。
