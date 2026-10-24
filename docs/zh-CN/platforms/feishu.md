# 飞书

[English](../../platforms/feishu.md) · 简体中文

## 建应用

1. [飞书开放平台](https://open.feishu.cn/app) → 创建**企业自建应用** → 「添加应用能力」加**机器人**。
2. **权限管理 → 权限配置**,开通:

   | scope | 用途 |
   |---|---|
   | `im:message.group_msg` | 收群消息 |
   | `im:message:readonly` | 拉群历史、下载附件、收撤回事件 |
   | `im:message:send_as_bot` | 发 / 回复 / 编辑 / 撤回自己的消息 |
   | `im:resource` | 上传图片与文件 |
   | `im:message.reactions:write_only` | 表情回应(收到即回一个表情) |
   | `im:chat` | 建群、拉人、群信息 |
   | `cardkit:card:write` | 流式卡片(没有就退回纯文本) |
   | `contact:contact.base:readonly` | 发送者真名、从通讯录选管理员 |
   | `contact:user.base:readonly` | 通讯录成员的名字(缺了列表与发送者会显示成 open_id) |
   | `contact:department.base:readonly` | 通讯录读部门 |
   | `contact:user.id:readonly`(可选) | 用邮箱 / 手机号查人 |

   画板功能另需画板相关权限,见 [BOARD.md](../BOARD.md)。

3. **权限管理 → 数据权限**:通讯录授权范围设为「全部成员」,否则列人和显示真名会报 `40004`。
4. **事件与回调 → 事件配置**:订阅方式选**长连接**(不需要公网地址),订阅:
   - `im.message.receive_v1`(接收消息)
   - `im.message.recalled_v1`(消息撤回;建议订阅,撤回即停)

   **回调配置**是另一个页签、另一条通道:用画板功能时在那里订阅「卡片回传交互 `card.action.trigger`」,同样选长连接(反馈卡上的按钮靠它)。
5. **应用发布 → 可用范围**:把要用机器人的人(至少管理员)放进去;不在范围内的人建群时拉不进来,报 `232043 bot invisible`。
6. **创建版本并发布**。⚠ 权限和事件订阅的任何改动,都要**再发一版**才生效。

> 飞书的三层权限各管一摊:**scope** 决定能调哪些 API,**数据权限**决定能读到谁,**可用范围**决定机器人对谁可见、能拉谁进群。报错时先看是哪一层。

## 接入 SintBot

```bash
sintbot setup          # 选 feishu,填 App ID / App Secret;预检会探出机器人的 open_id 并逐项检查权限
```

或在控制台「设置 → 飞书应用」里填,有开通指引与一键预检(错误码翻成人话)。

把机器人拉进群,然后在控制台「群 · 项目」里绑定项目目录(或重跑 `sintbot setup`)。

## 配置项

```jsonc
"feishu": {
  "appId": "cli_…",
  "appSecret": "env:FEISHU_APP_SECRET",   // 也可明文;配置文件权限 600
  "botOpenId": "ou_…",                    // 预检自动填,用于精确判断 @;预检没跑或失败时手动填,或去控制台「设置 → 飞书应用」点预检
  "onlyWhenMentioned": false,              // true = 只回 @ 机器人的消息
  "admins": [{ "openId": "ou_…", "name": "…" }]   // 管理员:建群时自动拉入;公网控制台只放行这些人
}
```

- **@ 门控**:`onlyWhenMentioned:false`(默认)时,没 @ 任何人的消息也会回;@ 了别人、没 @ 机器人的消息不回。这要靠 `botOpenId` 认出哪个 @ 是机器人 —— 没填的话,@ 别人的消息也会接;开着 `onlyWhenMentioned:true` 又没填,则群里一条都不回。
- **一台机器一个应用**:同一个应用可以有多条长连接(上限 50),但飞书**不广播**,每条消息只随机交给其中一个连接。两台机器共用一个应用,消息就会随机落到其中一台,另一台收不到。多台机器各建各的应用。
- 飞书 API 有**租户级月调用量上限**,所以画板自动感知**默认关**(群里说一声机器人就去画板上现拉)。要开把 `feishu.board.pollSec` 设成 `120`(最小 30):对**建过画布的群**每 120 秒拉一次,每次约 2 个调用,一个群一个月约 4 万次。
