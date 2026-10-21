// 项目根目录围栏(src/projectsroot.js):控制台三个吃路径的入口 + doctor 共用的那一份判据。
// 重点钉两件事:① 判据走 realpath —— 符号链接绕不出去、/var 与 /private/var 算同一处;
// ② 「等于没围」的配置值被丢掉且有原因,永远不会退到家目录。

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const pr = require('../../src/projectsroot')

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p))

test('projectsroot: expandHome 只认 ~ 与 ~/x,其余原样;非字符串/空 ⇒ 空串', () => {
  assert.equal(pr.expandHome('~', '/home/u'), '/home/u')
  assert.equal(pr.expandHome('~/Projects', '/home/u'), path.join('/home/u', 'Projects'))
  assert.equal(pr.expandHome('/abs/x', '/home/u'), '/abs/x')
  assert.equal(pr.expandHome('  ', '/home/u'), '')
  assert.equal(pr.expandHome(42, '/home/u'), '')
})

test('projectsroot: 默认根 = 家目录下的 Projects;Windows 有 D 盘用 D:\\Projects,没有则用户目录下', () => {
  assert.equal(pr.defaultProjectsRoot({ platform: 'darwin', home: '/Users/me' }), path.join('/Users/me', 'Projects'))
  assert.equal(pr.defaultProjectsRoot({ platform: 'win32', home: 'C:\\Users\\me', exists: (p) => p === 'D:\\' }), 'D:\\Projects')
  const noD = pr.defaultProjectsRoot({ platform: 'win32', home: 'C:\\Users\\me', exists: () => false })
  assert.ok(noD.startsWith('C:\\Users\\me') && noD.endsWith('Projects'), noD)
})

test('projectsroot: 等于没围的值被丢掉并记原因;全丢时退到默认根而不是家目录', () => {
  const home = '/Users/me'
  const r = pr.resolveProjectsRoots({ projectsRoots: ['/', home, path.dirname(home), 'relative/dir', '', 7] }, { home, platform: 'darwin' })
  assert.equal(r.fromConfig, false, '一条有效的都没有 ⇒ 不算「来自配置」')
  assert.deepEqual(r.roots, [path.join(home, 'Projects')])
  assert.deepEqual(r.dropped.map((d) => d.why), ['是文件系统根目录', '是整个家目录', '是所有用户目录的上一级', '不是绝对路径', '不是字符串或为空', '不是字符串或为空'])
  // 对照:家目录之下的任何目录都可以当根
  assert.equal(pr.tooWideReason(path.join(home, 'Projects'), { home }), '')
})

test('projectsroot: 字符串写法、~ 展开、去重、保留配置里的原样顺序', () => {
  const home = '/Users/me'
  const one = pr.resolveProjectsRoots({ projectsRoots: '~/Work' }, { home, platform: 'darwin' })
  assert.deepEqual(one.roots, [path.join(home, 'Work')]); assert.equal(one.fromConfig, true)
  const many = pr.resolveProjectsRoots({ projectsRoots: ['~/B', '/Volumes/A', '~/B/'] }, { home, platform: 'darwin' })
  assert.deepEqual(many.roots, [path.join(home, 'B'), '/Volumes/A'])
  assert.deepEqual(many.dropped, [])
  // 没配 ⇒ 默认,dropped 为空
  const none = pr.resolveProjectsRoots({}, { home, platform: 'darwin' })
  assert.deepEqual(none, { roots: [path.join(home, 'Projects')], dropped: [], fromConfig: false })
  // 写成对象:整个忽略但记一笔(doctor 要能报「你写的那段没被读」)
  const obj = pr.resolveProjectsRoots({ projectsRoots: { a: 1 } }, { home, platform: 'darwin' })
  assert.deepEqual(obj.roots, [path.join(home, 'Projects')]); assert.equal(obj.fromConfig, false)
  assert.equal(obj.dropped[0].why, '不是字符串或字符串数组')
})

test('projectsroot: withinRoots —— 根本身、子孙在内;兄弟、前缀相似的目录、根的上级都不在', () => {
  const root = tmp('sbot-root-')
  fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true })
  const sibling = tmp('sbot-root-') // 与 root 只差随机后缀,字面前缀相似
  assert.equal(pr.withinRoots(root, [root]), root)
  assert.equal(pr.withinRoots(path.join(root, 'a', 'b'), [root]), root)
  assert.equal(pr.withinRoots(sibling, [root]), null)
  assert.equal(pr.withinRoots(root + '-suffix', [root]), null, '字面以根开头但不是子路径')
  assert.equal(pr.withinRoots(path.dirname(root), [root]), null)
  assert.equal(pr.withinRoots(path.join(root, '..', path.basename(sibling)), [root]), null, '.. 穿越')
  // 多根:命中哪个就回哪个
  assert.equal(pr.withinRoots(path.join(sibling, 'x'), [root, sibling]), sibling)
  // 空/非法输入 fail-closed
  assert.equal(pr.withinRoots('', [root]), null)
  assert.equal(pr.withinRoots(root, []), null)
})

test('projectsroot: 判据走 realpath —— 根内的符号链接指到根外就不算在内(agent 能在自己的 workdir 里放链接)', () => {
  const root = tmp('sbot-root-')
  const outside = tmp('sbot-out-')
  fs.mkdirSync(path.join(outside, 'secret'))
  fs.symlinkSync(outside, path.join(root, 'link'))
  assert.equal(pr.withinRoots(path.join(root, 'link'), [root]), null)
  assert.equal(pr.withinRoots(path.join(root, 'link', 'secret'), [root]), null)
  // 对照:同一个 root 里的真目录照常在内(证明不是「什么都不在内」)
  fs.mkdirSync(path.join(root, 'real'))
  assert.equal(pr.withinRoots(path.join(root, 'real'), [root]), root)
})

test('projectsroot: realpath 归一 —— 根写成 /var/… 与 /private/var/… 算同一处;不存在的目标按最深存在的祖先算', () => {
  const root = tmp('sbot-root-')
  const real = fs.realpathSync.native(root)
  assert.equal(pr.withinRoots(path.join(root, 'newproj'), [real]), real, '目标还不存在也判得出落点')
  assert.equal(pr.withinRoots(path.join(real, 'x', 'y'), [root]), root)
  assert.equal(pr.realpathLenient(path.join(root, 'no', 'such')), path.join(real, 'no', 'such'))
})

test('projectsroot: describeRoots 多根用「或」连', () => {
  assert.equal(pr.describeRoots(['/a', '/b']), '/a 或 /b')
  assert.equal(pr.describeRoots([]), '')
})

test('projectsroot: link/.. 按内核语义算 —— 先跟链接再上一级,字面在根内、内核在根外的写法判为根外(对抗审查 🔴)', () => {
  const root = tmp('sbot-root-'), outside = tmp('sbot-out-')
  fs.mkdirSync(path.join(outside, 'deep')); fs.mkdirSync(path.join(outside, 'secret'))
  fs.mkdirSync(path.join(root, 'proj')); fs.symlinkSync(path.join(outside, 'deep'), path.join(root, 'proj', 'link'))
  // ⚠ 用字符串拼接构造:path.join 会先把 .. 折叠掉,用例就成了恒真(审查时第一版探针就这么骗过了自己)
  const S = path.sep
  assert.equal(pr.withinRoots(root + S + 'proj' + S + 'link' + S + '..', [root]), null)
  assert.equal(pr.withinRoots(root + S + 'proj' + S + 'link' + S + '..' + S + 'secret', [root]), null)
  assert.equal(pr.realpathLenient(root + S + 'proj' + S + 'link' + S + '..'), fs.realpathSync.native(outside))
  // 对照:不经链接的 .. 与尾部分隔符照常在根内;不存在的段之后的 .. 按字面
  assert.equal(pr.withinRoots(root + S + 'proj' + S + 'nope' + S + '..', [root]), root)
  assert.equal(pr.withinRoots(root + S + 'proj' + S, [root]), root)
  assert.equal(pr.samePath(root + S + 'proj' + S, path.join(root, 'proj')), true)
  assert.equal(pr.samePath(root + S + 'proj' + S + 'link' + S + '..', path.join(root, 'proj')), false)
})

test('projectsroot: 「等于没围」也按 realpath 判 —— 指向家目录上一级的链接当根被丢;macOS 上大小写变体的家目录同样被丢', () => {
  const home = os.homedir()
  const t = tmp('sbot-wide-')
  fs.symlinkSync(path.dirname(home), path.join(t, 'link'))
  const r = pr.resolveProjectsRoots({ projectsRoots: [path.join(t, 'link')] }, { home })
  assert.equal(r.fromConfig, false); assert.equal(r.dropped[0].why, '是所有用户目录的上一级')
  // 对照:同一个临时目录里的真目录可以当根
  fs.mkdirSync(path.join(t, 'real'))
  assert.equal(pr.resolveProjectsRoots({ projectsRoots: [path.join(t, 'real')] }, { home }).fromConfig, true)
  if (process.platform === 'darwin') {
    const up = pr.resolveProjectsRoots({ projectsRoots: [home.toUpperCase()] }, { home })
    assert.equal(up.dropped[0] && up.dropped[0].why, '是整个家目录')
  }
})

// ── 跨平台:纯字符串逻辑按目标平台算,Windows 的规则在 macOS 上就能钉住 ──────────────────
test('projectsroot(win32): ~ 展开用反斜杠;盘符根 / UNC 共享根 / 用户目录 / C:\\Users 都算等于没围;正斜杠写法收下并归成反斜杠;大小写不敏感去重', () => {
  const home = 'C:\\Users\\me', platform = 'win32'
  assert.equal(pr.expandHome('~\\Work', home, platform), 'C:\\Users\\me\\Work')
  assert.equal(pr.expandHome('~/Work', home, platform), 'C:\\Users\\me\\Work')
  assert.equal(pr.defaultProjectsRoot({ platform, home, exists: () => false }), 'C:\\Users\\me\\Projects')
  const r = pr.resolveProjectsRoots({ projectsRoots: ['C:\\', '\\\\srv\\share\\', home, 'C:\\Users', 'D:/Work/Projects', 'd:\\work\\projects', 'E:\\Proj'] }, { home, platform })
  assert.deepEqual(r.dropped.map((d) => d.why), ['是文件系统根目录', '是文件系统根目录', '是整个家目录', '是所有用户目录的上一级'])
  assert.deepEqual(r.roots, ['D:\\Work\\Projects', 'E:\\Proj'], '正斜杠归成反斜杠;大小写只差的那条去重')
  assert.equal(r.fromConfig, true)
  // 驱动器相对路径(C:foo)不是绝对路径 ⇒ 丢
  assert.equal(pr.resolveProjectsRoots({ projectsRoots: ['C:foo'] }, { home, platform }).dropped[0].why, '不是绝对路径')
  // UNC 共享下的子目录可以当根
  assert.deepEqual(pr.resolveProjectsRoots({ projectsRoots: ['\\\\srv\\share\\Projects'] }, { home, platform }).roots, ['\\\\srv\\share\\Projects'])
  // norm:Windows 小写 + 去尾分隔符
  assert.equal(pr.norm('D:\\Work\\', platform), 'd:\\work')
})

test('projectsroot(posix 显式): ~ 展开;/、家目录、/home 等于没围;Windows 风格的盘符路径在 posix 下不是绝对路径', () => {
  const home = '/home/u', platform = 'linux'
  assert.equal(pr.expandHome('~/Work', home, platform), '/home/u/Work')
  const r = pr.resolveProjectsRoots({ projectsRoots: ['/', home, '/home', 'C:\\Projects', '/srv/projects/'] }, { home, platform })
  assert.deepEqual(r.dropped.map((d) => d.why), ['是文件系统根目录', '是整个家目录', '是所有用户目录的上一级', '不是绝对路径'])
  assert.deepEqual(r.roots, ['/srv/projects'])
})

test('projectsroot: parseRootsInput —— 换行或 ; 分隔,去空白去空项,别的原样', () => {
  assert.deepEqual(pr.parseRootsInput(' ~/A ;\n/Volumes/B\r\n\n;  '), ['~/A', '/Volumes/B'])
  assert.deepEqual(pr.parseRootsInput('D:\\Projects;E:\\Work'), ['D:\\Projects', 'E:\\Work'])
  assert.deepEqual(pr.parseRootsInput(''), []); assert.deepEqual(pr.parseRootsInput(null), [])
})

test('projectsroot: workdirInput —— 认 ~ 并返回展开后的绝对路径;相对路径、~ 后的 . / .. 段、重复分隔符都拒', () => {
  const o = { home: '/home/u', platform: 'linux' }
  assert.deepEqual(pr.workdirInput('~/Projects/a', o), { path: '/home/u/Projects/a' })
  assert.deepEqual(pr.workdirInput('  ~/p  ', o), { path: '/home/u/p' })
  assert.deepEqual(pr.workdirInput('/srv/x/', o), { path: '/srv/x/' })
  assert.match(pr.workdirInput('rel/x', o).error, /绝对路径/)
  assert.match(pr.workdirInput('~x', o).error, /绝对路径/)            // ~user 写法不认
  assert.match(pr.workdirInput('~/a/../b', o).error, /规范/)         // .. 不能被展开时的拼接悄悄消掉
  assert.match(pr.workdirInput('/a//b', o).error, /规范/)
  assert.match(pr.workdirInput('', o).error, /为空/)
  assert.match(pr.workdirInput(null, o).error, /为空/)
  assert.deepEqual(pr.workdirInput('~\\p', { home: 'C:\\Users\\u', platform: 'win32' }), { path: 'C:\\Users\\u\\p' })
})

test('projectsroot: defaultWorkdir —— 向导绑群的默认目录 = 第一个项目根目录 / 群名;没有群名用 my-project', () => {
  const o = { platform: 'linux', home: '/home/u' }
  const roots = ['/home/u/Projects', '/srv/work']
  assert.equal(pr.defaultWorkdir('design-team', roots, o), '/home/u/Projects/design-team')
  assert.equal(pr.defaultWorkdir('Design Team', roots, o), '/home/u/Projects/design-team')   // 英文转小写、空白换 -
  assert.equal(pr.defaultWorkdir('设计组', roots, o), '/home/u/Projects/设计组')               // 中文原样保留
  assert.equal(pr.defaultWorkdir('a/b:c', roots, o), '/home/u/Projects/a-b-c')                // 分隔符与 Windows 不认的字符不许漏进路径
  assert.equal(pr.defaultWorkdir('../..', roots, o), '/home/u/Projects/my-project')           // 只剩点和横线 ⇒ 当没名字,绝不跳出根目录
  assert.equal(pr.defaultWorkdir('', roots, o), '/home/u/Projects/my-project')
  assert.equal(pr.defaultWorkdir(null, roots, o), '/home/u/Projects/my-project')
  assert.equal(pr.defaultWorkdir('ops', [], o), '/home/u/Projects/ops')                       // 没配根目录 ⇒ 平台默认根
  assert.equal(pr.defaultWorkdir('ops', ['D:\\Projects'], { platform: 'win32', home: 'C:\\Users\\u' }), 'D:\\Projects\\ops')
  // 出来的默认值必须能原样通过向导的输入校验(回车即用,不能一回车就报错)
  assert.deepEqual(pr.workdirInput(pr.defaultWorkdir('Design Team', roots, o), o), { path: '/home/u/Projects/design-team' })
})
