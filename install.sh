#!/usr/bin/env bash
# SintBot 一键安装(macOS / Linux)
#
#   curl -fsSL https://sintbot.com/install.sh | bash
#   bash install.sh --dry-run      # 只打印要做什么,不改动任何东西
#
# 做的事:Node ≥ 22 → npm i -g sintbot → sintbot setup(向导里会问要不要装 Claude Code)
#        →(可选)装成常驻服务。每一步先检查,已有就跳过;要动系统的先问。不用 sudo。
# 国内网络:npm 官方源连不上时自动改用 npmmirror;你自己配过 npm 源就照用。
# 源码与说明:https://github.com/WaterTian/sintbot(docs/zh-CN/install.md「一键安装」;英文 docs/install.md)
#
# 环境变量:SINTBOT_PKG 改装别的包规格(测试时指向本地 tgz),会跳过「正式版是否已发布」的检查。

set -euo pipefail

main() {
  DRY=0
  for a in "$@"; do
    case "$a" in
      --dry-run) DRY=1 ;;
      -h|--help) say "用法:curl -fsSL https://sintbot.com/install.sh | bash    或  bash install.sh [--dry-run]"; return 0 ;;
      *) say "未知参数:$a(可用:--dry-run)"; return 2 ;;
    esac
  done

  PKG="${SINTBOT_PKG:-sintbot}"
  OFFICIAL="https://registry.npmjs.org/"
  MIRROR="https://registry.npmmirror.com/"
  REG=""

  # curl | bash 时脚本自己占着 stdin,提问要从 /dev/tty 读;没有终端(CI、远程无 tty)就不提问
  TTY=""
  if { : < /dev/tty; } 2>/dev/null; then TTY="/dev/tty"; fi

  say ""
  say "SintBot 一键安装$([ "$DRY" = 1 ] && echo '(演练:只打印,不执行)')"
  say ""

  case "$(uname -s)" in
    Darwin) OS=mac ;;
    Linux)  OS=linux; say "! Linux 为实验性支持" ;;
    *) say "✗ 只支持 macOS / Linux。Windows 请按 docs/zh-CN/install.md 手动安装。"; return 1 ;;
  esac

  step_node
  step_registry
  step_release_guard || return 0
  step_install
  step_setup
  step_service
  step_done
}

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
  say "— Node.js(需要 22 或更高)—"
  if command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 22 ]; then
    say "  ✓ Node $(node -v)"
    return
  fi
  if command -v node >/dev/null 2>&1; then say "  ✗ 当前是 Node $(node -v),版本太旧"; else say "  ✗ 没找到 Node"; fi
  if [ "$OS" = mac ] && command -v brew >/dev/null 2>&1; then
    if ask_yn "用 Homebrew 安装 / 升级 Node?" Y; then
      if brew list node >/dev/null 2>&1; then run brew upgrade node; else run brew install node; fi
      hash -r 2>/dev/null || true
      if [ "$DRY" = 1 ] || { command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge 22 ]; }; then
        [ "$DRY" = 1 ] || say "  ✓ Node $(node -v)"
        return
      fi
      say "  ✗ 装完仍不是 Node 22+(可能 PATH 里有别的 node 排在前面,用 which -a node 看)"
    fi
  fi
  say "  请先安装 Node 22 LTS 或更高:https://nodejs.org(或 nvm install 22),装好后重新运行本脚本。"
  exit 1
}

step_registry() {
  say "— npm 源 —"
  local configured
  configured="$(npm config get registry 2>/dev/null || true)"
  case "$configured" in
    https://registry.npmjs.org|https://registry.npmjs.org/|"") ;;
    *) say "  ✓ 用你配置的源 $configured"; return ;;
  esac
  if npm ping --registry "$OFFICIAL" --fetch-timeout=6000 --fetch-retries=0 >/dev/null 2>&1; then
    say "  ✓ 官方源可用"
  else
    REG="$MIRROR"
    say "  ! 官方源连不上,本次改用国内镜像 $MIRROR"
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
    ""|0.*) say ""; say "SintBot 的首个正式版即将发布,敬请关注 https://sintbot.com"; return 1 ;;
  esac
}

step_install() {
  say "— 安装 sintbot —"
  local prefix
  prefix="$(npm prefix -g 2>/dev/null || true)"
  if [ -n "$prefix" ] && [ ! -w "$prefix" ] && [ ! -w "$prefix/lib/node_modules" ]; then
    say "  ✗ npm 全局目录 $prefix 没有写权限(不建议用 sudo)。改成装到用户目录:"
    say "      mkdir -p ~/.npm-global && npm config set prefix ~/.npm-global"
    say "      echo 'export PATH=\"\$HOME/.npm-global/bin:\$PATH\"' >> ~/.zshrc   # bash 用户写 ~/.bashrc"
    say "  然后重开终端,再运行本脚本。"
    exit 1
  fi
  if command -v sintbot >/dev/null 2>&1; then
    say "  已安装 $(sintbot version 2>/dev/null || echo '(版本未知)')"
    if ask_yn "升级到最新版?" Y; then npm_g "$PKG"; fi
  else
    npm_g "$PKG"
  fi
  hash -r 2>/dev/null || true
  if [ "$DRY" = 0 ] && ! command -v sintbot >/dev/null 2>&1; then
    say "  ! 装好了,但当前 PATH 里找不到 sintbot:把 ${prefix:-<npm prefix -g>}/bin 加进 PATH,重开终端后运行 sintbot setup"
    exit 1
  fi
}

step_setup() {
  say "— 配置向导 —"
  if [ -z "$TTY" ]; then
    say "  没有可交互的终端,跳过。请在终端里运行:sintbot setup"
    return
  fi
  say "  向导会依次检查 Claude Code(没装会问要不要装)、配模型(没有 Claude 订阅就推荐 DeepSeek,粘贴 key 当场试跑)、接聊天平台、绑第一个群。"
  say "  先按 docs/zh-CN/platforms/ 建好机器人并拉进群,向导里才有凭据可填:"
  say "  https://github.com/WaterTian/sintbot/tree/main/docs/zh-CN/platforms"
  run sintbot setup < "$TTY"
}

step_service() {
  say "— 常驻服务 —"
  # 没有终端时不装:服务是长期改动,要人确认
  if [ -z "$TTY" ]; then say "  跳过。需要时运行:sintbot service install"; return; fi
  if ask_yn "装成常驻服务(崩溃自动拉起、登录后自启)?" Y; then
    run sintbot service install
  else
    say "  需要时运行:sintbot service install"
  fi
}

step_done() {
  say ""
  say "完成。接下来:"
  say "  · 在群里 @ 机器人说一句话"
  say "  · 控制台:http://127.0.0.1:4600(绑群、切模型、看实时活动)"
  say "  · 文档:https://github.com/WaterTian/sintbot"
}

main "$@"
