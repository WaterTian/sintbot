#!/usr/bin/env bash
# SintBot 一键安装(macOS / Linux)
#
#   curl -fsSL https://sintbot.com/install.sh | bash
#   bash install.sh --dry-run      # 只打印要做什么,不改动任何东西
#
# 做的事:[1/4] Node ≥ 22 与 npm 源 → [2/4] npm i -g sintbot(已是最新就跳过)→ [3/4] sintbot setup 配模型
#        → [4/4](问一句)装成后台服务,控制台常开在 http://127.0.0.1:4600。每一步先检查,已有就跳过;要动系统的先问。不用 sudo。
# 终端里只装好、配好模型:不问是否在中国大陆、不要求配代理 / 项目目录 / 聊天平台凭据(用户 2026-10-28 定),这些装完在控制台里配。
# 国内网络:npm 官方源连不上时自动改用 npmmirror;你自己配过 npm 源就照用。
# 源码与说明:https://github.com/sintlab/sintbot(docs/install.md;中文 docs/zh-CN/install.md「一键安装」)
#
# 输出语言:SINTBOT_LANG=zh|en 可强制;否则 LC_ALL / LC_MESSAGES / LANG 以 zh 开头、或 macOS 系统语言是中文,就用中文,其余英文。
#   向导(sintbot setup)用同一判据(src/clilang.js),本脚本把结果经 SINTBOT_LANG 传给它。
# 环境变量:SINTBOT_PKG 改装别的包规格(测试时指向本地 tgz),会跳过「正式版是否已发布」的检查。

set -euo pipefail

main() {
  detect_lang
  DRY=0
  for a in "$@"; do
    case "$a" in
      --dry-run) DRY=1 ;;
      -h|--help) say "$(t '用法:curl -fsSL https://sintbot.com/install.sh | bash    或  bash install.sh [--dry-run]' 'Usage: curl -fsSL https://sintbot.com/install.sh | bash    or  bash install.sh [--dry-run]')"; return 0 ;;
      *) say "$(t "未知参数:$a(可用:--dry-run)" "Unknown option: $a (available: --dry-run)")"; return 2 ;;
    esac
  done

  PKG="${SINTBOT_PKG:-sintbot}"
  OFFICIAL="https://registry.npmjs.org/"
  MIRROR="https://registry.npmmirror.com/"
  REG=""
  SERVICE=0 # 后台服务在跑 / 本次装了(演练里答「装」也算):决定结尾的控制台是直接打开还是让人跑 sintbot ui
  UPGRADED=0 # 本次升级了已装的 sintbot:后台服务在跑的话要问重启
  LATEST="" # npm 上的最新版本(查不到为空)
  CONSOLE="http://127.0.0.1:4600"
  export SINTBOT_LANG="$L" # 向导与 sintbot service install 跟本脚本同一种语言

  # curl | bash 时脚本自己占着 stdin,提问要从 /dev/tty 读;没有终端(CI、远程无 tty)就不提问
  TTY=""
  if { : < /dev/tty; } 2>/dev/null; then TTY="/dev/tty"; fi

  say ""
  say "$(t 'SintBot 一键安装(约 1 分钟,不用 sudo)' 'SintBot installer (about a minute, no sudo)')$([ "$DRY" = 1 ] && t '(演练:只打印,不执行)' ' (dry run: print only, change nothing)')"
  say ""

  case "$(uname -s)" in
    Darwin) OS=mac ;;
    Linux)  OS=linux; say "$(t '! Linux 为实验性支持' '! Linux support is experimental')" ;;
    *) say "$(t '✗ 只支持 macOS / Linux。Windows 请按 docs/zh-CN/install.md 手动安装。' '✗ Only macOS and Linux are supported. On Windows, install manually: see docs/install.md.')"; return 1 ;;
  esac

  step_node
  step_registry
  step_latest
  step_install
  step_setup
  step_service
  step_done
}

# 语言:SINTBOT_LANG 优先;否则 locale 是 zh* 或 macOS 系统语言是中文 ⇒ 中文,其余英文
# (不少人在 ~/.zshenv 里写死 LANG=en_US.UTF-8,界面却是中文 —— 1.0.11 实装时因此脚本英文、向导中文)
detect_lang() {
  case "${SINTBOT_LANG:-}" in
    zh|en) L="$SINTBOT_LANG"; return ;;
  esac
  case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in
    zh*) L=zh; return ;;
  esac
  L=en
  if [ "$(uname -s)" = Darwin ]; then
    case "$(defaults read -g AppleLanguages 2>/dev/null | tr -d ' \n("' | cut -c1-2)" in
      zh) L=zh ;;
    esac
  fi
}
# t "中文" "English" —— 按当前语言取一句
t() { if [ "$L" = zh ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }

say() { printf '%s\n' "$*"; }
run() {
  say "  \$ $*"
  if [ "$DRY" = 1 ]; then return 0; fi
  "$@"
}

# ask_yn "问题" Y|N —— 没有终端时取默认值
ask_yn() {
  local q="$1" def="$2" hint ans
  if [ "$def" = Y ]; then hint="Y/n"; else hint="y/N"; fi
  if [ -z "$TTY" ]; then [ "$def" = Y ]; return; fi
  printf '? %s (%s) ' "$q" "$hint"
  read -r ans < "$TTY" || ans=""
  case "$ans" in
    [Yy]*) return 0 ;;
    [Nn]*) return 1 ;;
    *) [ "$def" = Y ] ;;
  esac
}

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

step_node() {
  say "$(t '[1/4] 环境' '[1/4] Environment')"
  if command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 22 ]; then
    say "  ✓ Node $(node -v)"
    return
  fi
  if command -v node >/dev/null 2>&1; then say "  $(t "✗ 当前是 Node $(node -v),版本太旧" "✗ Node $(node -v) is too old")"; else say "  $(t '✗ 没找到 Node' '✗ Node not found')"; fi
  if [ "$OS" = mac ] && command -v brew >/dev/null 2>&1; then
    if ask_yn "$(t '用 Homebrew 安装 / 升级 Node?' 'Install or upgrade Node with Homebrew?')" Y; then
      if brew list node >/dev/null 2>&1; then run brew upgrade node; else run brew install node; fi
      hash -r 2>/dev/null || true
      if [ "$DRY" = 1 ] || { command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 22 ]; }; then
        [ "$DRY" = 1 ] || say "  ✓ Node $(node -v)"
        return
      fi
      say "  $(t '✗ 装完仍不是 Node 22+(可能 PATH 里有别的 node 排在前面,用 which -a node 看)' '✗ Still not Node 22+ (another node may come first on PATH; check with: which -a node)')"
    fi
  fi
  say "  $(t '请先安装 Node 22 LTS 或更高:https://nodejs.org(或 nvm install 22),装好后重新运行本脚本。' 'Install Node 22 LTS or later first: https://nodejs.org (or: nvm install 22), then run this script again.')"
  exit 1
}

step_registry() {
  local configured
  configured="$(npm config get registry 2>/dev/null || true)"
  case "$configured" in
    https://registry.npmjs.org|https://registry.npmjs.org/|"") ;;
    *) say "  $(t "✓ npm 源:用你配置的 $configured" "✓ npm registry: using your configured $configured")"; return ;;
  esac
  if npm ping --registry "$OFFICIAL" --fetch-timeout=6000 --fetch-retries=0 >/dev/null 2>&1; then
    say "  $(t '✓ npm 官方源可用' '✓ The official npm registry is reachable')"
  else
    REG="$MIRROR"
    say "  $(t "! 官方源连不上,本次改用国内镜像 $MIRROR" "! The official registry is unreachable; using the mirror $MIRROR for this install")"
  fi
}

# 只出错误:npm 的进度、资助提示和 npm 11 对依赖安装脚本(protobufjs)的无害警告都不打
npm_g() {
  if [ -n "$REG" ]; then run npm install -g "$@" --registry "$REG" --no-fund --no-audit --loglevel=error; else run npm install -g "$@" --no-fund --no-audit --loglevel=error; fi
}

# npm 上的最新版本:已装的就是它时不重装(1.0.11 前不比对,已是最新也问「升级?」再装一遍)。
# SINTBOT_PKG 指向本地包时不查;查不到(网络、私有源)就照常装 / 问升级
step_latest() {
  [ "$PKG" = sintbot ] || return 0
  if [ -n "$REG" ]; then LATEST="$(npm view sintbot version --registry "$REG" 2>/dev/null || true)"; else LATEST="$(npm view sintbot version 2>/dev/null || true)"; fi
}

step_install() {
  say "$(t '[2/4] 安装 sintbot' '[2/4] Install sintbot')"
  local prefix
  prefix="$(npm prefix -g 2>/dev/null || true)"
  if [ -n "$prefix" ] && [ ! -w "$prefix" ] && [ ! -w "$prefix/lib/node_modules" ]; then
    say "  $(t "✗ npm 全局目录 $prefix 没有写权限(不建议用 sudo)。改成装到用户目录:" "✗ The npm global folder $prefix is not writable (sudo is not recommended). Install to your home folder instead:")"
    say "      mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global"
    say "      echo 'export PATH=\"\$HOME/.npm-global/bin:\$PATH\"' >> ~/.zshrc   $(t '# bash 用户写 ~/.bashrc' '# bash users: ~/.bashrc')"
    say "  $(t '然后重开终端,再运行本脚本。' 'Then open a new terminal and run this script again.')"
    exit 1
  fi
  if command -v sintbot >/dev/null 2>&1; then
    local cur
    cur="$(sintbot version 2>/dev/null || true)"
    if [ -n "$LATEST" ] && [ "$cur" = "$LATEST" ]; then
      say "  $(t "✓ 已是最新 $cur" "✓ Already up to date ($cur)")"
    else
      # 运行安装脚本就是要装最新版:直接升级,不问(1.0.13 起;后台服务要不要重启换新版本在第 4 步问,那会播报)。
      # 版本真变了才算升级(重装同一版本不用重启服务)
      npm_g "$PKG"
      hash -r 2>/dev/null || true
      [ "$DRY" = 1 ] || [ "$(sintbot version 2>/dev/null || true)" = "$cur" ] || UPGRADED=1
    fi
  else
    npm_g "$PKG"
  fi
  hash -r 2>/dev/null || true
  if [ "$DRY" = 0 ] && ! command -v sintbot >/dev/null 2>&1; then
    say "  $(t "! 装好了,但当前 PATH 里找不到 sintbot:把 ${prefix:-<npm prefix -g>}/bin 加进 PATH,重开终端后运行 sintbot setup" "! Installed, but sintbot is not on PATH: add ${prefix:-<npm prefix -g>}/bin to PATH, open a new terminal and run: sintbot setup")"
    exit 1
  fi
}

step_setup() {
  say "$(t '[3/4] 配模型' '[3/4] Model')"
  if [ -z "$TTY" ]; then
    say "  $(t '没有可交互的终端,跳过。请在终端里运行:sintbot setup' 'No interactive terminal; skipped. Run this in a terminal: sintbot setup')"
    return
  fi
  say "  $(t '聊天平台、代理、项目目录这些装完在控制台里配,这里只配模型。' 'Only the model is set up here; chat platform, proxy and project folder are set in the console afterwards.')"
  # 向导由本脚本调起:不重复报 Node,也不打它自己的「下一步」(结尾由 step_done 统一给)
  export SINTBOT_INSTALLER=1
  run sintbot setup < "$TTY"
}

step_service() {
  say "$(t '[4/4] 后台服务' '[4/4] Background service')"
  # 已经装了服务:没升级就不再问;升级了问要不要重启换成新版本(重启后守护进程会在已接的群里播报升级)
  # 0 在运行 / 3 装了但没在跑 / 4 没装;别的(老版本不认 --check)当不知道,照常问
  local st=4
  if [ "$DRY" = 0 ]; then st=0; sintbot service status --check >/dev/null 2>&1 || st=$?; fi
  if [ "$st" = 0 ]; then
    SERVICE=1
    if [ "$UPGRADED" = 1 ] && [ -n "$TTY" ]; then
      if ask_yn "$(t '后台服务还在跑旧版本,现在重启换成新版本?(会在已接的群里播报升级)' 'The background service is still on the old version. Restart it now? (it announces the upgrade in connected groups)')" Y; then run sintbot service restart; fi
    elif [ "$UPGRADED" = 1 ]; then
      say "  $(t '后台服务还在跑旧版本,换成新版本:sintbot service restart(会在已接的群里播报升级)' 'The background service is still on the old version; to switch: sintbot service restart (it announces the upgrade in connected groups)')"
    else
      say "  $(t '✓ 后台服务在运行' '✓ The background service is running')"
    fi
    return
  fi
  # 没有终端时不装:服务是长期改动,要人确认
  if [ -z "$TTY" ]; then say "  $(t '跳过。需要时运行:sintbot service install' 'Skipped. When you need it: sintbot service install')"; return; fi
  if [ "$DRY" = 1 ]; then
    if ask_yn "$(t "装成后台服务(登录后自启、崩溃自动拉起;控制台常开在 $CONSOLE)?" "Install the background service (starts at login, restarts on crash; the console stays at $CONSOLE)?")" Y; then run sintbot service install; SERVICE=1; fi
    return
  fi
  # 预检(--dry-run 只打印、不动系统):装不成的不问(比如控制台对外却没设密码)
  local pre rc
  pre="$(sintbot service install --dry-run 2>&1 >/dev/null < /dev/null)" && rc=0 || rc=$?
  if [ "$rc" != 0 ]; then
    say "  $(t '跳过:预检没通过 ——' 'Skipped: the pre-check failed:')"
    printf '%s\n' "$pre" | sed 's/^/    /'
    return
  fi
  local q
  if [ "$st" = 3 ]; then q="$(t '后台服务装了但没在跑,重新装一遍?' 'The background service is installed but not running. Reinstall it?')"
  else q="$(t "装成后台服务(登录后自启、崩溃自动拉起;控制台常开在 $CONSOLE)?" "Install the background service (starts at login, restarts on crash; the console stays at $CONSOLE)?")"; fi
  if ask_yn "$q" Y; then
    # 终端里的环境变量(配置引用的 key、代理)sintbot service install 自动写进服务定义,不问
    run sintbot service install < "$TTY"
    SERVICE=1
  fi
}

# 配置里接了聊天平台没有(只看凭据填没填,env: 引用算填了):决定结尾先说「接平台」还是「在群里 @ 机器人」
platform_connected() {
  local cfg="${SBOT_CONFIG:-$HOME/.sbot/config.json}"
  [ -f "$cfg" ] || return 1
  node -e '
    const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
    const f = c.feishu || {}, s = c.slack || {}, w = c.wecom || {}
    process.exit((f.appId && f.appSecret) || (s.botToken && s.appToken) || (w.botId && w.secret) ? 0 : 1)
  ' "$cfg" 2>/dev/null
}

# 能不能在这台机器上弹浏览器:SSH 进来的会话、Linux 没有图形界面时只打印地址
open_console() {
  [ -z "${SSH_CONNECTION:-}${SSH_TTY:-}" ] || return 1
  if [ "$OS" = mac ]; then open "$CONSOLE" >/dev/null 2>&1 && return 0; fi
  if [ "$OS" = linux ] && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && command -v xdg-open >/dev/null 2>&1; then xdg-open "$CONSOLE" >/dev/null 2>&1 && return 0; fi
  return 1
}

step_done() {
  say ""
  if [ "$SERVICE" = 1 ]; then
    # 等控制台起来(服务刚装好要几秒),再打开浏览器
    local up=0 i
    if [ "$DRY" = 0 ] && command -v curl >/dev/null 2>&1; then
      for i in $(seq 1 20); do curl -fsS -o /dev/null --max-time 2 "$CONSOLE/" 2>/dev/null && { up=1; break; }; sleep 1; done
    fi
    if [ "$up" = 1 ] && open_console; then say "$(t "✓ 装好了。控制台 $CONSOLE(已在浏览器打开)" "✓ All set. Console: $CONSOLE (opened in your browser)")"
    else say "$(t "✓ 装好了。控制台 $CONSOLE(在浏览器里打开)" "✓ All set. Console: $CONSOLE (open it in your browser)")"; fi
  else
    say "$(t "✓ 装好了。控制台:运行 sintbot ui(会打开 $CONSOLE)" "✓ All set. Console: run sintbot ui (opens $CONSOLE)")"
  fi
  say ""
  if [ "$DRY" = 0 ] && platform_connected; then
    say "$(t '接下来:在群里 @ 机器人说一句话。绑群、切模型、看实时活动都在控制台。' 'Next: @mention the bot in your group. Binding groups, switching models and live activity are in the console.')"
  else
    say "$(t '接下来在控制台里(都可以之后再弄):' 'Next, in the console (any time you like):')"
    say "  $(t '1. 「设置」里接飞书 / Slack / 企业微信(页面里有分步指南)' '1. Settings: connect Slack, Feishu or WeCom (step-by-step guide on the page)')"
    say "  $(t '2. 「群 · 项目」把群绑到项目目录' '2. Groups: bind a group to a project folder')"
    say "  $(t '3. 在群里 @ 机器人说一句话' '3. @mention the bot in that group')"
    say "$(t '不接平台也能先在终端里试:sintbot chat' 'You can also try it in the terminal first, no platform needed: sintbot chat')"
  fi
  if [ "$SERVICE" != 1 ]; then
    say "$(t '要常驻(登录后自启、崩溃自动拉起,控制台常开):sintbot service install' 'To keep it running (starts at login, restarts on crash, console always on): sintbot service install')"
  fi
  say "$(t '文档:https://github.com/sintlab/sintbot' 'Docs: https://github.com/sintlab/sintbot')"
}

main "$@"
