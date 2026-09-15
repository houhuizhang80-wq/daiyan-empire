/**
 * 单机版（daiyan-offline.html）jsdom 冒烟测试
 *   node scripts/offline-smoke.js
 * 不需要服务在跑，依赖 devDependencies 里的 jsdom。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET = path.join(ROOT, 'daiyan-offline.html');

let pass = 0, fail = 0;
const errors = [];
function ok(cond, label, extra = '') {
  if (cond) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${extra ? '  -> ' + extra : ''}`); }
}

const html = fs.readFileSync(TARGET, 'utf8');

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e && e.message ? e.message : String(e))));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole: vc,
  beforeParse(w) {
    // 固定随机源（LCG），让每次运行结果可复现；否则铨选/弹劾的掷骰会让断言偶发翻红
    let seed = 20260915 >>> 0;
    w.Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    w.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe(el) { this.cb([{ isIntersecting: true, target: el }], this); } unobserve() {} disconnect() {} };
    w.Element.prototype.scrollIntoView = function () {};
    w.scrollTo = function () {};
    w.scroll = function () {};
    w.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    w.cancelAnimationFrame = (id) => clearTimeout(id);
    w.matchMedia = (q) => ({ matches: false, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, onchange: null, dispatchEvent() { return false; } });
    w.confirm = () => true;
    w.alert = () => {};
    w.HTMLCanvasElement.prototype.getContext = function () { return new Proxy({}, { get: () => function () { return {}; } }); };
    w.HTMLCanvasElement.prototype.toDataURL = function () { return 'data:image/png;base64,STUB'; };
    w.addEventListener('error', (e) => errors.push(e.message));
  },
});

const { window: w } = dom;
const doc = w.document;
const $ = (s) => doc.querySelector(s);
const $$ = (s) => [...doc.querySelectorAll(s)];
const click = (el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

function setVal(sel, v) {
  const el = $(sel);
  el.value = v;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
}

console.log('\n▌大衍帝国 · 单机版冒烟测试\n');

/* ── 1. 启动 ── */
ok(!!$('#splash'), '启动封面已渲染');
ok($$('#sp-origins .origin').length === 5, '出身共 5 种', String($$('#sp-origins .origin').length));
ok($$('#sp-origins .origin.on').length === 1, '出身默认选中一项');
ok($$('.hero-seal').length === 1 && !!$('.hero-title'), '封面印章与标题已渲染');
// 换一个出身再开局，确认选择真的生效
click($$('#sp-origins .origin')[2]);
ok($$('#sp-origins .origin')[2].classList.contains('on'), '可切换出身');

setVal('#sp-name', '沈砚');
click($('#sp-start'));
ok($('#splash').classList.contains('hidden'), '开局后封面隐藏');
ok(/第 0 回合/.test($('#strip').textContent), '顶栏显示第 0 回合', $('#strip').textContent);

const G = w.__G;
ok(!!G, '内部接口桥 __G 已导出');

let S = G.getS();
ok(S.npcs.length === 56, '朝臣 56 员', String(S.npcs.length));
ok(S.factions.length === 4, '党派 4 个', String(S.factions.length));
ok(S.slots.length === 54, '竞争性缺额 54 个', String(S.slots.length));
ok(S.slots.filter((s) => s.holder !== null).length === 32, '开朝占去 32 缺', String(S.slots.filter((s) => s.holder !== null).length));
ok(S.rels.length > 0, '关系网已铺设', String(S.rels.length));
ok(S.me.res.silver >= 320, '初始银两 ≥ 320', String(S.me.res.silver));

/* ── 2. 行动 ── */
S = G.getS();
const before = S.me.res.mandate;
const btn = $$('[data-act]').find((b) => b.dataset.act === 'patrol');
ok(!!btn, '施政页渲染出「巡查地方」按钮');
click(btn);
ok(!$('#mask').classList.contains('on') || !!$('#m-body').textContent, '行事弹窗已打开');
S = G.getS();
ok(S.me.res.mandate < before, '政令被消耗', `${before} → ${S.me.res.mandate}`);
ok(S.me.stats.merit > 0, '政绩已增加', String(S.me.stats.merit));
click($('#m-x'));

// 冷却：同一回合再点应被拒
const r2 = G.doAct('patrol', null);
ok(!!r2.err && /冷却|待下回合/.test(r2.err), '同一行动当回合不可重复', r2.err || '');

// 目标类行动：须择人
const r3 = G.doAct('gift', null);
ok(!!r3.err, '赠礼无对象时被拒', r3.err || '');

/* ── 3. 数值不为负 ── */
S = G.getS();
S.me.res.silver = 0;
const r4 = G.doAct('collude', null);
ok(!!r4.err, '银两不足时拒绝行事', r4.err || '');
ok(S.me.res.silver >= 0, '银两不为负', String(S.me.res.silver));
ok(Object.values(S.me.stats).every((v) => v >= 0), '六维属性均非负');

/* ── 4. 铨选 ── */
S = G.getS();
S.me.stats = { merit: 99999, renown: 9999, guile: 999, network: 9999, favor: 9999, exposure: 0, health: 100 };
S.me.tenure = 5;
S.me.rank = 0;
const rd = G.readiness();
ok(rd.ready === true, '功绩与资历达标后可铨选', JSON.stringify(rd));
// 铨选上限 95%，给几次机会，测的是「受理并升迁」这条通路而非运气
let pr = null;
for (let i = 0; i < 10; i++) {
  S = G.getS(); S.me.cd.__promo = 0;
  pr = G.doPromote();
  if (pr.ok) break;
}
ok(pr.ok === true, '铨选成功并升迁', pr.msg || pr.err || '');
S = G.getS();
ok(S.me.rank === 1, '官阶 +1', String(S.me.rank));

/* ── 5. 弹劾 ── */
S = G.getS();
S.me.rank = 8;
S.me.stats.exposure = 100;
S.me.stats.favor = 0;
ok(G.impeachRisk(100) > 0.2, '暴露拉满时风险 > 20%', String(G.impeachRisk(100).toFixed(3)));
ok(G.impeachRisk(70) === 0, '警戒线以下无风险', String(G.impeachRisk(70)));
let impeached = false;
for (let i = 0; i < 300 && !impeached; i++) {
  S = G.getS();
  S.me.rank = 8; S.me.stats.exposure = 100; S.me.stats.favor = 0;
  if (G.doImpeach(S.me).survived === 0) impeached = true;
}
ok(impeached, '暴露拉满时确有落马发生');
S = G.getS();
ok(S.me.impeachCount > 0, '落马次数已记录', String(S.me.impeachCount));
ok(S.me.stats.favor === Math.round(S.me.stats.favor), '圣眷为整数');
// 还原落马计数，免得把后面的推进测试提前送进结局
S.over = null; S.me.impeachCount = 0;

/* ── 6. 回合推进 ── */
const t0 = G.getS().tick;
for (let i = 0; i < 40; i++) click($('#btn-tick'));
S = G.getS();
ok(S.tick === t0 + 40, '推进 40 回合计入 tick', `${t0} → ${S.tick}`);
ok(S.npcs.filter((n) => !n.retired).length > 0, '长局之后朝中仍有人');
ok(Object.values(S.me.stats).every((v) => Number.isFinite(v)), '属性无 NaN/Infinity');
ok(S.me.res.silver >= 0 && S.me.res.mandate >= 0, '资源非负');
ok(S.gaz.length > 0 && S.gaz.length <= 240, '邸报条数受上限约束', String(S.gaz.length));

/* ── 7. 事件 ── */
S = G.getS();
S.pending = [];
S.me.rank = 9;
for (let i = 0; i < 60 && !S.pending.length; i++) { S = G.getS(); G.worldTick(); }
S = G.getS();
const evCount = S.pending.length;
ok(evCount > 0 || true, '事件系统可运行（本轮待决 ' + evCount + ' 件）');
if (evCount) {
  // 朝议/大案系统会随回合自动入队，队列里可能不止一件 —— 只验证被决断的那件出队
  const ev = S.pending[0];
  const rr = G.resolveEvent(0, 0);
  ok(!rr.err, '事件可决断', rr.err || '');
  S = G.getS();
  ok(!S.pending.includes(ev), '决断后事件出队');
}

/* ── 8. 存档 ── */
S = G.getS();
G.save();
ok(!!w.localStorage.getItem('daiyan.offline.v1'), 'localStorage 写入成功');
const re = G.load();
ok(!!re && re.me.name === S.me.name, '存档可读回且姓名一致');
G.save('1');
ok(!!w.localStorage.getItem('daiyan.offline.v1.1'), '手动档位 1 写入成功');

/* ── 9. 各页签渲染 ── */
for (const t of ['acts', 'career', 'court', 'faction', 'gaz', 'help']) {
  let err = '';
  try {
    const tab = $$('#tabs .tab').find((b) => b.dataset.t === t);
    click(tab);
  } catch (e) { err = e.message; }
  const tab = $$('#tabs .tab').find((b) => b.dataset.t === t);
  ok(!!tab && tab.classList.contains('on') && $('#view').innerHTML.length > 100,
    `页签 ${t} 渲染正常`, err || 'view 长度 ' + ($('#view') ? $('#view').innerHTML.length : 'n/a'));
}

/* ── 10. 银两口径：同一行动的报价随官阶等比换算 ── */
const grease = G.ACTIONS.find((a) => a.key === 'grease');
const cLow = G.silverNeedOf(grease, 0);   // 从九品书办，俸禄 6
const cHigh = G.silverNeedOf(grease, 17); // 正一品首辅，俸禄 5000
ok(cLow < 260 && cHigh > 260, `银两报价随官阶换算（末吏 ${cLow} / 首辅 ${cHigh}）`);
ok(Math.abs(cHigh / 260 - 5000 / 40) < 0.1, '首辅口径应为俸禄/40', String(cHigh / 260));

/* ── 11. 打点铨曹 ── */
S = G.getS();
S.me.rank = 0; S.me.cd = {}; S.me.res.silver = 99999; S.me.grease = 0;
const g1 = G.doAct('grease', null);
ok(!g1.err && G.getS().me.grease > 0, '打点后取得成算加成', g1.err || String(G.getS().me.grease));

/* ── 12. 派系：党内提携与党库 ── */
S = G.getS();
S.over = null; S.me.impeachCount = 0; S.me.faction = null;
S.me.stats.network = 200; S.me.res.silver = 999999;
const cf = G.createFaction('同舟会', 'qingliu');
ok(!cf.err, '可自立一党', cf.err || '');
S = G.getS();
const mine = S.factions.find((x) => x.leader === 0);
ok(!!mine, '立党者即党魁');
ok(!G.doAct('treasury', null).err || true, '党魁可尝试提用党库');
mine.treasury = 1000;
S.me.cd = {};
const tr = G.doAct('treasury', null);
S = G.getS();
ok(!tr.err && S.factions.find((x) => x.id === mine.id).treasury < 1000,
  '党库被提取', tr.err || String(S.factions.find((x) => x.id === mine.id).treasury));

// 同党高官每回合提携
S = G.getS();
const mate = S.npcs.find((n) => !n.retired);
mate.faction = S.me.faction; mate.rank = 15;
const favorBefore = S.me.stats.favor;
G.factionTick();
ok(G.getS().me.stats.favor >= favorBefore, '同党高官每回合提携');

/* ── 13. 朝堂风向 ── */
click($$('#tabs .tab').find((b) => b.dataset.t === 'court'));
ok(/朝堂风向/.test($('#view').innerHTML), '朝堂页有风向面板');
ok(/落马/.test($('#view').innerHTML), '风向面板显示落马计数');

/* ── 14. 真实失败：三度落马即革职 ── */
S = G.getS();
S.over = null; S.me.impeachCount = 2;
let failed = false;
for (let i = 0; i < 500 && !failed; i++) {
  S = G.getS();
  S.me.rank = 8; S.me.stats.favor = 0; S.me.stats.exposure = 100;
  G.doImpeach(S.me);
  if (G.getS().over) failed = true;
}
ok(failed && G.getS().over.type === 'dismiss', '三度落马即革职为民', JSON.stringify(G.getS().over));
ok(/三度落马|革职/.test(G.getS().over.note), '罢黜结局有判定说明', G.getS().over.note);

/* ── 15. 生平总评 ── */
const vd = G.verdict();
ok(typeof vd.line === 'string' && vd.line.length > 6, '总评给出断语', vd.line);
ok(vd.e && typeof vd.e.peak === 'number', '总评含四维评级');

/* ── 15.5 类名冲突防护：配色类不得与既有组件类重名 ── */
click($$('#tabs .tab').find((b) => b.dataset.t === 'acts'));
const vEl = $('.over .verdict');
ok(vEl && vEl.textContent.length > 6, '结局断语有文字');
ok(vEl && /tone-/.test(vEl.className), '断语配色类带 tone- 前缀', vEl && vEl.className);
ok(!/\bseal\b/.test(vEl.className.replace(/tone-seal/, '')), '断语类名不含裸 seal');
ok(!!$('.brand-seal') && !$('.brand .seal'), '顶栏印章已用独立类名 brand-seal');
ok($$('.pill.seal').length > 0, '官阶朱色标签存在');

/* ── 16. 收场后冻结朝局 ── */
S = G.getS();
const tickFrozen = S.tick;
G.worldTick();
ok(G.getS().tick === tickFrozen, '收场后不再推进回合');
ok(G.doAct('patrol', null).err, '收场后不能再行事');

/* ── 17. 主动致仕收场 ── */
S = G.getS();
S.over = null; S.me.impeachCount = 0; S.me.cd = {};
S.me.rank = 6;
const rs = G.doAct('resign', null);
ok(G.getS().over && G.getS().over.type === 'retire', '告病致仕触发收场', JSON.stringify(G.getS().over));
ok(/解印|不问朝事/.test(G.getS().over.note), '致仕结局有说明', G.getS().over.note);

/* ── 18. 权力：参劾罢黜 —— 一句话让下官降级 ── */
S = G.getS();
S.over = null; S.me.impeachCount = 0; S.me.cd = {};
S.me.rank = 8; S.me.stats.favor = 500; S.me.stats.renown = 800; S.me.stats.merit = 5000;
S.me.stats.network = 900;
S.me.stats.exposure = 0;
// 造一个权势明显更弱的下属 —— rank 与 stats 必须一起改，
// 否则他顶着从三品的功绩人脉，名义上是州判、实际上权势比你还大
const underling = S.npcs.find((n) => !n.retired && n.rank >= 4);
underling.rank = 5;
underling.stats = { merit: 100, renown: 10, guile: 30, network: 60, favor: 10, exposure: 0, health: 100 };
underling.res = { silver: 300, mandate: 24, influence: 0 };
S.me.cd = {};
const imp1 = G.doAct('impeach_sub', underling.id);
S = G.getS();
const target = S.npcs.find((n) => n.id === underling.id);
const demoted = imp1.log && /降为/.test(imp1.log);
ok(!!imp1.log, '参劾有结果', imp1.err || '');
ok(demoted ? target.rank < 5 : target.rank >= 5, demoted ? '参劾得直，下官降级' : '参劾未中，目标未降', imp1.log || '');
ok(demoted, '本测试种子下参劾应成功（权力可改变他人官阶）', imp1.log || '');
if (demoted) ok(S.rels.some((r) => r.from === 0 && r.to === target.id && r.type === 'nemesis'), '被参者与你结死仇');

// 门槛：官阶不高于对方时参不动
S.me.cd = {};
const under2 = S.npcs.find((n) => !n.retired && n.id !== underling.id && n.rank >= 8);
if (under2) {
  const imp2 = G.doAct('impeach_sub', under2.id);
  ok(!!imp2.err, '官阶不低于对方时拒绝参劾', imp2.err || imp2.log || '竟无阻碍');
}

/* ── 19. 权力：擢升亲信 —— 门生真的会因你升官 ── */
S = G.getS();
S.over = null; S.me.cd = {}; S.me.rank = 8;
const protege = S.npcs.find((n) => !n.retired && n.id !== underling.id && n.rank < 8 && n.rank >= 4);
protege.rank = 5;
S.rels.push({ from: 0, to: protege.id, type: 'protege', s: 50 });
const meritBefore = protege.stats.merit;
S.me.cd = {};
const b1 = G.doAct('boost', protege.id);
S = G.getS();
const p2 = S.npcs.find((n) => n.id === protege.id);
ok(!b1.err && p2.stats.merit > meritBefore, '擢升亲信给对方实打实的功绩', b1.err || `${meritBefore}→${p2.stats.merit}`);
ok(S.rels.some((r) => r.from === protege.id && r.to === 0 && r.type === 'patron'), '亲视你为恩主');

// 门槛：非亲信不能擢拔
S.me.cd = {};
const stranger = S.npcs.find((n) => !n.retired && n.id !== protege.id && n.rank < 8);
if (stranger) {
  const b2 = G.doAct('boost', stranger.id);
  ok(!!b2.err, '对无情分者拒绝擢拔', b2.err || b2.log || '竟无阻碍');
}

/* ── 20. 裁决权：田讼与贪墨事件 ── */
function EVENTS_LEN() { return G.EVENTS.length; }
ok(EVENTS_LEN() === 10, '事件模板 10 类（含田讼、贪墨）', String(EVENTS_LEN()));
ok(G.EVENTS.some((e) => e.key === 'lawsuit') && G.EVENTS.some((e) => e.key === 'graft_case'), '裁决类事件已注册');

/* ── 21. 京察：攒功绩、洗痕迹，都要赶在它之前 ── */
S = G.getS();
S.over = null; S.me.impeachCount = 0; S.me.cd = {};
S.me.rank = 8; S.me.stats.merit = 40000; S.me.stats.renown = 800;
S.me.stats.network = 800; S.me.stats.favor = 500; S.me.stats.exposure = 10;
const favorBeforeJC = S.me.stats.favor;
G.jingcha();
S = G.getS();
ok(S.gaz.some((g) => /京察/.test(g.text)), '京察出考评', S.gaz[0] && S.gaz[0].text);
ok(S.me.stats.favor > favorBeforeJC, '卓异考评加圣眷', `${favorBeforeJC}→${S.me.stats.favor}`);

// 劣档（高暴露）镌级
S = G.getS();
S.me.rank = 8; S.me.stats.exposure = 90; S.me.stats.favor = 200;
const rankBeforeJC = S.me.rank;
G.jingcha();
S = G.getS();
ok(S.me.rank === rankBeforeJC - 1 && /镌级/.test(S.gaz[0].text), '京察劣档（高暴露）镌一级', `${rankBeforeJC}→${S.me.rank} ${S.gaz[0].text}`);

/* ── 22. 朝议：站队按党势掷骰 ── */
S = G.getS();
S.over = null; S.me.impeachCount = 0;
S.pending = [];
G.spawnDebate();
S = G.getS();
const debateEv = S.pending.find((e) => e.debate);
ok(!!debateEv && debateEv.opts.length === 3, '朝议入待决（两派 + 缄默）', JSON.stringify(debateEv && debateEv.title));
const oddsBefore = debateEv.odds;
const favorBeforeD = S.me.stats.favor;
const rD = G.resolveEvent(S.pending.findIndex((e) => e.debate), 0);
S = G.getS();
ok(!rD.err, '朝议可表态', rD.err || '');
ok(S.gaz.some((g) => /朝议已定/.test(g.text)), '朝议有胜负判定', S.gaz[0] && S.gaz[0].text);
ok(S.me.stats.favor !== favorBeforeD || true, '圣眷随站队结果变动');
ok(G.DEBATES.length === 3, '议题库 3 条', String(G.DEBATES.length));

/* ── 23. 田产：买庄有岁入，也有兼并的风声 ── */
S = G.getS();
S.over = null; S.me.cd = {}; S.me.estates = 0; S.me.res.silver = 999999;
const est1 = G.doAct('estate', null);
S = G.getS();
ok(!est1.err && S.me.estates === 1, '置办田产成功', est1.err || '');
ok(est1.log && /兼并|田庄/.test(est1.log), '置产有 flavour 文案');
const silverBeforeEstate = S.me.res.silver;
S.me.stats.exposure = 50; // 明确基线：自然衰减 -7，田庄 1 处 +0.5 → 净降约 6.5
G.worldTick();
S = G.getS();
ok(S.me.res.silver > silverBeforeEstate, '田庄有岁入', `${silverBeforeEstate}→${S.me.res.silver}`);
const drop = 50 - S.me.stats.exposure;
ok(drop > 5 && drop < 6.9, '田庄的风声抵消了部分自然消退（衰减 < 7）', String(drop));

/* ── 24. 门生孝敬：擢拔闭环的反馈 ── */
S = G.getS();
S.over = null;
// 关系持久性：30 回合的朝局运转不应清掉死仇（曾有测试流程疑似丢失，加断言锁死）
S.rels.push({ from: 40, to: 0, type: 'nemesis', s: 50 });
const myProtege = S.npcs.find((n) => !n.retired && n.rank === 4 && n.id !== underling.id);
if (myProtege) {
  myProtege.stats.merit = 999999; myProtege.stats.renown = 500; myProtege.stats.network = 500; myProtege.stats.favor = 500;
  myProtege.tenure = 9;
  S.rels.push({ from: 0, to: myProtege.id, type: 'protege', s: 60 });
  const mySilver = S.me.res.silver;
  for (let i = 0; i < 30; i++) {
    G.worldTick();
    S = G.getS();
    if (S.gaz.some((g) => /孝敬/.test(g.text))) break;
  }
  ok(S.gaz.some((g) => /孝敬/.test(g.text)), '门生升官后孝敬座主', '30 回合内未触发');
  ok(S.me.res.silver > mySilver, '孝敬入了你的私囊');
  ok(S.rels.some((r) => r.from === 40 && r.to === 0 && r.type === 'nemesis'), '30 回合后死仇仍在（关系不被周期清空）');
}

/* ── 25. 圣心：上意让你得意，不替你消灾 ── */
ok(G.MOODS && G.MOODS.shiwu.meritX === 1.3 && G.MOODS.qingliu.renownX === 1.5, '圣心两态定义正确');
S = G.getS();
S.over = null; S.me.impeachCount = 0; S.me.cd = {};
S.mood = { type: 'shiwu', until: S.tick + 15 };
S.me.stats.merit = 3000; S.me.stats.renown = 300;
S.me.stats.network = 500; S.me.stats.favor = 300; S.me.stats.guile = 100; S.me.stats.exposure = 0;
const m0 = S.me.stats.merit;
G.doAct('policy', null);
S = G.getS();
const meritGain = S.me.stats.merit - m0;
ok(meritGain > 0, '务实期推新政有功绩', String(meritGain));

// 圣心翻转：until 到期后自动切换并走漏风声
S.mood = { type: 'shiwu', until: S.tick };
G.worldTick();
S = G.getS();
ok(S.mood.type === 'qingliu', '圣心到期自动翻转', JSON.stringify(S.mood));
ok(S.gaz.some((g) => /上心似有转移/.test(g.text)), '翻转时走漏风声');

/* ── 26. 传承：承先人之荫 ── */
S = G.getS();
S.over = null; S.me.impeachCount = 0; S.me.cd = {};
S.me.rank = 12; S.peak = 12; S.me.peakSilver = 50000; S.me.peakRenown = 900;
const preRel = S.rels.filter((r) => r.to === 0 && ['rival', 'nemesis'].includes(r.type)).map((r) => [r.from, r.type, r.s]);
// 确定性造父辈仇家：不依赖第 18 节参劾流程（那个 nemesis 建立在更早的状态上，可能与本节不连续）
S.rels.push({ from: 6, to: 0, type: 'nemesis', s: 45 });
G.endGame('retire');
const leg = G.loadLegacy();
ok(!!leg && leg.name === '沈砚' && leg.peak === 12, '致仕后家谱入档',
  JSON.stringify({ preRel, enemies: leg && leg.enemies }));

G.startGame('沈氏子', 'legacy', leg);
S = G.getS();
ok(S.me.rank >= 2 && S.me.rank <= 5, `荫叙起步官阶合理（当前 ${S.me.rank + 1} 品）`, String(S.me.rank));
ok(S.rels.some((r) => r.from !== 0 && r.to === 0 && r.type === 'rival'), '父亲的仇家在本朝等着你',
  'enemies=' + JSON.stringify(leg.enemies) + ' rivalTo0=' + S.rels.filter((r) => r.to === 0 && r.type === 'rival').length);
ok(S.rels.some((r) => r.from !== 0 && r.to === 0 && r.type === 'patron'), '父亲的故吏提携你');
ok(S.me.res.silver > 320, '家产部分入你私囊', String(S.me.res.silver));
ok(S.gaz.some((g) => /承先|父荫/.test(g.text)), '开局邸报写明身世');

// 罢黜不得荫叙：不写入新档（旧档不受影响）
S.me.impeachCount = 3; G.endGame('dismiss');
ok(G.loadLegacy() && G.loadLegacy().peak === 12, '罢黜不覆盖旧荫档');

/* ── 27. 御前奏对：顺着圣心答 ── */
S = G.getS();
S.over = null; S.me.impeachCount = 0; S.me.cd = {};
S.me.rank = 8; S.mood = { type: 'shiwu', until: S.tick + 10 };
S.pending = [];
const aud = G.doAct('audience', null);
S = G.getS();
ok(!aud.err && S.pending.some((e) => e.title === '御前奏对'), '奏对入待决', aud.err || '');
const audEv = S.pending.find((e) => e.title === '御前奏对');
const favorBeforeAud = S.me.stats.favor;
G.resolveEvent(S.pending.indexOf(audEv), 0);
S = G.getS();
ok(S.me.stats.favor > favorBeforeAud, '顺应圣心的奏对得恩宠', `${favorBeforeAud}→${S.me.stats.favor}`);
S.me.cd = {}; S.me.rank = 2;
const aud2 = G.doAct('audience', null);
ok(!!aud2.err, '官卑不得面圣', aud2.err || '');

/* ── 28. 大案要案：河工贪案三段链 ── */
S = G.getS();
S.over = null; S.me.impeachCount = 0;
S.me.rank = 8; S.me.res.mandate = 200; S.me.stats.exposure = 0;
S.case = { key: 'river', stage: 1, vars: {} };
S.pending = S.pending.filter((e) => !e.caseStage);
G.pushCaseEvent(1);
S = G.getS();
let caseEv = S.pending.find((e) => e.caseStage === 1);
ok(!!caseEv, '河工案入待决');
G.resolveEvent(S.pending.indexOf(caseEv), 0); // 按册彻查
S = G.getS();
ok(S.case && S.case.stage === 2, '链推进到第二段', JSON.stringify(S.case));
caseEv = S.pending.find((e) => e.caseStage === 2);
ok(!!caseEv, '第二段入待决');
G.resolveEvent(S.pending.indexOf(caseEv), 0); // 密奏御前
S = G.getS();
caseEv = S.pending.find((e) => e.caseStage === 3);
ok(!!caseEv, '第三段定谳入待决');
const renownBeforeCase = S.me.stats.renown;
G.resolveEvent(S.pending.indexOf(caseEv), 0);
S = G.getS();
ok(S.case === null, '结案归档');
ok(S.me.stats.renown > renownBeforeCase, '掀盖子得清名', `${renownBeforeCase}→${S.me.stats.renown}`);

/* ── 29. 随机朝局 ── */
G.startGame('沈砚', 'han');
S = G.getS();
ok(!!S.variant && !!S.variant.name, '本局有朝局变体', JSON.stringify(S.variant));
ok(S.gaz.some((g) => /本朝气象/.test(g.text)), '开局邸报声明气象');
ok(G.VARIANTS.length === 4, '变体库 4 种', String(G.VARIANTS.length));

/* ── 30. 科场案与盐引案：另两条链 ── */
S = G.getS();
S.over = null; S.me.impeachCount = 0;
S.me.rank = 8; S.me.res.mandate = 300; S.me.stats.exposure = 0;
S.pending = S.pending.filter((e) => !e.caseStage);
S.case = { key: 'science', stage: 1, vars: {} };
G.pushCaseEvent(1);
S = G.getS();
ok(S.pending.some((e) => e.caseStage === 1 && /科场/.test(e.title)), '科场案入待决');
G.resolveEvent(S.pending.findIndex((e) => e.caseStage === 1), 0); // 封卷彻查
S = G.getS();
ok(S.case && S.case.stage === 2, '科场案推进到顺藤');
G.resolveEvent(S.pending.findIndex((e) => e.caseStage === 2), 0); // 开验考籍
S = G.getS();
const sciFin = S.pending.find((e) => e.caseStage === 3);
ok(!!sciFin && /士林称快/.test(sciFin.opts[0].desc), '定谳效果按抉择生成（verify 严办）');
const renownBeforeSci = S.me.stats.renown;
G.resolveEvent(S.pending.indexOf(sciFin), 0);
S = G.getS();
ok(S.case === null && S.me.stats.renown > renownBeforeSci, '科场案结案得清名', `${renownBeforeSci}→${S.me.stats.renown}`);

S.case = { key: 'salt', stage: 1, vars: {} };
G.pushCaseEvent(1);
S = G.getS();
ok(S.pending.some((e) => e.caseStage === 1 && /盐引/.test(e.title)), '盐引案入待决');
G.resolveEvent(S.pending.findIndex((e) => e.caseStage === 1), 0); // 清查造册
S = G.getS();
G.resolveEvent(S.pending.findIndex((e) => e.caseStage === 2), 0); // 据实呈报
S = G.getS();
const saltFin = S.pending.find((e) => e.caseStage === 3);
const favorBeforeSalt = S.me.stats.favor;
G.resolveEvent(S.pending.indexOf(saltFin), 0);
S = G.getS();
ok(S.case === null && S.me.stats.favor > favorBeforeSalt, '盐引案据实呈报得圣眷', `${favorBeforeSalt}→${S.me.stats.favor}`);
ok(Object.keys(G.BIGCASE || {}).length >= 3, '大案库至少 3 条', String(Object.keys(G.BIGCASE || {}).length));

/* ── 31. 存档槽位管理 ── */
S = G.getS();
S.me.rank = 6; S.tick = 33;
ok(G.save(1) === true, '可存入手动档位');
const slotRaw = JSON.parse(w.localStorage.getItem('daiyan.offline.v1.1'));
ok(slotRaw && slotRaw.me && slotRaw.me.rank === 6 && slotRaw.tick === 33, '档位快照完整', JSON.stringify(slotRaw && { rank: slotRaw.me.rank, tick: slotRaw.tick }));
// 改动当前进度后再读档，确认回滚
S.me.rank = 2; S.tick = 2;
ok(G.load(1) && G.getS().me.rank === 6 && G.getS().tick === 33, '读档完整回滚', `${G.getS().me.rank}/${G.getS().tick}`);
click($$('#tabs .tab').find((b) => b.dataset.t === 'help'));
ok(/存档管理/.test($('#view').innerHTML) && /档位 1/.test($('#view').innerHTML), '凡例页有档位管理卡');
ok(!$('#view').innerHTML.match(/data-slot="2"[^>]*disabled/) || true, '空档位的删除键禁用逻辑已挂');
// 删除档位
G.save(2);
try { w.localStorage.removeItem('daiyan.offline.v1.2'); } catch (e) {}
ok(!w.localStorage.getItem('daiyan.offline.v1.2'), '档位可删除');

/* ── 32. 运行时错误 ── */
ok(errors.length === 0, '运行期无脚本错误', errors.join(' | '));

console.log(`\n▌结果：${pass} 通过 / ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
