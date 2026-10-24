# Icon system: the contract

English · [简体中文](./zh-CN/ICONS.md)

> Icons are **on the same level** as the design style (the icon library decides "where the shapes come from and what they are called"; the design style decides "how they are drawn"; a project chooses each separately; see the [icon system](#the-icon-system-an-entity-on-the-same-level-as-the-design-style) section below). This document is **the agreement itself**, not a user guide: goal, test criteria, deliberate exclusions, interface and costs. If any one of the five is missing, it isn't agreed.

## 1. Goal (what counts as done)

**Make icons a first-class dimension, declared, carried and checked, just like the palette.**

The problem isn't "one checker short"; it is that **consistency has no carrier**. The style file is the only thing carried in front of the agent across turns. If it says nothing about icons, colors, type, spacing and shadows are all settled while icons are a blank: each new page, the agent reinvents a set of paths, consistency is left to luck, **and nobody notices when it is lost** until someone spots it by eye.

⚠ **Consistency comes from "getting the right icon", not from "detecting inconsistency".** The checker is only a backstop: it can find inconsistency but can't create consistency. That is why the weight of this design is on `sbot design icon`, not `design check`.

## 2. Test criteria (experiments that tell two implementations apart)

Words can be read differently; experiments can't. Each of the following is a case that **must fail before the change**:

| Experiment | Expected | What it tells apart |
|---|---|---|
| The style file says `strokeWidth: 2`; the page CSS has `stroke-width: 1.8` | Reports "inconsistent stroke" | Whether the CSS is really read (the real case was in CSS, not in svg attributes) |
| Lucide and Tabler mixed on the same page | **No report** | Whether the criterion is "isomorphic parameters" or "same library name" |
| `<img src="x.png" width="20">` | Reports "raster image used as an action icon" | Whether there is a gate on rendered size |
| `<img src="banner.png" width="750">` | **No report** | Same as above (large images are illustrations / banners, not icons) |
| An svg with neither `aria-hidden` nor `aria-label` / `<title>` | Reports "missing accessible name" **as one summary**, not one by one | Whether the report turns into noise |
| The style file has no `icons` section | Zero icon warnings + one line "icon system not enabled" | Whether "no basis, no report" holds |
| Fetching an icon whose name the primary library lacks | Falls back to the fallback library automatically | Whether the two libraries are really wired together |
| A fetched Tabler icon | The placeholder box `<path d="M0 0h24v24H0z">` is stripped | Whether it is normalized, rather than the file spat out as is |
| `<button>🔍</button>` | Reports "emoji used as an icon" | — |
| `<p>New today ⚡ lots of 🎉</p>` | **No report** | Whether it judges **by position** or by character (the reference prototype has 1131 emoji; judging by character = 1131 lines of noise) |
| `<button>Start the quiz 🎉</button>` | **No report** | Emoji in the same run as text ⇒ copy, not an icon |
| `<view bindtap="x"><text>🔥</text></view>` | Reports | Whether mini-program tap bindings are recognized (recognizing only `onclick` misses the entire mini-program side) |
| `fill:none` and `fill:currentColor` on a 24 grid on the same page | Reports "outline and filled mixed" | — |
| Icons on the same page as a 200×200 illustration with fill | **No report** | Whether the mixing check goes through the size gate |
| The icon file says pixelart; the page's `home` is Tabler's path | Reports "icon source mismatch" | Whether anyone catches **forgetting to re-fetch after switching systems** |
| The same image, from a source matching the current system | **No report** | Whether the criterion is geometry or names |
| A name found in no library (badges / logos) | **No report** | Whether the project's own graphics get treated as "of unknown origin" |
| The current system's library isn't installed, and the page's image differs in geometry from other libraries | **No report** | Whether ③ cut corners into "if another library has the name, it's from that library" |
| An icon with `fill:none + stroke` on a page of a filled system | Reports "stroke-type icon" | Whether choosing a filled system makes source errors undetectable instead |
| The `<!-- icons: … -->` line at the top of a sprite is deleted | Reports "icon attribution isn't in these files" | Whether anyone notices the license notice being "tidied away" |
| Single-icon form (never carries attribution) | **No report** | Whether it accuses out of thin air |

**False-positive budget:** with a real deliverable (a 46 KB prototype page with 19 inline svgs) as the benchmark, **only 2 findings are allowed**: stroke 1.8 ≠ 2, and 18 icons missing accessible names. **Every extra finding is a false positive, and the criteria must be fixed.**

**The measured baseline after source checking was added** (findings `icon-a11y×18` · `icon-source×5`): **2** icon findings: one for missing accessible names (aggregated) · **one icon source mismatch** (`i-arrow-right` / `i-arrow-left` / `i-star` are **hand-written paths**; that deliverable predates the icon system by a day) · the stroke finding doesn't appear this time (phosphor is a filled system, so it is skipped by `form`). ⚠ **The third finding isn't a false positive but a real discovery:** it is exactly the "reinvent a set of paths for every page" problem. Another real deliverable, `mobile-app-prototype/app.html` (17 symbols), has **17/17 attributed to phosphor with zero warnings**; switching the icon file to another system ⇒ **all 17 are reported** (an experiment that tells two implementations apart).

## 3. Deliberately not done (trade-offs, not omissions)

- **Whether the icons' meaning / perspective / detail match the design mockups.** Comparing the page's images against **design mockups** is engineering of another order, and false positives are inevitable. This is ensured at **generation time** by `library` + `sbot design icon`, not by checking.
  ⚠ **"Does it come from the current system?" is different:** that has a definite answer (compare the geometry with the real file in the library), and it has been done; see [icon source checking](#icon-source-checking-the-fourth-criterion-of-design-check) below. Don't confuse the two: the first asks "does it look like the mockup", the second asks "where does it come from".
- **Telling icons apart from illustrations / product images / brand logos.** v1 uses **rendered size ≤32px** as a gate instead of classification.
- **"Report any size not in the file."** ⚠ Apple's HIG explicitly asks for adjusting individual icon sizes by visual weight ("you may need to adjust its dimensions"); reporting every value would flag its recommended practice as an error. It only adds a note when **the number of distinct sizes gets out of hand**.
- **Multi-library mapping tables, picking variants by optical size, duotone secondary colors.** This matches the deferred list in the upstream design.md spec, issue #41.
- **Mini-program base64 / mask-image techniques.** There are too many legitimate ways to write them, and judging each would inevitably raise false alarms; they are taught in the briefing, not machine-checked.

## 3b. Known false-positive gaps (recorded honestly; don't report them as bugs)

- **The stroke criterion scans the whole deliverable, not just icons.** If the page has SVG charts (line charts, pie charts), their `stroke-width` gets reported as icon stroke. Accepted: a criterion based on "does the selector look like an icon" would be more brittle, and the report already states that a finding "doesn't mean it's wrong". Narrow it only if it really becomes a nuisance, and only with real examples first.
- **`<img>` only recognizes double-quoted `width="20"` and inline `width:20px`.** Single quotes and tailwind's `w-5` aren't recognized ⇒ **missed reports**, not false ones. Better to miss.
- **`<img>` with unknown size is never examined.** Without a size, there is no telling whether it is an icon or an illustration, and a guess would be wrong half the time.
- **CSS `content: "★"` isn't checked.** That is also a glyph used as an icon, but it is mostly decoration (in the real deliverable, that ★ sits in a pseudo-element of a trophy badge), and reporting it would slide back into judging by character. **The miss is in the safe direction.**
- **The emoji check looks only at "the element's own text run":** `<button>Start 🎉</button>` isn't reported, `<button>🎉</button>` is. Emoji assembled by JS aren't recognized ⇒ **missed reports**.
  ⚠ **It must walk a tag stack, not use a matching-element regex** (`<el>(.*?)</el>` swallows the whole outer run, so **every nested clickable button is missed**, and in real pages buttons are almost always nested; pinned by tests).
  **What gets flagged** is an emoji used alone as an icon inside a clickable element (a close button's `✕`, a share button's `📤`); **what doesn't** is decorative badges and emoji in copy (prompts like `🎉 All done`). Judging by character would flag every emoji in the copy, and the noise would make it unusable.

## 4. Interface (the two files together are the contract)

⚠ The `icons` schema below is the **style file's** half (how to draw). `library` / `fallbackLibrary` / `semantics` / `assets` now belong to the **project's icon file**, `design/icons.md` (see the next section); the old placement in the style file is still honored **only when there is no icon file**.

It is a **separate top-level section** of the front matter. ⚠ **Never put it under `colors`.** `styleRoles` scans only the direct children of colors, so colors put there would join the role fallback, and a highly saturated one would take over accent on the spot (this is also why gradient / elevation / status got their own sections).

```yaml
icons:
  # ⚠ Of library / fallbackLibrary / semantics, the first two have moved to the project's design/icons.md (see the next section).
  #   With an icon file present, these two lines in the style file **have no effect whatsoever**; they stay here only to show "still honored without an icon file".
  #   semantics still lives in the style file and has the highest priority (the project's own business terms: rank / fans / boost…).
  style: "outlined"            # outline / filled (within what the chosen system supports)
  weight: "regular"            # weight level: only systems that declare weights honor it (such as phosphor's thin/light/bold/duotone)
  grid: 24px
  strokeWidth: 2               # ⚠ filled libraries (phosphor / pixelart) have no stroke; these three don't apply to them
  linecap: "round"
  linejoin: "round"
  color: "{colors.ink}"        # ⚠ a reference, not hex; writing hex quietly loosens the palette criterion
  size:                        # ⚠ must be indented as child keys: the front matter parser only builds trees by indentation;
    sm: 16px                   #    written as { sm: 16px }, it is swallowed whole as a string
    md: 18px
    lg: 24px
  semantics:                   # only the dozen or so most frequent; not exhaustive
    back: "chevron-left"
    more: "more-horizontal"
```

The six keys `library / style / strokeWidth / grid / size / color` are **taken as is** from the upstream design.md spec, issue #41. `fallbackLibrary / linecap / linejoin / semantics` are **our own extensions**, respectively because two libraries can be mixed (see below), stroke ends are part of the HIG's only unconditional requirement, and semantics move forward to generation time.

### The icon system: an entity on the same level as the design style

**Icon system = where the shapes come from + what they are called + how names are formed; design style = how they are drawn.**
The two are **on the same level and chosen separately**: switching styles shouldn't switch the icons too (putting `system` in the style file would tie icons to the style). The icon systems are **a table in the code**, not open to user customization ⇒ no user directory, form or save logic.

**It lives in a separate file in the project, `design/icons.md`**, alongside `design/styles/*.md`:

```yaml
---
system: "tabler"                      # which system (where the shapes come from + the whole naming)
assets: "miniprogram/images/icons"    # where icon files live (the scan scope for the asset check; separate several directories with commas)
fallback: "none"                      # don't fall back to the fallback library when an icon is missing (none/off/no/false all work; falls back by default)
---
```

⚠ **Why not the group config:** `sbot design icon` is run by the agent in the **project directory**. It can't reach the group config and doesn't know which group it belongs to, so the main route for fetching icons would break on the spot; cloning the project elsewhere would also lose the choice. The console's group card is the **entry point**; the project file is **where it lives** (the same approach as `design use`).

| System | Primary library | Form | Supports | Fallback |
|---|---|---|---|---|
| `lucide` | Lucide 2025 | Stroke-based, 24 grid | Outline | tabler |
| `tabler` | Tabler 5130 | Stroke-based, 24 grid | Outline · filled | lucide |
| `phosphor` | Phosphor 1512 | **Filled, 256 grid** | Outline · filled · **5 weights (including duotone)** | none |
| `pixelart` | Pixelarticons 1036 | **Filled · pixel grid** | Outline | none |

⚠ **Stroke-based vs filled is a harder divide than grid or stroke width.** A filled library's outlines are already converted to filled paths, so `strokeWidth` / `linecap` / `linejoin` **have no effect at all** on it ⇒ `checkIcons` branches on `form`; otherwise every deliverable of a project on such a system would get a string of false "stroke violations".

⚠ **Fallback only works between two systems with isomorphic parameters** (same form + same grid; pinned by tests). phosphor / pixelart have no isomorphic partner ⇒ **no fallback**: a vector outline icon popping up on a pixel-style page looks far worse than a missing image.

⚠ **Weight belongs to the style file** (`icons.weight`). It is the same thing as `strokeWidth`, expressed on two kinds of library: stroke-based libraries adjust stroke-width, filled libraries switch to a weight directory. ⚠ phosphor's six levels are **six independent sets of geometry**, and the regular level's file names have no suffix while the others carry a `-{weight}` suffix (`gear.svg` / `gear-bold.svg`), so every directory in the library definition declares its `suffix` explicitly.

⚠ **pixelart doesn't declare filled support.** Of the library's 1036 files, only **53** carry `-solid` (there are 651 base names after removing the `-solid` / `-sharp` variants ⇒ 53/651 coverage), so declaring filled support would be untrue. Its vocabulary also **honestly lacks three entries** (the library has no `medal`; `success` / `error` exist only as a bare check and cross, with no circled form). Forcing in a look-alike icon would be "doing A and letting people think you did B".

**How the two files combine:**

| Who answers | What it covers | Where it's written |
|---|---|---|
| The icon file | `library` / `fallbackLibrary` / the `semantics` vocabulary / `assets` | `design/icons.md` |
| The style file | `style` (outline / filled) / `strokeWidth` / `linecap` / `linejoin` / `size` / `color` | the `icons` section of `design/styles/*.md` |

The reason is measured: of the 16 built-in style files, **8 declare exactly these four: style / strokeWidth / linecap / corner** (across five levels: 1 / 1.25 / 1.5 / 2 / 3). Moving them out would void those 8 declarations on the spot; and "the same Tabler icons at 1.5px in a hand-drawn style and 2px in a Swiss style" is right to begin with.

**Why the system must also carry its "naming vocabulary"** (three measured findings):

| # | Finding | Data |
|---|---|---|
| F1 | A system encapsulates **the whole namespace**, not just a vocabulary | lucide has 2025 names / tabler 5130; **only 640 are shared** (32% of lucide, 12% of tabler) |
| F2 | Switching the primary library has real visual meaning ⇒ two systems are justified | For 8 common shared names (search/heart/user/settings/calendar/clock/filter/plus), the geometry differs **8/8** |
| F3 | ⚠⚠ **Fallback dilutes the primary look and can hollow out "choosing a primary library" entirely** | With tabler as primary but lucide's vocabulary ⇒ only 32% hit tabler, and **the other 68% fall back and get lucide's drawings** |

⇒ Letting a project just "choose a library" is **not enough**. The `semantics` vocabulary therefore belongs to the system: the same "more" is `more-horizontal` in lucide and `dots` in tabler; `delete` is `trash-2` on one side and `trash` on the other. The 62 vocabulary entries were **checked one by one against the real library files** (43 names shared by both libraries, 19 that differ). A vocabulary entry naming something the library lacks shows up as "fetching by semantic name says neither library has it".

**Compatibility:** without an icon file, `library` / `fallbackLibrary` / `assets` in the style file's `icons` section **are still honored** (projects already configured that way mustn't lose their icon source on the spot). When both places have them, the icon file wins, and `iconSourceConflict` speaks up, naming "these lines no longer have any effect". If "two consumers read different sources" stayed silent, one would stay correct for a long time while covering for the other staying broken.

**Declaring a style the system can't provide** ⇒ `iconSystemGap` speaks up (it only reports, never blocks): those icons won't come from the system you chose. If the fallback library has the same name, that image is used; if not, it falls back to the other drawing style, **which amounts to not having chosen this system**. ⚠ The wording follows the real result rather than saying "all taken from the fallback library": in testing, tabler's filled set covers only **48** of the 62 vocabulary entries, and the other 14 necessarily fall back to outline ⇒ **mixed output is normal**. The summary line when fetching icons therefore **reports the real `fill` of the images in hand** (a single criterion, `iconIsFilled`), rather than writing "filled" because that is what was declared.

**Entry points:** the CLI `sbot design icons` (which systems exist · which one this project uses) / `sbot design icons use <system>`; the **Icon library** section of the console's Models · Library page (next to the design style library, with 8 really rendered samples per system) + the **Icons** row on each group card in Groups · Projects (choosing one writes it into that project's `design/icons.md`). ⚠ Switching systems replaces the whole naming vocabulary, and **icons already fetched into pages don't change automatically** ⇒ the CLI needs `--force`, and the console asks for confirmation once.

### Both vocabularies accepted, and singular `icon:` too

People write these files, and they shouldn't be forced to remember SVG attribute names ⇒ **both ways of saying the same thing are accepted and normalized to the SVG one** (normalization happens only in `iconSpec`; don't write another copy elsewhere):

| Common way to write it | Normalized to | Notes |
|---|---|---|
| `style: line` / `linear` / `outline` | `outlined` | |
| `style: solid` / `fill` | `filled` | |
| `corner: sharp` / `round` | `linejoin: miter` / `round` | An explicit `linejoin` takes precedence over `corner` |
| `strokeWidth: "1.5px"` | `1.5` | `parseFloat` already handles it; no extra translation needed |

**A singular `icon:` section is equivalent to `icons:`** (when both are present, `icons` wins). The built-in style files mostly use the singular `icon:`; without honoring it, the symptom is "declared, yet reported as not enabled". The fallback lives in the **reading layer** rather than in changes to those files: `design use` copies presets into the project byte for byte, so changing the assets can't rescue files already copied out, while `withKeptSections` carries such sections through console round trips unchanged, so they don't rot. They declare only `style / strokeWidth / linecap / corner`, **exactly the four the checks use**, no more and no fewer ⇒ the fallback yields every checking capability without inventing anything on the author's behalf.

### Icon source checking: the fourth criterion of `design check`

The first three categories check "is it drawn right" (stroke / ends / accessible name / raster). This one checks **whether the image comes from the current icon system**.

⭐ **The case to catch:** the icon file says `system: pixelart`, while the page's `home` matches **Tabler's** path character for character: a sprite was fetched from Tabler, and after the system switched, nothing was re-fetched. The stroke / end / accessible-name checks don't report it, because **they don't check "where it came from"**; and "already-fetched icons don't change after a system switch" goes unattended if it relies on a reminder alone. ⚠ One layer worse: with a **filled** system chosen, `checkIcons` skips the three stroke items by `form`, and those are exactly the only criteria that could reveal "stroke-based icons mixed into the page" ⇒ **choosing a filled system makes source errors undetectable instead**.

**Four criteria, all deterministic facts:**

| # | Criterion | Needs the library installed? |
|---|---|---|
| ① | The source marker `data-icon="library/name"` names a library **other than the current system and its fallback** | No |
| ② | The name exists in the current system, but **the shape differs from the library's** | Yes |
| ③ | The name doesn't exist in the current system, and the shape is **identical character for character** to the same-named icon in **another library** | Yes |
| ④ | The current system is filled, yet the page has stroke-based icons (a filled library's shapes contain no stroke at all) | No |

**The source marker is left at production time:** `sbot design icon` adds `data-icon="tabler/home"` to every icon, and `--sprite` adds it to every `<symbol>`. ⭐ **A checker can only find inconsistency, and "being able to find it" depends on what production left behind.** Agents casually delete attribution in comment form (deliverables often have not a single `<!--` left); an attribute travels with the shape, and deleting it means touching every symbol.

⚠ **Where names come from:** the sprite's `<symbol id="…">`. **The whole id must be taken, not just our own `i-` prefix.** Agent-produced symbols often use self-invented prefixes like `id="p-house"`; recognizing only our own format would recognize none of them, and the output would be "no icons with a recognizable source", **which looks exactly like "checked, no problems"**. A candidate name from stripping a prefix (`^[a-z]{1,4}-`) **is only a guess**: names like `x-circle` start with a short segment themselves, and stripping it gives another real icon ⇒ a guessed name is accepted only as **positive evidence** of "identical geometry", and never used to claim "the shape differs".

Three "don't report" rules (all with tests):

1. **A name found in no library ⇒ not a word.** Badges / logos / brand graphics are the project's own legitimate graphics.
2. **③ must rest on geometry, not names alone.** When the current system's library isn't installed, "another library has this name" proves nothing.
3. **The fallback library counts as one of ours.** Falling back when an icon is missing is the designed route, not an error.

**"Not checked" must be said out loud** (silence on this dimension has three causes that look identical in a report): no icon system chosen / the current system's library isn't installed on this machine (only ① and ④ remain, reported as "only half checked") / no icons with a recognizable source in the files.

**How the geometry comparison works:** library files first go through **the same normalizer** (that is how the page's copy was produced), and all whitespace is removed before comparing; the normalizing step eats whitespace spanning lines inside `d=`, so a strict comparison would judge the same image as different. Removing whitespace could in theory cause collisions, but that only causes **missed reports**, the safe direction.

### Icon library attribution

The sprites we produce always carry `<!-- icons: Tabler — MIT -->` (Lucide is ISC, the other three are MIT, and **all require copies to keep the notice**). Agents rewriting deliverables often delete every comment, so it has to be checked.

⇒ `design check` reports one `icon-license` finding, but **only for the sprite form**: that comment line ships with the sprite, so "it was there and now it's gone" can be determined. The single-icon form has never carried attribution (the reminder goes to stderr) ⇒ demanding attribution there would be an accusation out of thin air. **Only one line per run**, and the wording leaves room for legitimate exceptions ("a notice placed elsewhere counts too, in which case ignore this"). One accusation that doesn't hold up gets the whole report thrown away.

### Icon asset check: `sbot design icon-assets`

`design check` checks **how pages are written**; this one checks **the icon files themselves**. They are two commands rather than one because their rhythms differ: the page check runs before every delivery, the asset check only when tidying up. Mixed into a delivery report, its dozens of lines would drown out what really needs attention.

The scan scope **must be declared and is never discovered automatically**:

```yaml
icons:
  assets: "miniprogram/images/icons"     # separate several directories with commas (the front matter parser doesn't take continued array lines)
```

⚠ Not discovering automatically comes from testing: in a real project, the same directory tree mixed `flame/` (200×200 illustrations), `badges/` (badges, naturally multicolored) and `dist/` (copies from the build). A report that scanned everything was useless.

It reports **three deterministic facts**, none needing visual judgment:

| What it reports | Why this |
|---|---|
| Not using `currentColor` (hard-coded colors) | ⭐ **The first link in the chain:** hard-coded colors ⇒ changing a color means saving another copy ⇒ copies multiply ⇒ no single source ⇒ changing one means finding every copy ⇒ in practice nobody changes it ⇒ drift sets in |
| Several files with identical shapes | The chain's consequence. The geometry fingerprint keeps only `d=` and the geometric attributes of basic shapes, **dropping all presentation attributes** ⇒ the same image in different colors necessarily lands in one group |
| Stroke / caps / joins / grid deviating from the declaration | The same criteria as `design check`, applied to files instead |

**A measured baseline from one project** (119 svgs): hard-coded colors 118/119 · 40 distinct color values · 30 groups of identical shapes covering 77 files (merging would save 47) · 3 stroke deviations · 6 grid deviations. `icons/colored/*` and `icons/*` have **identical geometry character for character and differ only in their hard-coded colors**; in the file list, the chain is a physical object. ⚠ **The geometry, on the other hand, is tidy** (same origin, exported from lucide) ⇒ what broke consistency was **processing after export**.

Three wording rules (all with tests):

1. **State facts, don't pass judgment.** Report "identical geometry", not "redundant": a mini program's tab bar selected / unselected states can only be two image files whose color can't change, so the same image in two colors is **forced by the platform**. Call a fact a defect, and once someone finds one finding that doesn't hold, they throw the whole report away.
2. **Truncation must be announced.** When the number of groups exceeds the limit, say "N more groups not listed"; otherwise "only 8 groups listed" gets read as "only 8 groups".
3. **List only, never change automatically.** Deleting icon files is irreversible, and "which name should stay" is a semantic judgment.

Exit codes: `0` clean / `3` findings / `1` command failed.

### ⚠ Without a declared `library`, the library follows `style`

**This is a fact, not a preference:** lucide has **zero filled icons** (`ICON_LIBS.lucide` has only one outline directory), so a `style: filled` file on lucide can't possibly work. A fixed lucide default would make it **silently get outline icons**, and "declared filled, got outline" is visible on the page at a glance. ⇒ Without `library`: `filled` ⇒ tabler, everything else ⇒ lucide. An explicit declaration always wins; when one is declared but can't provide filled icons, `iconStyleGap` speaks up (**it only reports, never blocks**), and the stderr summary line reports **what was actually obtained**, no longer echoing "filled" from the declaration; otherwise both places would mislead together.

**Three hard rules for fetching icons** (all in `readIcon` / `normalizeIconSvg`, each with a test):

1. **Names pass an allow list**, `^[a-z0-9][a-z0-9-]*$`, including those mapped through the semantics table. Names are joined into file paths, so `../` is always refused (any input at an entry point the agent can reach is untrusted).
2. **Filled icons aren't rewritten the outline way.** Tabler's `filled/` set is `fill="currentColor"` with no stroke; forcing `fill:none` + `stroke-width` on it would turn a filled shape into an outline. The criterion is **the source file's fill**, not the declared style.
3. **Lookup goes by style first, then by library.** ⚠ In testing, **not a single name is exclusive to filled** in either library (all 1054 filled names also exist in outline) ⇒ ordering only by library, `style: "filled"` would never get a filled icon, and the declaration would be empty words. Libraries have isomorphic parameters, so switching libraries is invisible; switching outline for filled is a different thing, so the style constraint is stronger.

**Why two libraries are allowed:** Lucide's and Tabler's distribution files have identical attributes, character for character: `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`. Isomorphic parameters ⇒ mixing them doesn't break the one unconditional requirement in Apple's HIG ("use the same stroke weight in every icon"). So the checker judges by **parameters**, not by library name. Phosphor (six weights) and Heroicons (292 icons, solid) aren't isomorphic, so they don't get the fallback slot.

## 5. Costs and rollback

- **The four packages total about 160 MB** (local du: lucide-static 61M · @tabler/icons 49M · @phosphor-icons/core 37M · pixelarticons 15M) ⇒ **they don't ship with sbot** (the tarball is only 640 KB); install them separately on the machine, the same approach as rembg.
- **Not installed = graceful degradation:** `sbot design icon` reports "can't fetch", the agent falls back to inventing paths, and `doctor` honestly flags a row. ⚠ **It doesn't block** (configuration-level policies are inherently unenforceable on a semi-trusted agent).
- **Licenses:** Lucide = ISC (copies must keep the copyright notice ⇒ inline / sprite output keeps one comment); Tabler = MIT. ⚠ **No SF Symbols at all:** their license only covers interfaces of software running on Apple platforms; web and cross-platform use are forbidden. Apple's HIG can be cited as a reference, but the symbols it recommends are off limits to us.
- **Rollback:** the `icons` section is purely additive; deleting it returns to the behavior without an icon system (the checker skips the whole category, and the briefing doesn't mention icons).

## 6. External references

- Apple HIG · Icons: consistent "size, level of detail, stroke thickness (or weight), and perspective"; "use the same stroke weight in every icon" (**the only unconditional sentence**); "use a vector format like PDF or SVG"; "Provide alternative text labels". ⚠ **The page has no numbers at all**, and **never mentions emoji**. Banning emoji as action icons is our own rule (reasons: they can't be colored, glyphs differ across platforms, and VoiceOver reads the emoji's name rather than the action); don't attribute it to Apple.
- The upstream design.md spec, issue #41, "add Iconography section and `icons.*` tokens": the source of the six keys.
- Lucide (installed 1.31.0 = 2025 icons) / ISC / 24 grid · stroke 2 · round; Tabler 6184 (outline 5130 + filled 1054) / MIT / 24 grid · 2px.
