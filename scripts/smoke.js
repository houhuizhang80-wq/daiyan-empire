/**
 * 冒烟测试：验证注册 / 行动 / 事件 / 铨选 / 派系 / 持久化 全链路
 *
 *   node server/index.js &        # 先起服务
 *   node scripts/smoke.js
 */

const BASE = process.env.BASE || 'http://127.0.0.1:8787';

let pass = 0;
let fail = 0;

function ok(cond, label, extra = '') {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${label} ${extra}`);
  }
}

async function api(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

const suffix = Math.random().toString(36).slice(2, 7);

async function main() {
  console.log(`\n▌大衍帝国 · 冒烟测试  (${BASE})\n`);

  /* 1. 健康检查 */
  const health = await api('GET', '/healthz');
  ok(health.status === 200 && health.json.ok, '服务在线');

  /* 2. 注册两名玩家 */
  const a = await api('POST', '/api/auth/register', {
    username: `smoke_a_${suffix}`,
    displayName: `甲${suffix}`,
    password: 'secret123',
  });
  ok(a.status === 200 && !!a.json.token, '注册玩家甲', JSON.stringify(a.json));
  const tokenA = a.json.token;

  const b = await api('POST', '/api/auth/register', {
    username: `smoke_b_${suffix}`,
    displayName: `乙${suffix}`,
    password: 'secret123',
  });
  ok(b.status === 200 && !!b.json.token, '注册玩家乙');
  const tokenB = b.json.token;
  const idB = b.json.profile.id;

  /* 3. 重名拒绝 */
  const dup = await api('POST', '/api/auth/register', {
    username: `smoke_a_${suffix}`,
    displayName: '丙',
    password: 'secret123',
  });
  ok(dup.status === 409, '拒绝重名注册');

  /* 4. 登录 */
  const login = await api('POST', '/api/auth/login', {
    username: `smoke_a_${suffix}`,
    password: 'secret123',
  });
  ok(login.status === 200 && !!login.json.token, '登录成功');

  const badLogin = await api('POST', '/api/auth/login', {
    username: `smoke_a_${suffix}`,
    password: 'wrongpass',
  });
  ok(badLogin.status === 401, '拒绝错误口令');

  /* 5. 未授权访问 */
  const noAuth = await api('GET', '/api/me');
  ok(noAuth.status === 401, '未持令牌访问被拒');

  /* 6. 初始档案 */
  let me = (await api('GET', '/api/me', null, tokenA)).json.profile;
  ok(me.rankId === 0 && me.title === '书办', '初授从九品书办', me.title);
  ok(me.resources.silver >= 100, '初始银两已发放');
  ok(me.resources.mandate === me.mandateMax, '政令点已满');
  // 门第：姻亲与心腹都是「风险敞口」，档案里必须看得见
  ok(typeof me.familyPower === 'number', `档案含家族势力 ${me.familyPower}`);
  ok(Array.isArray(me.kin), `档案含姻亲名录 ${me.kin.length} 家`);
  ok(Array.isArray(me.retinue), `档案含心腹名录 ${me.retinue.length} 人`);

  /* 7. 行动清单 */
  const acts = await api('GET', '/api/actions');
  ok(acts.json.actions.length >= 15, `行动清单共 ${acts.json.actions.length} 条`);
  ok(
    acts.json.actions.some((x) => x.path === 'open') &&
      acts.json.actions.some((x) => x.path === 'shadow'),
    '明线 / 暗线双路径均存在'
  );

  /* 8. 执行明线行动 */
  const r1 = await api('POST', '/api/actions/policy', {}, tokenA);
  ok(r1.status === 200 && r1.json.logs.length > 0, '推行新政成功执行');
  const meritAfter = r1.json.profile.stats.merit;
  ok(typeof meritAfter === 'number', '政绩已写入');

  /* 9. 暗线行动需要权谋值 */
  const shadowFail = await api('POST', '/api/actions/scheme', { targetId: idB }, tokenA);
  ok(shadowFail.status === 400, '权谋不足时拒绝密谋');

  /* 10. 社交行动 */
  const gift = await api('POST', '/api/actions/gift', { targetId: idB }, tokenA);
  ok(gift.status === 200, '赠礼建立关系');
  const rels = gift.json.profile.relations;
  ok(rels.some((r) => r.id === idB), '关系网络已记录对方');

  /* 11. 举荐门生 */
  const rec = await api('POST', '/api/actions/recommend', { targetId: idB }, tokenA);
  ok(rec.status === 200, '举荐门生成功', JSON.stringify(rec.json));
  ok(
    (rec.json.profile?.relations || []).some((r) => r.id === idB && r.type === 'protege'),
    '门生关系已建立'
  );

  /* 12. 同一行动当回合不可重复（冷却） */
  const again = await api('POST', '/api/actions/policy', {}, tokenA);
  ok(again.status === 429, `同一行动当回合不可重复（HTTP ${again.status}）`);

  /* 13. 政令见底后拒绝执行 */
  // 行动都有冷却，靠反复点同一件事耗不光政令 —— 早先这里循环十次 allocate，
  // 第二次起全是 429（冷却），永远等不到 400，断言形同虚设。
  // 正确做法是把「互不相同」的政令行动依次做一遍。
  // 明线政令总额（15）大于从九品的政令上限（10），故必定撞上「资力不足」。
  const openKeys = acts.json.actions
    .filter((a) => a.path === 'open' && a.target === 'none' && (a.cost?.mandate ?? 0) > 0)
    .map((a) => a.key);
  const trail = [];
  let starved = null;
  for (const key of openKeys) {
    const r = await api('POST', `/api/actions/${key}`, {}, tokenA);
    trail.push(`${key}=${r.status}`);
    if (r.status === 400 && /资力不足/.test(r.json?.error || '')) {
      starved = r.json.error;
      break;
    }
  }
  ok(starved !== null, `政令见底后拒绝执行（${starved ?? trail.join(' ')}）`);

  /* 13. 铨选未达标时拒绝 */
  const early = await api('POST', '/api/promote', {}, tokenA);
  ok(early.status === 400, '资历不足时铨选被拒', early.json.error);

  /* 14. 事件系统 */
  const evs = await api('GET', '/api/events', null, tokenA);
  ok(evs.status === 200 && Array.isArray(evs.json.events), '事件接口可用');

  /* 15. 朝堂与榜单 */
  const court = await api('GET', '/api/court');
  ok(court.json.players >= 2, `朝堂在册 ${court.json.players} 人`);
  ok(Array.isArray(court.json.vacancies) && court.json.vacancies.length > 0, '空缺列表可用');

  const lb = await api('GET', '/api/leaderboard');
  ok(lb.json.list.length >= 2, `排行榜 ${lb.json.list.length} 人`);

  /* 16. 官阶全表 */
  const ranks = await api('GET', '/api/ranks');
  ok(ranks.json.ranks.length === 18, `官阶共 ${ranks.json.ranks.length} 级`);
  ok(
    ranks.json.ranks.some((r) => r.slotsTotal !== null),
    '存在有限员额的竞争性官阶'
  );

  /* 17. 派系 */
  const factionTry = await api('POST', '/api/factions', { name: `试党${suffix}`, doctrine: 'shiwu' }, tokenA);
  ok(factionTry.status === 400, '人脉不足时拒绝立党', factionTry.json.error);

  const factions = await api('GET', '/api/factions');
  ok(Array.isArray(factions.json.list), '派系列表可用');
  ok(factions.json.doctrines.length === 4, '四种派系宗旨');

  /* 18. 私函 */
  const dm = await api('POST', '/api/dm', { toId: idB, text: '别来无恙？' }, tokenA);
  ok(dm.status === 200, '私函已递');
  const dmList = await api('GET', `/api/dm/${idB}`, null, tokenA);
  ok(dmList.json.list.length >= 1, '私函可回看');

  /* 19. 邸报 */
  const gz = await api('GET', '/api/gazette', null, tokenA);
  ok(gz.json.list.length > 0, `邸报 ${gz.json.list.length} 条`);

  /* 20. 持久化：重新登录后数据仍在 */
  const relogin = await api('POST', '/api/auth/login', {
    username: `smoke_a_${suffix}`,
    password: 'secret123',
  });
  const me2 = (await api('GET', '/api/me', null, relogin.json.token)).json.profile;
  ok(me2.stats.merit === r1.json.profile.stats.merit || me2.stats.merit > 0, '重新登录后政绩仍在');
  ok(me2.relations.length >= 1, '重新登录后人脉仍在');
  ok(me2.history.length >= 1, '履历已留存');

  /* 21. 玩家检索 */
  const search = await api('GET', `/api/players?q=${encodeURIComponent(`乙${suffix}`)}`, null, tokenA);
  ok(search.json.list.length >= 1, '可按表字检索玩家');

  /* 22. 越权访问他人私有数据 */
  const other = await api('GET', `/api/players/${idB}`, null, tokenA);
  ok(other.json.player && other.json.player.stats === undefined, '他人档案不泄露隐秘属性');

  console.log(`\n▌结果：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('冒烟测试异常：', e);
  process.exit(2);
});
