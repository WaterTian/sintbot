// 测试共用:删临时目录(不是测试文件 —— 文件名不带 test,node --test 不会把它当用例跑)。
//
// 为什么不能直接 fs.rmSync:起了控制台服务的用例,关服务时审计本的 fs.appendFile(src/core/ledger.js)
// 可能还在线程池里没落盘。它若恰好在 rmSync 删完子项之后才把文件建出来,最后那一步 rmdir 就报
// ENOTEMPTY,用例在收尾处变红而断言全过(CI Node 20,2026-09-10 实见)。
// ⚠ rmSync 自带的 maxRetries 治不了:Node 18/20 的重试只重试 rmdir、不重新列目录,后建出来的文件一直在。
// ⇒ 整个 rmSync 重来(每次都重新列目录),隔一小会儿再删,直到在途的那几笔写完。服务已关、不会再有新写入,几次就够;
// 删完之后才到的追加会报 ENOENT,ledger 只记日志不抛,无害。
const fs = require('node:fs')

// 有的 Linux 文件系统对非空目录报 EEXIST 而不是 ENOTEMPTY(POSIX 两个都允许)
const NOT_EMPTY = new Set(['ENOTEMPTY', 'EEXIST'])

async function rmTmpDir(dir, tries = 40) {
  for (let i = 1; ; i++) {
    try { return fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {
      if (!NOT_EMPTY.has(e.code) || i >= tries) throw e
      await new Promise((r) => setTimeout(r, 25))
    }
  }
}

module.exports = { rmTmpDir }
