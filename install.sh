#!/usr/bin/env bash
# SintBot 一键安装(macOS / Linux)
#
#   curl -fsSL https://sintbot.com/install.sh | bash
#   bash install.sh --dry-run      # 只打印要做什么,不改动任何东西
#
# 做的事:Node ≥ 22 → npm i -g sintbot → sintbot setup(向导里会问要不要装 Claude Code)
#        →(可选)装成常驻服务。每一步先检查,已有就跳过;要动系统的先问。不用 sudo。
# 国内网络:npm 官方源连不上时自动改用 npmmirror;你自己配过 npm 源就照用。
# 源码与说明:https://github.com/sintlab/sintbot(docs/install.md;中文 docs/zh-CN/install.md「一键安装」)
#
# 输出语言:LC_ALL / LC_MESSAGES / LANG 以 zh 开头用中文,其余英文;SINTBOT_LANG=zh|en 可强制。
#   英文模式先指 Slack 的建应用指南(海外多用 Slack),中文模式指飞书(国内推荐)。配置向导目前只有中文。
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
  SERVICE=0 # 常驻服务装了没(演练里答「装」也算):决定结尾给不给控制台地址

  # curl | bash 时脚本自己占着 stdin,提问要从 /dev/tty 读;没有终端(CI、远程无 tty)就不提问
  TTY=""
  if { : < /dev/tty; } 2>/dev/null; then TTY="/dev/tty"; fi

  say ""
  say "$(t 'SintBot 一键安装' 'SintBot installer')$([ "$DRY" = 1 ] && t '(演练:只打印,不执行)' ' (dry run: print only, change nothing)')"
  say ""

  case "$(uname -s)" in
    Darwin) OS=mac ;;
    Linux)  OS=linux; say "$(t '! Linux 为实验性支持' '! Linux support is experimental')" ;;
    *) say "$(t '✗ 只支持 macOS / Linux。Windows 请按 docs/zh-CN/install.md 手动安装。' '✗ Only macOS and Linux are supported. On Windows, install manually: see docs/install.md.')"; return 1 ;;
  esac

  step_node
  step_registry
  step_release_guard || return 0
  step_install
  step_setup
  step_service
  step_done
}

# 语言:SINTBOT_LANG 优先;否则按 locale(zh* ⇒ 中文),其余一律英文
detect_lang() {
  case "${SINTBOT_LANG:-}" in
    zh|en) L="$SINTBOT_LANG"; return ;;
  esac
  case "${LC_ALL:-${LC_MESSAGES:-${LANG:-}}}" in
    zh*) L=zh ;;
    *) L=en ;;
  esac
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
  say "$(t '— Node.js(需要 22 或更高)—' '— Node.js (22 or later) —')"
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
  say "$(t '— npm 源 —' '— npm registry —')"
  local configured
  configured="$(npm config get registry 2>/dev/null || true)"
  case "$configured" in
    https://registry.npmjs.org|https://registry.npmjs.org/|"") ;;
    *) say "  $(t "✓ 用你配置的源 $configured" "✓ Using your configured registry $configured")"; return ;;
  esac
  if npm ping --registry "$OFFICIAL" --fetch-timeout=6000 --fetch-retries=0 >/dev/null 2>&1; then
    say "  $(t '✓ 官方源可用' '✓ The official registry is reachable')"
  else
    REG="$MIRROR"
    say "  $(t "! 官方源连不上,本次改用国内镜像 $MIRROR" "! The official registry is unreachable; using the mirror $MIRROR for this install")"
  fi
}

npm_g() {
  if [ -n "$REG" ]; then run npm install -g "$@" --registry "$REG"; else run npm install -g "$@"; fi
}

# npm 上还只有占位版(< 1.0.0)时不装:装了也没有可用的命令
step_release_guard() {
  [ "$PKG" = sintbot ] || return 0
  local v
  if [ -n "$REG" ]; then v="$(npm view sintbot version --registry "$REG" 2>/dev/null || true)"; else v="$(npm view sintbot version 2>/dev/null || true)"; fi
  case "$v" in
    ""|0.*) say ""; say "$(t 'SintBot 的首个正式版即将发布,敬请关注 https://sintbot.com' 'The first release of SintBot is coming soon: https://sintbot.com')"; return 1 ;;
  esac
}

step_install() {
  say "$(t '— 安装 sintbot —' '— Install sintbot —')"
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
    say "  $(t '已安装' 'Installed:') $(sintbot version 2>/dev/null || t '(版本未知)' '(unknown version)')"
    if ask_yn "$(t '升级到最新版?' 'Upgrade to the latest version?')" Y; then npm_g "$PKG"; fi
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
  say "$(t '— 配置向导 —' '— Setup wizard —')"
  if [ -z "$TTY" ]; then
    say "  $(t '没有可交互的终端,跳过。请在终端里运行:sintbot setup' 'No interactive terminal; skipped. Run this in a terminal: sintbot setup')"
    return
  fi
  if [ "$L" = zh ]; then
    say "  向导会依次检查 Claude Code(没装会问要不要装)、配模型(没有 Claude 订阅就推荐 DeepSeek,粘贴 key 当场试跑)、接聊天平台、绑第一个群。"
    say "  先建好机器人并拉进群,向导里才有凭据可填(国内推荐飞书):"
    say "  https://github.com/sintlab/sintbot/tree/main/docs/zh-CN/platforms"
  else
    say "  The wizard checks Claude Code (offers to install it), sets up a model (DeepSeek is suggested if you have no Claude subscription; the key is tested on the spot), connects a chat platform and binds your first group."
    say "  The wizard is in Chinese for now; docs/install.md explains each question in English:"
    say "  https://github.com/sintlab/sintbot/blob/main/docs/install.md#2-configure-sintbot-setup"
    say "  Create the bot and add it to a group first, so you have its credentials ready. Slack guide:"
    say "  https://github.com/sintlab/sintbot/blob/main/docs/platforms/slack.md   (Feishu and WeCom: docs/platforms/)"
  fi
  run sintbot setup < "$TTY"
}

step_service() {
  say "$(t '— 常驻服务 —' '— Background service —')"
  # 没有终端时不装:服务是长期改动,要人确认
  if [ -z "$TTY" ]; then say "  $(t '跳过。需要时运行:sintbot service install' 'Skipped. When you need it: sintbot service install')"; return; fi
  if ask_yn "$(t '装成常驻服务(崩溃自动拉起、登录后自启)?' 'Install as a background service (restarts on crash, starts at login)?')" Y; then
    run sintbot service install
    SERVICE=1
  fi
}

step_done() {
  say ""
  say "$(t '完成。接下来:' 'Done. Next:')"
  if [ "$SERVICE" = 1 ]; then
    say "  $(t '· 在群里 @ 机器人说一句话' '· @mention the bot in your group and say something')"
    say "  $(t '· 控制台:http://127.0.0.1:4600(绑群、切模型、看实时活动)' '· Console: http://127.0.0.1:4600 (bind groups, switch models, watch live activity)')"
  else
    # 没装服务就没有在跑的守护进程:群里不会有回应,4600 也打不开 —— 先说怎么让它跑起来
    say "  $(t '· 守护进程还没在跑:想先在前台试,运行 sintbot start --ui(控制台 http://127.0.0.1:4600,关掉终端就停)' '· The daemon is not running yet. To try it in the foreground: sintbot start --ui (console at http://127.0.0.1:4600; stops when you close the terminal)')"
    say "  $(t '· 要常驻(崩溃自动拉起、登录后自启):sintbot service install' '· To keep it running (restarts on crash, starts at login): sintbot service install')"
    say "  $(t '· 跑起来后,在群里 @ 机器人说一句话' '· Once it is running, @mention the bot in your group')"
  fi
  say "  $(t '· 文档:https://github.com/sintlab/sintbot' '· Docs: https://github.com/sintlab/sintbot')"
}

main "$@"
