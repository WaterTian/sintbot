// Shared Windows executable resolution for spawning agent CLIs (claude, codex).
//
// npm-installed CLIs on Windows are `.cmd` batch shims that Node's spawn() (no
// shell) cannot execute directly — you get ENOENT even though the command works in
// the terminal. And a bare extensionless file on PATH is npm's POSIX shell shim,
// which Windows' CreateProcess also can't run. So: resolve to a *runnable* file
// honouring PATHEXT (native .exe preferred over an npm .cmd shim), and run a
// .cmd/.bat through cmd.exe with an ARGV array (NOT shell:true — Node still quotes
// each arg, and callers feed the prompt via stdin, dodging cmd.exe metacharacter
// mangling). POSIX: pure passthrough, so the Mac/Linux path is byte-for-byte the
// same as calling the bin directly.

const fs = require('node:fs')
const path = require('node:path')

const IS_WIN = process.platform === 'win32'

function resolveSpawn(bin, args) {
  if (!IS_WIN) return { file: bin, spawnArgs: args }
  const resolved = resolveWinExecutable(bin)
  if (!resolved) return { file: bin, spawnArgs: args } // not found → let ENOENT surface with the caller's hint
  const ext = path.extname(resolved).toLowerCase()
  if (ext === '.cmd' || ext === '.bat') {
    return { file: process.env.ComSpec || 'cmd.exe', spawnArgs: ['/d', '/s', '/c', resolved, ...args] }
  }
  return { file: resolved, spawnArgs: args } // real .exe → spawn directly, cleanest
}

// A minimal `where`: resolve a bare command against PATH + PATHEXT. PATHEXT order
// (.EXE before .CMD) means a native <bin>.exe is preferred over an npm .cmd shim.
function resolveWinExecutable(bin) {
  const tryFile = (p) => { try { return fs.statSync(p).isFile() ? p : null } catch { return null } }
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  // Resolve one path to a *runnable* file: honour an explicit extension, else try
  // each PATHEXT. NEVER match a bare extensionless file — on PATH that's npm's POSIX
  // shell shim (a file literally named `claude`/`codex`), which Windows' CreateProcess
  // cannot execute; its runnable sibling is `<bin>.cmd`/`.exe`.
  const runnable = (p) => (path.extname(p) ? tryFile(p) : null) || exts.map((e) => tryFile(p + e)).find(Boolean) || null

  if (bin.includes('/') || bin.includes('\\') || path.extname(bin)) return runnable(bin)

  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue
    const hit = runnable(path.join(dir, bin))
    if (hit) return hit
  }
  return null
}

module.exports = { IS_WIN, resolveSpawn, resolveWinExecutable }
