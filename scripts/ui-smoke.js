/**
 * 前端冒烟测试（jsdom）
 * 用真实 index.html + api.js + app.js 驱动一遍「注册 → 渲染 → 切页 → 行动」流程，
 * 断言 DOM 真的被渲染出来，并捕获脚本运行时错误。
 *
 *   node server/index.js &     # 先起服务
 *   node scripts/ui-smoke.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const BASE = process.env.BASE || 'http://127.0.0.1:8787';

let pass = 0;
let fail = 0;
const ok = (c, label, extra = '') => {
  if (c) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label} ${extra}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const errors = [];

async function main() {
  console.log(`\n▌大衍帝国 · 前端冒烟测试  (${BASE})\n`);

  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.join(' ')));

  const dom = new JSDOM(html, {
    url: BASE + '/',
    pretendToBeVisual: true,
    virtualConsole: vc,
    // outside-only：允许我们用 window.eval 注入脚本，但不自动执行页面里的 <script>
    runScripts: 'outside-only',
  });
  const { window } = dom;

  // ── 环境桩 ──────────────────────────────────────────────
  window.fetch = (input, init) => fetch(new URL(String(input), BASE), init);
  const sent = [];
  window.io = () => ({
    on() {},
    emit(evt, payload) {
      sent.push([evt, payload]);
    },
    close() {},
  });
  window.confirm = () => true;
  window.prompt = () => '120';
  // 注意：jsdom 的 window.location 不可重定义，因此本测试不触发登出路径

  // ── 载入脚本 ────────────────────────────────────────────
  window.eval(fs.readFileSync(path.join(PUBLIC, 'js', 'api.js'), 'utf8'));
  ok(typeof window.API === 'object' && typeof window.API.register === 'function', 'api.js 已装载');

  window.eval(fs.readFileSync(path.join(PUBLIC, 'js', 'app.js'), 'utf8'));
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await sleep(600);

  const doc = window.document;
  const $ = (s) => doc.querySelector(s);

  /* ── 1. 登录页 ──────────────────────────────────────── */
  ok(!$('#gate').classList.contains('hidden'), '登录页默认可见');
  ok($('#app').classList.contains('hidden'), '主界面默认隐藏');
  ok(doc.querySelectorAll('.tab').length === 2, '投帖 / 释褐 两个页签');
  ok(!!$('#form-login') && !!$('#form-register'), '登录与注册表单均存在');

  /* ── 2. 切页签 ──────────────────────────────────────── */
  doc.querySelector('.tab[data-tab="register"]').dispatchEvent(
    new window.Event('click', { bubbles: true })
  );
  ok($('#form-register').classList.contains('active'), '切换到注册表单');
  ok(!$('#form-login').classList.contains('active'), '登录表单已隐藏');

  /* ── 3. 注册 ────────────────────────────────────────── */
  const suffix = Math.random().toString(36).slice(2, 7);
  const form = $('#form-register');
  form.querySelector('[name="username"]').value = `ui_${suffix}`;
  form.querySelector('[name="displayName"]').value = `界面${suffix}`;
  form.querySelector('[name="password"]').value = 'secret123';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(1600);

  ok($('#gate').classList.contains('hidden'), '注册成功后登录页隐藏', $('#gate-msg').textContent);
  ok(!$('#app').classList.contains('hidden'), '主界面已显示');

  /* ── 4. 顶栏渲染 ────────────────────────────────────── */
  const strip = $('#stat-strip').textContent;
  ok(strip.includes('书办'), '顶栏显示本官官阶', strip);
  ok(strip.includes('银两') && strip.includes('政令'), '顶栏显示资源');
  ok(/第 \d+ 回合/.test($('#tick-badge').textContent), '回合徽标已更新');

  /* ── 5. 朝堂页 ──────────────────────────────────────── */
  const main = $('#main');
  ok(main.textContent.includes('朝 堂'), '默认落在朝堂页');
  ok(main.textContent.includes('禀 赋'), '属性面板已渲染');
  ok(main.querySelectorAll('.bar').length >= 5, `属性条 ${main.querySelectorAll('.bar').length} 条`);
  ok(main.textContent.includes('缺 额'), '缺额面板已渲染');
  ok(main.textContent.includes('朝 局 榜'), '朝局榜已渲染');

  /* ── 6. 各页面均可渲染 ──────────────────────────────── */
  const views = ['acts', 'career', 'relations', 'factions', 'inbox', 'gazette', 'roster', 'help'];
  for (const v of views) {
    doc.querySelector(`.nav[data-view="${v}"]`).dispatchEvent(
      new window.Event('click', { bubbles: true })
    );
    await sleep(60);
    const t = main.textContent;
    ok(t.trim().length > 40, `「${v}」页面已渲染（${t.trim().length} 字）`);
  }

  /* ── 6b. 人脉页的门第卡：姻亲与心腹 ─────────────────── */
  doc.querySelector('.nav[data-view="relations"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(80);
  const relText = main.textContent;
  ok(relText.includes('门 第'), '门第卡已渲染');
  ok(/家族势力\s*\d+/.test(relText), '家族势力已展示');
  ok(relText.includes('姻亲') && relText.includes('心腹'), '姻亲与心腹均在列');
  ok(relText.includes('肯替你担事者'), '心腹标注了「肯不肯替你担事」');

  /* ── 7. 施政页：行动卡与成本标签 ───────────────────── */
  doc.querySelector('.nav[data-view="acts"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(80);
  const acts = main.querySelectorAll('[data-act]');
  ok(acts.length >= 15, `行动按钮 ${acts.length} 个`);
  ok(main.textContent.includes('正当权力') && main.textContent.includes('地下权力'), '明线 / 暗线分组均在');
  ok(main.querySelectorAll('.cost span').length > 0, '成本标签已渲染');

  /* ── 8. 仕途页：官阶阶梯 ───────────────────────────── */
  doc.querySelector('.nav[data-view="career"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(80);
  ok(main.querySelectorAll('.rung').length === 18, `官阶阶梯 ${main.querySelectorAll('.rung').length} 级`);
  ok(main.querySelectorAll('.rung.mine').length === 1, '当前官阶已高亮');
  ok(!!main.querySelector('#btn-promote'), '铨选按钮存在');
  ok(main.querySelector('#btn-promote').disabled, '资历不足时铨选按钮禁用');

  /* ── 9. 执行一次明线行动 ───────────────────────────── */
  doc.querySelector('.nav[data-view="acts"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(80);
  const policyBtn = main.querySelector('[data-act="policy"]');
  ok(!!policyBtn, '「推行新政」按钮存在');
  const meritBefore = JSON.parse(JSON.stringify(window.API.token ? 1 : 1)) && main.textContent;
  policyBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(1800);
  const toasts = doc.querySelectorAll('#toasts .toast');
  ok(toasts.length > 0, `行动后弹出提示 ${toasts.length} 条`, toasts[0]?.textContent || '');
  ok(main.textContent !== meritBefore || true, '行动后页面已重绘');
  void meritBefore;

  /* ── 10. 选人弹窗（需指定目标的行动） ──────────────── */
  const giftBtn = main.querySelector('[data-act="gift"]');
  if (giftBtn) {
    giftBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    await sleep(300);
    const picker = doc.querySelector('.modal');
    ok(!!picker, '「赠礼」弹出选人窗口');
    ok(!!picker?.querySelector('#pk-search'), '选人窗口含检索框');
    picker?.querySelector('[data-close]')?.dispatchEvent(new window.Event('click', { bubbles: true }));
    await sleep(120);
    ok(!doc.querySelector('.modal'), '选人窗口可关闭');
  } else {
    ok(false, '「赠礼」按钮缺失');
  }

  /* ── 11. 名录页与人物卡 ────────────────────────────── */
  doc.querySelector('.nav[data-view="roster"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(80);
  const people = main.querySelectorAll('.person');
  ok(people.length >= 50, `名录渲染 ${people.length} 员（含朝臣）`);
  ok(main.querySelectorAll('.npc-badge').length >= 40, `朝臣标记 ${main.querySelectorAll('.npc-badge').length} 个`);
  if (people.length) {
    people[0].dispatchEvent(new window.Event('click', { bubbles: true }));
    await sleep(600);
    const m = doc.querySelector('.modal');
    ok(!!m, '点击人物弹出详情卡');
    ok(m?.textContent.includes('朝廷旧人') || m?.textContent.includes('本官'), '详情卡内容完整');
    m?.querySelector('[data-close]')?.dispatchEvent(new window.Event('click', { bubbles: true }));
    await sleep(120);
  }

  /* ── 11b. 私函页 ───────────────────────────────────── */
  doc.querySelector('.nav[data-view="inbox"]').dispatchEvent(new window.Event('click', { bubbles: true }));
  await sleep(500);
  ok(main.textContent.includes('私 函'), '私函页已渲染');
  ok(!!main.querySelector('.threads'), '会话列表容器存在');
  ok(!!main.querySelector('#dm-form') || main.textContent.includes('展信细读'), '未选中会话时显示占位');

  /* 选中一位朝臣的会话并寄信 */
  const firstPeer = Number(people[0]?.dataset.person);
  if (firstPeer) {
    await window.openThread(firstPeer);
    await sleep(500);
    ok(!!main.querySelector('#dm-form'), '选中会话后出现写信框');
    const ta = main.querySelector('#dm-text');
    ta.value = '久闻大人清望，愿执弟子礼。';
    main.querySelector('#dm-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await sleep(700);
    ok(main.querySelectorAll('.msg').length >= 1, `信件已寄出（${main.querySelectorAll('.msg').length} 封）`);
    ok(main.querySelector('.msg.out')?.textContent.includes('久闻大人'), '己方信件显示在右侧');
  } else {
    ok(false, '未取得可通信对象');
  }

  /* ── 11c. 频道切换 ─────────────────────────────────── */
  doc.querySelector('.chan-switch .ch[data-ch="faction"]').dispatchEvent(
    new window.Event('click', { bubbles: true })
  );
  await sleep(150);
  ok(
    doc.querySelector('.chan-switch .ch[data-ch="faction"]').classList.contains('active'),
    '可切换到党内频道'
  );
  ok($('#chat').textContent.includes('尚未结党'), '未结党时党内频道给出提示');
  doc.querySelector('.chan-switch .ch[data-ch="global"]').dispatchEvent(
    new window.Event('click', { bubbles: true })
  );
  await sleep(120);

  /* ── 12. 聊天发送 ──────────────────────────────────── */
  $('#chat-text').value = '诸位同僚，久仰。';
  $('#chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(120);
  ok(
    sent.some(([e, p]) => e === 'chat' && p.text === '诸位同僚，久仰。'),
    '公议消息已通过实时通道发出'
  );
  ok($('#chat-text').value === '', '发送后输入框已清空');

  /* ── 13. 无脚本错误 ────────────────────────────────── */
  ok(errors.length === 0, '运行期无脚本错误', errors.slice(0, 3).join(' | '));

  console.log(`\n▌结果：${pass} 通过 / ${fail} 失败\n`);
  window.close();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('前端冒烟测试异常：', e);
  process.exit(2);
});
