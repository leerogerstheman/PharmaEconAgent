#!/usr/bin/env node
/**
 * 发布目录组装
 * ---------------------------------------------------------------
 * 把打包产物整理成用户能直接用的文件夹结构：
 *   药物经济学智能体\
 *     ├── 药物经济学智能体.exe   ← 唯一的启动入口，双击即用
 *     ├── 使用说明.txt
 *     ├── 快速上手.html          ← 不想开软件也能看
 *     ├── 我的报告\              ← 导出的报告
 *     ├── 知识库\                ← 可选：自建/增补知识库
 *     └── skills\                ← 可选：自定义分析流程
 *
 * 运行：node scripts/make-release.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RELEASE = path.join(ROOT, 'release');
const OUT = path.join(path.dirname(ROOT), '药物经济学智能体');
const EXE_NAME = '药物经济学智能体.exe';

const DIR_TARGET = path.join(RELEASE, 'win-unpacked');
const PORTABLE = path.join(RELEASE, EXE_NAME);

function log(s) { console.log(`[release] ${s}`); }

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

/**
 * 写文本文件。对 .txt 强制加 UTF-8 BOM ——
 * Windows 记事本在旧版本上默认按 GBK 打开无 BOM 的 UTF-8 文件，
 * 目标用户会看到满屏乱码。这是"面向小白"必须处理的细节。
 */
function writeText(p, content, { bom = false } = {}) {
  const buf = Buffer.concat([
    bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0),
    Buffer.from(content, 'utf-8'),
  ]);
  fs.writeFileSync(p, buf);
  log(`写入 ${path.relative(OUT, p)}`);
}
function writeFile(p, content) { writeText(p, content, { bom: p.endsWith('.txt') }); }

function main() {
  if (!fs.existsSync(PORTABLE)) {
    console.error(`[release] 找不到打包产物：${PORTABLE}\n请先运行 npm run dist`);
    process.exit(1);
  }

  ensureDir(OUT);
  fs.copyFileSync(PORTABLE, path.join(OUT, EXE_NAME));
  log(`复制 ${EXE_NAME} (${(fs.statSync(PORTABLE).size / 1024 / 1024).toFixed(1)} MB)`);

  // 使用说明（带 BOM，记事本不会乱码）
  const manual = path.join(ROOT, '使用说明.txt');
  if (fs.existsSync(manual)) {
    writeText(path.join(OUT, '使用说明.txt'), fs.readFileSync(manual, 'utf-8'), { bom: true });
  }

  // 空目录（带 .keep 以免被清理工具删掉）
  for (const d of ['我的报告', '知识库', 'skills']) {
    ensureDir(path.join(OUT, d));
  }
  writeFile(
    path.join(OUT, '我的报告', '.keep'),
    '你导出的报告会保存在这个文件夹里。\n导出的路径也可以在软件的"设置"页里看到。\n'
  );

  // 知识库自建说明
  writeFile(
    path.join(OUT, '知识库', '怎么加自己的资料.txt'),
    [
      '【可选功能】给软件添加你自己的资料',
      '',
      '软件内置了一套完整的药物经济学知识库，通常不需要动这里。',
      '如果你有老师发的讲义、课程 PPT 摘要、指定的参考文献，想让它们也能被查到，',
      '可以这样做：',
      '',
      '方法一：直接编辑 kb.json（适合熟悉文字处理的人）',
      '  1. 把软件里的 dist/kb.json 复制到这个文件夹，改名为 kb.json',
      '     （dist 文件夹在 exe 解压后的临时目录里；也可以直接从项目源码的 dist 拿）',
      '  2. 用记事本或 VS Code 打开，按现有格式追加条目',
      '  3. 保存后重新打开软件，"设置"页会显示"自定义知识库"',
      '',
      '方法二：只放一个补充文件（更简单）',
      '  新建 kb.json，内容写成一个最小结构：',
      '  { "chunks": [ { "id": "my-1", "title": "标题", "topic": "intro",',
      '                "content": "正文内容", "aliases": ["关键词"] } ] }',
      '  注意：如果用这个文件，软件会优先用它，而不再加载内置知识库。',
      '        所以更推荐把内置 kb.json 复制过来再修改，保留原有内容。',
      '',
      '条目字段说明：',
      '  id       唯一编号，不能重复',
      '  title    标题',
      '  topic    主题，见内置知识库的 topics 列表（intro/types/cost/effect/icer/...）',
      '  type     concept / formula / guideline / glossary / example',
      '  level    beginner / intermediate / advanced',
      '  content  正文，支持 Markdown（表格、公式、列表都可以）',
      '  source   出处，写给用户看',
      '  url      出处链接',
      '  year     年份',
      '  aliases  别词，检索时会一并匹配',
      '  tags     标签',
      '',
      '⚠ 不要把这个文件夹整个删掉，软件找不到自定义知识库时会自动回退到内置的。',
    ].join('\n')
  );

  writeFile(
    path.join(OUT, 'skills', '怎么加自定义分析流程.txt'),
    [
      '【可选功能】把一套固定的分析流程固化成"技能"',
      '',
      '如果你经常做同一类分析（比如每次都按同一套步骤算新型抗肿瘤药），',
      '可以把它写成一个 Skill 文件，软件在检索时会自动带上这套流程。',
      '',
      '做法：',
      '  1. 在这个文件夹里新建一个子文件夹，名字用英文，例如 "oncology-cea"',
      '  2. 在里面新建 SKILL.md，内容如下：',
      '',
      '---',
      'name: 肿瘤药成本效果分析',
      'description: 新型抗肿瘤药的一线/二线成本效果分析标准流程',
      'keywords: 肿瘤, 抗肿瘤药, 化疗, 靶向, 免疫治疗',
      'when_to_use: 用户要求分析肿瘤药、或提到癌/瘤/化疗时',
      '---',
      '',
      '# 肿瘤药成本效果分析流程',
      '',
      '1. 先确认决策问题：新一线还是二线？研究视角是医保还是社会？',
      '2. 目标人群按适应症的年报数算，不要用全人群',
      '3. 对照方案必须是最优现有治疗，不能用安慰剂',
      '4. 生存期效用值优先用文献同人群值，没有才做映射',
      '5. 模型建议 Markov 队列，年度周期，死亡为吸收态',
      '6. 基础分析后必做 PSA，用 Beta（效用）、Log-normal（成本）',
      '7. 报告要含预算影响，因为医保评审常同时看这两项',
      '8. 结论要写清楚在哪个阈值下结论成立',
    ].join('\n')
  );

  // 快速上手 HTML（双击就能看，不依赖 exe）
  writeFile(path.join(OUT, '快速上手.html'), quickStartHTML());

  // 统计
  const summary = [];
  (function walk(dir, depth) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const it of items) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) {
        summary.push(`${'  '.repeat(depth)}[目录] ${it.name}`);
        walk(p, depth + 1);
      } else {
        const kb = fs.statSync(p).size / 1024;
        summary.push(`${'  '.repeat(depth)}${kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb.toFixed(0) + ' KB'}  ${it.name}`);
      }
    }
  })(OUT, 0);

  log('\n发布目录已生成：' + OUT);
  console.log('\n' + summary.join('\n'));
  console.log('\n用户只需要双击 ' + EXE_NAME + ' 即可使用。');
}

function quickStartHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>药物经济学智能体 · 快速上手</title>
<style>
  :root{
    --primary:#6750a4; --on-primary:#fff; --primary-container:#e9ddff;
    --on-primary-container:#22005d; --surface:#fdf8fd; --surface-low:#f7f2f7;
    --surface-high:#ece7eb; --surface-highest:#e6e1e6; --on-surface:#1c1b1e;
    --on-surface-variant:#49454e; --outline:#7a757f; --outline-variant:#cac4cf;
    --success-container:#a8f2bd; --on-success-container:#00210e;
    --warning-container:#ffdf9a; --on-warning-container:#261a00;
    --error-container:#ffdad6; --on-error-container:#410002;
  }
  *{box-sizing:border-box}
  body{margin:0;font:17px/1.75 "Microsoft YaHei UI","Microsoft YaHei","PingFang SC",sans-serif;
       color:var(--on-surface);background:var(--surface)}
  .wrap{max-width:900px;margin:0 auto;padding:40px 24px 80px}
  header{background:var(--primary-container);color:var(--on-primary-container);
         padding:32px;border-radius:16px;margin-bottom:32px}
  h1{margin:0 0 8px;font-size:2rem}
  header p{margin:0;opacity:.85}
  h2{font-size:1.35rem;margin:36px 0 14px;display:flex;align-items:center;gap:10px}
  h2::before{content:"";width:5px;height:22px;background:var(--primary);border-radius:3px}
  h3{font-size:1.08rem;margin:20px 0 8px}
  .card{background:var(--surface-low);border:2px solid var(--outline-variant);
        border-radius:12px;padding:20px 24px;margin:14px 0}
  .launch{background:var(--primary);color:var(--on-primary);border-radius:12px;
          padding:22px 26px;margin:18px 0;text-align:center}
  .launch b{font-size:1.25rem;display:block;margin-bottom:8px}
  table{border-collapse:collapse;width:100%;margin:12px 0;font-size:16px}
  th,td{border:1px solid var(--outline-variant);padding:10px 12px;text-align:left}
  th{background:var(--surface-high)}
  code{background:var(--surface-highest);padding:2px 7px;border-radius:5px;
       font-family:Consolas,monospace;font-size:.92em}
  .ok{background:var(--success-container);color:var(--on-success-container);
      border-radius:10px;padding:16px 20px;margin:16px 0}
  .warn{background:var(--warning-container);color:var(--on-warning-container);
        border-radius:10px;padding:16px 20px;margin:16px 0}
  .no{background:var(--error-container);color:var(--on-error-container);
      border-radius:10px;padding:16px 20px;margin:16px 0}
  ul,ol{padding-left:1.5em}
  li{margin:6px 0}
  .foot{margin-top:48px;padding-top:20px;border-top:1px solid var(--outline-variant);
        font-size:15px;color:var(--on-surface-variant)}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>药物经济学智能体</h1>
    <p>用大白话学药物经济学 · 零配置 · 不联网也能用</p>
  </header>

  <div class="launch">
    <b>🚀 启动方法</b>
    双击同一文件夹里的 <code>药物经济学智能体.exe</code><br>
    等 3～10 秒，窗口打开就能用
  </div>

  <div class="ok">
    <b>不需要做的事：</b>不用装 Python、不用装 pip、不用装数据库、不用装 Node、不用配置任何东西。
  </div>

  <h2>第一次打开，先看这四个功能</h2>

  <div class="card">
    <h3>1️⃣ 智能问答 —— 从这里开始</h3>
    <p>在左下角的框里<b>用大白话打字</b>，按 <code>Enter</code> 发送。</p>
    <ul>
      <li>例如：<code>QALY 是什么意思</code>、<code>ICER 怎么算</code>、<code>为什么要做敏感性分析</code></li>
      <li>不知道问什么？点欢迎页上的 4 张卡片即可</li>
      <li>回答下方有"？问号"按钮，点一下就能接着问</li>
      <li>想看软件怎么查资料、怎么算的，点"查看思考过程"</li>
    </ul>
  </div>

  <div class="card">
    <h3>2️⃣ 计算器 —— 别手算</h3>
    <p>药物经济学的数字很容易算错（增量符号、量纲、折现）。用计算器代替手算，结果可直接用于作业核对。</p>
    <table>
      <tr><th>计算器</th><th>解决什么问题</th></tr>
      <tr><td>QALY 计算</td><td>把健康状态换算成可加总的年数</td></tr>
      <tr><td>ICER 增量成本效果比</td><td>多买 1 个 QALY 要多花多少钱</td></tr>
      <tr><td>INMB 净货币效益</td><td>换个阈值看结论会不会翻转</td></tr>
      <tr><td>PSA 概率敏感性分析</td><td>让参数带上随机性，看结论有多可靠</td></tr>
      <tr><td>单因素敏感性分析</td><td>找出最影响结论的那个参数</td></tr>
      <tr><td>折现（现值）计算</td><td>把不同年份的钱和效果换算到今天</td></tr>
      <tr><td>预算影响分析</td><td>这个新药上市后要多花多少钱</td></tr>
      <tr><td>决策树期望值</td><td>算期望成本与期望效果</td></tr>
      <tr><td>成本-效益分析</td><td>把收益也算成钱，算净现值</td></tr>
    </table>
    <p>每个输入框都有中文标签和单位，填错会明确告诉你"哪一项错了、应该怎么填"。</p>
  </div>

  <div class="card">
    <h3>3️⃣ 学习路径 —— 零基础系统学</h3>
    <p>13 步，从"药物经济学在解决什么问题"到"完整走一遍一个新药值不值得进医保"。每步都有"学什么"和"动手做"，学会一步打一个勾，进度自动保存。</p>
  </div>

  <div class="card">
    <h3>4️⃣ 自检清单 —— 交作业前自查</h3>
    <p>用 CHEERS 2022（28 条）逐条对照。清单里特别标出了几处最容易踩的坑。</p>
  </div>

  <h2>三种回答方式怎么选</h2>
  <table>
    <tr><th>方式</th><th>适合</th></tr>
    <tr><td><b>直接回答</b></td><td>单个问题，最快（默认）</td></tr>
    <tr><td><b>先规划再解答</b></td><td>"帮我完整分析一个药"这类多步骤任务，会先列计划再逐步执行</td></tr>
    <tr><td><b>回答后自查</b></td><td>检查作业，会再校一遍公式方向、符号和结论是否一致</td></tr>
  </table>

  <h2>关于联网</h2>
  <div class="ok">默认<b>不联网</b>。你的提问、聊天记录、设置都只存在你自己电脑上，不上传任何服务器。答案来自内置知识库，每条都标了出处。</div>
  <p>如果想要更自然的讲解，可以在「设置」里填一个 API Key（DeepSeek、通义千问、Kimi、智谱等）。不填也不影响使用——计算器、知识库、学习路径、自检清单全部照常可用。也可以选「本机 Ollama」完全本地运行。</p>

  <h2>遇到问题</h2>
  <div class="warn">
    <b>Windows 弹出"已保护你的电脑"？</b><br>
    点「更多信息」→「仍要运行」。这是因为软件没有购买商业代码签名证书，不是病毒。
  </div>
  <ul>
    <li><b>窗口打不开/白屏</b>：等 10 秒再试；关掉重开；仍不行就把整个文件夹复制到桌面再打开（中文路径有时会有问题）。</li>
    <li><b>不要只复制 exe</b>：要整个文件夹一起复制或解压。</li>
  </ul>

  <h2>这个软件不能做什么</h2>
  <div class="no">
    它是<b>学习辅助工具</b>，不构成医疗、用药或医保决策建议。知识库里的阈值和数字可能随政策更新而变化，正式引用请以原始指南与文献为准。软件不会替你做决定，只帮你把问题想清楚。
  </div>

  <div class="foot">
    <b>资料来源：</b>维基百科 Pharmacoeconomics 词条、《中国药物经济学评价指南（2020 中英双语版）》（T/CPHARMA 003-2020）、
    CHEERS 2022（Husereau 等，BMJ 2022;376:e067975）、NICE 技术评估手册 PMG36、
    WHO《Making Choices in Health》(2003)、ISPOR Good Practices 任务组报告、
    EVIDEM 框架（Goetghebeur 等，2008）、Drummond 等《Methods for the Economic Evaluation of Health Care Programmes》。<br><br>
    <b>Agent 框架：</b>参考 Datawhale《Hello-Agents》与 HelloAgents 开源框架（CC BY-NC-SA 4.0）。<br>
    <b>界面：</b>遵循 Material Design 3 规范，针对非技术用户强化了触控目标与可读性。<br><br>
    版本 1.0.0
  </div>
</div>
</body>
</html>`;
}

main();
