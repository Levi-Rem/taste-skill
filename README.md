> **中文使用手册（本仓库主页）** · [English README](README.en.md)

# taste-skill（`design-taste-frontend`）使用手册 · DSH 版

> 仓库：https://github.com/Levi-Rem/taste-skill　技能名：`design-taste-frontend`　版本：tasteskill 2.5.1
> 本手册对应已适配 DeepSeek Harness 的版本（提交 `4c034ac`）。

---

## 1. 它是什么

一套"反 AI 味"的网页设计技能：给编码代理一份完整的设计系统 + 素材库 + 浏览器检查器 + 收尾门（finish gate）。

- **输入**：一句业务描述（卖什么、卖给谁、主行动是什么）。
- **输出**：一个像 figma.com / x.ai 那种水准的公司站/落地页，以及一份带 `GATE:` 结论的报告。
- **组成**：`SKILL.md`（规则与流程）+ 22 份 `references/`（各素材族的用法）+ `scripts/`（发牌、检查、gate）+ `assets/`（1594 个文件：照片、图标、UI 片段、效果、场景、动效）。

**它不是** DSH 插件，不能用 `plugin_manager install_bundle` 安装。它在 DSH 里就是一个普通 skill 目录，靠技能目录自动匹配或 `/design-taste-frontend` 显式加载。

适用：公司站、SaaS 首页、产品页、游戏官网、工作室站、咖啡馆/民宿/小店、活动页。
不适用：后台管理系统的表单页、纯文档站、需要真实后端交互的应用。

---

## 2. 安装

### 2.1 三种方式（任选）

```bash
git clone https://github.com/Levi-Rem/taste-skill.git
cd taste-skill

# A. 用户级：装到 ~/.dsh/skills/design-taste-frontend（所有项目可用）
node install.mjs --dsh

# B. 项目级：装到 <git 仓库根>/.dsh/skills/design-taste-frontend（只对当前项目生效）
node install.mjs --dsh --project

# C. 手工复制（不需要 Node 也能装）
mkdir -p ~/.dsh/skills
cp -R skills/taste-skill ~/.dsh/skills/design-taste-frontend
```

`./install.sh --dsh` 等价于 A（bash 入口，内部调用 install.mjs）。

### 2.2 路径规则（装错地方最常见）

DSH 只在**固定几层**里找 skill，按优先级：

| 优先级 | 位置 | 说明 |
|---|---|---|
| 100 | `<项目根>/.dsh/skills/` | 项目级，最优先 |
| 200 | `<项目根>/.agents/skills/` | 项目级 |
| 300 | `Config.customSkillDirs` | 自定义目录 |
| 400 | `~/.dsh/skills/` | **用户级（推荐）** |
| 500 | `~/.agents/skills/` | 用户级 |
| 600 | `DSH_BUNDLED_SKILL_DIR` | 内置 |

- `<项目根>` = 最近的含 `.git` 的祖先目录，没有 `.git` 就用当前目录。
- **只扫一层**：必须是 `~/.dsh/skills/design-taste-frontend/SKILL.md`。把仓库整个丢进 `skills/` 会找不到。
- 同名 skill 前一个优先；目录名要与 frontmatter 的 `name` 一致才算干净。

### 2.3 验证

```bash
node install.mjs --list
```

```
dsh    user   C:\Users\LUO Lin\.dsh\skills  [installed]
```

装完**不用重启**，本轮会话的技能目录就会刷新（这一项已在 DSH 上实测）。当前状态：

```
~/.dsh/skills/design-taste-frontend/   1631 个文件
~/.dsh/skills/grill-me/                其他技能
```

### 2.4 卸载 / 升级

```bash
node install.mjs --dsh --uninstall     # 只删它自己装的那个目录和标记文件
node install.mjs --dsh --force         # 目录已存在且不是它装的时，强制覆盖
```

升级 = `git pull` 后重新 `node install.mjs --dsh`（先写临时目录再原子替换，中途失败不会留半套）。

---

## 3. DSH 与 Claude Code 的差异（必读）

| 项目 | Claude Code / Codex | DSH |
|---|---|---|
| 自动收尾 gate | `hooks: Stop` 自动跑 | **没有 hook**，要手动跑 `node <skill>/scripts/gate.mjs <page>` |
| skill 路径变量 | `${CLAUDE_SKILL_DIR}` | 加载结果会打印 `Base directory for this skill: <path>`，用它当 `<skill>` |
| frontmatter 未知键 | 报错或忽略 | 只认 `name`/`description`/`whenToUse`/`metadata`/`disable-model-invocation`/`user-invocable`，**其它键静默忽略**（`hooks:` 就是这样保留下来给 CC/Codex 用的） |
| 旧式驼峰键 | — | `disableModelInvocation` 等会让 DSH **丢弃整个 skill**，必须用 kebab-case |
| 目录描述长度 | 不限 | catalog 只保留 **前 500 字符**（当前描述 497） |

`hooks:` 键我特意保留了：DSH 忽略它，Claude Code/Codex 上仍有自动收尾。

---

## 4. 五分钟跑通

前提：Node 22+、Chrome/Edge/Chromium 之一；一个空目录（或在你的项目里）。

```bash
# 0. 进你的项目目录
cd ~/projects/my-site

# 1. 把技能素材拷进来，从 starter 起步
cp -R "C:\Users\LUO Lin\.dsh\skills\design-taste-frontend\assets" ./assets

# 2. 上锁：在任何页面存在之前先开 build（记住 category 写"卖什么"，primary 写"主行动"）
node "C:\Users\LUO Lin\.dsh\skills\design-taste-frontend\scripts\gate.mjs" \
  --start index.html --kind software \
  --category "shared inbox for small support teams" \
  --primary "Start a 14-day trial"

# 3. 发牌（不要凭手感选配色/字体/版式）
node "C:\Users\LUO Lin\.dsh\skills\design-taste-frontend\assets\layout\deal.mjs" \
  --type software --has photo,ui --history .taste-skill/layout-history.json
node "C:\Users\LUO Lin\.dsh\skills\design-taste-frontend\scripts\start.mjs" \
  deal --page software --trade saas --history .taste-skill/history.json
node "C:\Users\LUO Lin\.dsh\skills\design-taste-frontend\scripts\start.mjs" \
  css --page software --palette <id> --type <id> --radius soft      # 打印 :root，原样贴进页面

# 4. 写页面（基于 assets/starter.html 与 assets/layout/hero-<id>.html）

# 5. 检查
node "C:\Users\LUO Lin\.dsh\skills\design-taste-frontend\scripts\copy-lint.mjs" index.html --kind software
node "C:\Users\LUO Lin\.dsh\skills\design-taste-frontend\scripts\consistency.mjs" index.html \
  --widths 1440,1024,820,768,390 --rhythm-widths 1440,820,768,390 \
  --profile .taste-skill/chrome-check --page software \
  --category "shared inbox for small support teams" --primary "Start a 14-day trial"

# 6. 收尾门（直到最后一行是 GATE: PASS 或 GATE: OPEN，最多 3 轮）
node "C:\Users\LUO Lin\.dsh\skills\design-taste-frontend\scripts\gate.mjs" index.html
```

在 DSH 里更省事的写法：让代理先加载技能，然后说「用 design-taste-frontend 给我做一个 XX 公司的官网，主行动是 XX」。代理会自己跑完上面这一串，并用 Base directory 拼出脚本路径。

---

## 5. 完整流程（技能规定的 7 步）

### 第 0 步：判断项目形态

- **空目录** → 静态页：把 `<skill>/assets` 拷成 `./assets`，从 `assets/starter.html` 开始。
- **已有项目（React/Next/Vue/Svelte/Astro/Tailwind）** → 在它自己的技术栈里写，把 kit 拷到 `public/assets` 当普通文件加载。
- **Next.js** → 静态导出（`output: 'export'`），检查构建产物（`--root out`）。

### 第 1 步：读 brief，先上锁

先写下四件事：**kind**（见下表）、卖什么、谁买、**唯一主行动**（Book a room / Order a cake / Start a free trial；没有交易的 place 用 Get directions）。

然后 `gate.mjs --start …` 开一个 build。它是"先立契约再施工"，后面所有检查都以这个 build 为上下文。

**kind 判定表**

| brief | page type | site-kind | `--kind` |
|---|---|---|---|
| App、SaaS、AI、开发者工具、金融应用 | software | software | software |
| 游戏、工作室发游戏 | software | gaming | gaming |
| 硬件/科技设备（无人机、机械臂、键盘） | product | tech | tech |
| 其它实物或品牌（椅子、自行车、咖啡豆） | product | other | product |
| 招人来的：诊所、律所、代理公司、创意工作室 | service | other | service |
| 人来店的：咖啡馆、面包房、餐厅、民宿、小店、健身房 | place | other | place |

自己动手、也卖货的（陶艺工作室、带网店的面包房）算 **place**，网店部分是其中的 goods 区块。

### 第 2 步：先写文案，再动页面

按 `copy-voice.md` 建事实表与声音卡：h1 要点明品类与买家/地点；首屏至少一条硬事实；每个标题有名词；按钮 = 动词 + 宾语。除了杜撰的品牌名（先搜索，结果存 `names.json`）和 place 的营业时间/价格（标记 `data-assumed`），**不许编**。

### 第 3 步：把页面拆成"屏"

计划第一行写 kind，第二行写发牌结果（palette 及为什么符合这个行业），然后每屏一行：区块 id、一句话主张、配图类型、占几屏、哪一屏放 moment（tech 还要写效果或场景）。**一屏一个 section**，hero 独占首屏。

### 第 4 步：发牌，不靠手感

```bash
node <skill>/assets/layout/deal.mjs --type <page type> --has <photo,ui,film,object,setting> \
  --history .taste-skill/layout-history.json
node <skill>/scripts/start.mjs deal --page <kind> --trade <trade> --history .taste-skill/history.json
node <skill>/scripts/start.mjs css  --page <kind> --palette <id> --type <id> --radius soft
node <skill>/scripts/start.mjs brand --page place --bg "#.." --ink "#.." --accent "#.." --type <id>
node <skill>/scripts/moments.mjs pick --page <kind> --count 1|2 --fits section,statement --photo
```

规则：取**第一条** palette 与第一组搭配（除非与客户 logo/照片冲突）；客户有自己的颜色走 `brand`；**永远不用紫罗兰色**；radius：金融/开发者工具 `sharp`，默认 `soft`，消费应用 `round`，place 用直角。

### 第 5 步：搭建

在 `starter.html` 上设置 `<html lang data-type data-radius data-buttons data-motion>`、三个 meta、head 块、nav class；只从 `assets/layout/hero-<id>.html` 拷 hero 那一段；每个 section 是 `main > section` + 一个 `.wrap` + h2 打头。UI 片段从 `assets/ui/<name>/fragment.html` 取，把名字/数字/logo 换成客户的；图标最后跑 `icons.mjs scan`。

### 第 6 步：检查与"看"

只用技能自带脚本，一次一个、前台跑（它们自己起无头 Chrome，10 分钟超时，跑完按 PID 关掉）。**不要**用浏览器工具、不要后台跑。

```bash
node <skill>/scripts/copy-lint.mjs index.html --kind <kind>          # 不开浏览器，秒出
node <skill>/scripts/consistency.mjs index.html --widths 1440,1024,820,768,390 \
  --rhythm-widths 1440,820,768,390 --profile .taste-skill/chrome-check \
  --page <kind> --category "…" --primary "…"
node <skill>/assets/layout/check.mjs --url index.html --profile .taste-skill/chrome-check \
  --sizes 1440x900,1024x768,820x1180,768x1024,390x844 --shots shots/layout
node <skill>/scripts/shoot.mjs --url index.html --w 1440 --out shots/1440.png --profile .taste-skill/chrome-check
node <skill>/scripts/perf.mjs index.html --profile .taste-skill/chrome-check
node <skill>/scripts/gate.mjs index.html                              # 收尾门
```

修完重跑，直到 `GATE: PASS` 或 `GATE: OPEN`（最多 3 轮）。每次都得看截图，不要只看 JSON。

### 第 7 步：报告

`GATE:` 行放最前；然后列：waiver 及理由、未解决的 FAIL、kind 与发牌结果、声音卡一句话、检查器/版式/性能结果、没能检查的项、所有假设事实、素材缺口与客户槽位。

---

## 6. gate 结果怎么读

| 末行 | 含义 | 怎么办 |
|---|---|---|
| `GATE: PASS` | 全过 | 交付 |
| `GATE: OPEN` | 还有未解决项（有 waiver 或超轮次） | 在报告里列出 |
| `GATE: OFF` | 当前目录没有 active build | 先 `--start` |
| `GATE: SETUP` | 没有可打开的页面（还是框架源码壳/非本地页） | 按第 1 步给个能打开的页面再跑 |
| `GATE: ERROR` | 检查跑不起来（多半是浏览器/端口问题） | 证据写进报告，别反复重跑 |
| `GATE: DONE` | 用户叫停、按现状交付 | 报告里列 open FAIL |
| `GATE: FAIL n (round k of 3)` | 第 k 轮，n 个失败 | 按列表修，再跑 |

- 判定为误报的 FAIL 写进 `.taste-skill/waivers.json` 并写理由，**不许改检查器**。
- 不许改 `assets/`、`scripts/` 里的 kit 文件来"消掉"检查——这是技能明令禁止的。
- build 状态存在项目里的 `.taste-skill/build.json`，与技能目录无关。

---

## 7. 常见问题

**Q：为什么 `plugin_manager install_bundle` 找不到它？**
它不是插件，没有 bundle manifest；DSH 的 skill 只靠目录扫描。装到 `~/.dsh/skills/design-taste-frontend/` 即可。

**Q：装好但技能列表里看不到？**
① 检查是不是多套了一层（必须 `.../design-taste-frontend/SKILL.md`）；② 目录名与 `name` 不一致时可能被判重名；③ 换了工作区/项目时项目级路径变了；④ 描述超过 500 字符会被截断（仍会显示，只是不完整）。

**Q：为什么它不自己跑最后的 gate？**
DSH 没有 stop hook。手动 `node <skill>/scripts/gate.mjs <page>`，或让代理在收尾时跑。

**Q：能装在项目里而不是用户目录吗？**
能：`node install.mjs --dsh --project`，落到 `<git 根>/.dsh/skills/`。适合"这个站专用"的设计系统，也方便跟仓库一起走。

**Q：需要联网/API key 吗？**
不需要。脚本零依赖、离线可跑；照片是本地素材库 + 可选实况搜索。

**Q：在 Windows 上稳吗？**
已实测：Node 24 + Chrome 全链路（发牌、consistency、check、gate、截图）通过。若你只有 Edge，检查器会回退到 Edge（`CHROME_PATH` 可显式指定浏览器）。

**Q：可以把 `assets/` 放进已有 React 项目吗？**
可以，放 `public/assets`，按普通静态文件引用；页面在项目自己的组件里写。

**Q：技能描述能改吗？**
能，但文件名/name 与目录名要保持一致，description 别超过 500 字符（当前 497，余量很小）。

---

## 8. 目录速览

```
taste-skill/
├── install.mjs              安装器（零依赖，Node 18+）
├── install.sh               bash 入口，--dsh 委托给 install.mjs
├── DSH.md                   DSH 安装/差异/排错（英文）
├── skills/taste-skill/
│   ├── SKILL.md             规则 + 7 步流程（395 行）
│   ├── references/          22 份：sections、layout-v4、copy*、photos、motion…
│   ├── scripts/             gate / consistency / copy-lint / photos / icons / shoot / perf…
│   ├── library/             palettes.json、type.json（发牌数据）
│   └── assets/              1594 个文件：照片、图标、UI 片段、效果、场景、hero、moment
├── tests/                   dsh-compat.mjs（DSH 契约测试）+ frontmatter / kit-clean / encoding
└── package.json             npm test
```

深入阅读顺序：`SKILL.md` → `references/sections.md` → `references/layout-v4.md` → `references/copy.md` → 按页面用到的素材族看对应 reference。

---

## 9. 一页速查

```bash
# 安装 / 查看 / 卸载
node install.mjs --dsh
node install.mjs --list
node install.mjs --dsh --uninstall

# 开 build（先锁契约）
node <skill>/scripts/gate.mjs --start index.html --kind <kind> --category "<卖什么>" --primary "<主行动>"

# 发牌
node <skill>/assets/layout/deal.mjs --type <page type> --has <photo,ui,film,object,setting>
node <skill>/scripts/start.mjs deal --page <kind> --trade <trade>
node <skill>/scripts/start.mjs css --page <kind> --palette <id> --type <id> --radius soft
node <skill>/scripts/moments.mjs pick --page <kind> --count 1|2 --fits section,statement

# 检查
node <skill>/scripts/copy-lint.mjs index.html --kind <kind>
node <skill>/scripts/consistency.mjs index.html --widths 1440,1024,820,768,390 --profile .taste-skill/chrome-check --page <kind> --category "…" --primary "…"
node <skill>/assets/layout/check.mjs --url index.html --sizes 1440x900,1024x768,820x1180,768x1024,390x844
node <skill>/scripts/shoot.mjs --url index.html --w 1440 --out shots/1440.png
node <skill>/scripts/perf.mjs index.html

# 收尾
node <skill>/scripts/gate.mjs index.html
node <skill>/scripts/gate.mjs --done "<用户原话>"
```

`<skill>` = 技能加载时打印的 `Base directory for this skill:` 路径，本机为
`C:\Users\LUO Lin\.dsh\skills\design-taste-frontend`。

