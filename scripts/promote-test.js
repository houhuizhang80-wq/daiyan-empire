/**
 * 晋升 / 占缺 / 弹劾 / 派系 逻辑验证（使用独立数据库，不影响线上存档）
 *
 *   node scripts/promote-test.js
 *
 * 说明：为避免随机性导致断言抖动，本脚本固定 Math.random 返回值。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, '..', 'data', 'test-promote.db');
for (const f of [TMP, `${TMP}-wal`, `${TMP}-shm`]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
process.env.DB_PATH = TMP;

// 固定随机源：0.42 —— 铨选必成、事件不触发、派系分支可预测
Math.random = () => 0.42;

const { db, now } = await import('../server/db.js');
const engine = await import('../server/game/engine.js');
const { RANKS, CONST } = await import('../server/game/data.js');

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
const tryPromote = (id) => {
  try {
    return engine.attemptPromotion(id);
  } catch (e) {
    return { success: false, message: e.message, error: true };
  }
};

engine.initOfficeSlots();

const setStats = (id, patch) => {
  const row = engine.getPlayer(id);
  db.prepare('UPDATE players SET stats = ? WHERE id = ?').run(
    JSON.stringify({ ...JSON.parse(row.stats), ...patch }),
    id
  );
};
const setTenure = (id, n) => db.prepare('UPDATE players SET tenure = ? WHERE id = ?').run(n, id);
const grantSilver = (id, n) => {
  const row = engine.getPlayer(id);
  db.prepare('UPDATE players SET resources = ? WHERE id = ?').run(
    JSON.stringify({ ...JSON.parse(row.resources), silver: n }),
    id
  );
};

console.log('\n▌晋升 / 占缺 / 弹劾 / 派系 验证\n');

/* ── 1. 占缺表 ───────────────────────────────────────────── */
const expectedSlots = RANKS.filter((r) => r.slots !== null).reduce(
  (a, r) => a + engine.totalSlots(r.id),
  0
);
const slotRows = db.prepare('SELECT COUNT(*) AS c FROM office_slots').get().c;
ok(slotRows === expectedSlots, `占缺表共 ${slotRows} 缺（预期 ${expectedSlots}）`);
ok(engine.totalSlots(0) === null, '从九品书办不限员额');
ok(engine.totalSlots(4) === 3, `从七品县令限额 ${engine.totalSlots(4)} 缺`);
ok(engine.totalSlots(9) === 12, `正五品郎中共 ${engine.totalSlots(9)} 缺（六曹各二）`);
ok(engine.totalSlots(17) === 1, '正一品首辅仅一缺');

/* ── 2. 资历不足时不可晋升 ───────────────────────────────── */
const p1 = engine.createPlayer('t_promote_1', '考生甲', 'secret123');
ok(engine.promotionReadiness(p1).ready === false, '新晋者不可立即铨选');
const early = tryPromote(p1.id);
ok(early.success === false && /未满三回合/.test(early.message), '被拒原因指明资历不足');

/* ── 3. 满足功绩后晋升成功 ───────────────────────────────── */
setStats(p1.id, { merit: 400, renown: 200, network: 150, favor: 120 });
setTenure(p1.id, 5);
const r1 = tryPromote(p1.id);
ok(r1.success === true, '功绩充足时铨选成功', r1.message);
ok(r1.profile?.rankId === 1, `已迁至 ${r1.profile?.grade}${r1.profile?.title}`);

/* ── 4. 晋升消耗资历、重置任期 ───────────────────────────── */
ok(r1.profile.stats.merit < 400, `晋升消耗功绩（余 ${r1.profile.stats.merit}）`);
ok(r1.profile.tenure === 0, '任期重新起算');
ok(r1.profile.history.length >= 2, `履历已记录 ${r1.profile.history.length} 条`);
ok(
  engine.recentGazette(50, p1.id).some((g) => g.kind === 'promotion'),
  '迁转已见于邸报'
);
const again = tryPromote(p1.id);
ok(again.success === false, '晋升后不可立即再迁');

/* ── 5. 逐级攀升至竞争性官阶 ─────────────────────────────── */
let guard = 0;
while (engine.getPlayer(p1.id).rank_id < 4 && guard < 40) {
  setTenure(p1.id, 5);
  setStats(p1.id, { merit: 4000, renown: 2000, network: 1600, favor: 1200 });
  tryPromote(p1.id);
  guard += 1;
}
const p1Rank = engine.getPlayer(p1.id).rank_id;
ok(p1Rank >= 4, `已跻身竞争性官阶（第 ${p1Rank} 级 · ${engine.RANK_BY_ID.get(p1Rank).title}）`);
ok(
  !!db.prepare('SELECT * FROM office_slots WHERE holder_id = ?').get(p1.id),
  '已实际占缺'
);

/* ── 6. 员额占满后其余人被拒 ─────────────────────────────── */
const occupants = [];
for (let i = 0; i < 4; i += 1) {
  const p = engine.createPlayer(`t_promote_c${i}`, `候补${i}`, 'secret123');
  db.prepare('UPDATE players SET rank_id = 3, tenure = 5 WHERE id = ?').run(p.id);
  setStats(p.id, { merit: 6000, renown: 3000, network: 2000, favor: 1500 });
  occupants.push(p);
}
let succeeded = [];
let rejected = [];
for (const p of occupants) {
  const r = tryPromote(p.id);
  if (r.success) succeeded.push(p);
  else rejected.push(r);
}
const s4 = engine.slotStats(4);
ok(s4.filled === s4.total, `从七品员额占满（${s4.filled}/${s4.total}）`);
ok(rejected.length >= 1, `缺满后 ${rejected.length} 人被拒，体现竞争`);
ok(
  rejected.every((r) => /无缺可补/.test(r.message)),
  '被拒原因均为「无缺可补」'
);

/* ── 7. 久不视事者致仕腾缺 ───────────────────────────────── */
const idleOne = succeeded[0];
db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').run(now() - 5 * 86400_000, idleOne.id);
engine.runTick();
ok(engine.getPlayer(idleOne.id).retired === 1, '久不视事者奉旨休致');
const s4b = engine.slotStats(4);
ok(s4b.filled < s4b.total, `休致后空出缺额（${s4b.filled}/${s4b.total}）`);

/* ── 8. 回合结算 ─────────────────────────────────────────── */
const beforeSilver = JSON.parse(engine.getPlayer(p1.id).resources).silver;
const beforeTick = JSON.parse(engine.getPlayer(p1.id).resources).mandate;
db.prepare('UPDATE players SET resources = ? WHERE id = ?').run(
  JSON.stringify({ ...JSON.parse(engine.getPlayer(p1.id).resources), mandate: 0 }),
  p1.id
);
engine.runTick();
const afterRow = engine.getPlayer(p1.id);
ok(JSON.parse(afterRow.resources).silver > beforeSilver, '回合结算发放俸禄');
ok(
  JSON.parse(afterRow.resources).mandate === engine.RANK_BY_ID.get(afterRow.rank_id).mandate,
  `政令点已恢复至 ${JSON.parse(afterRow.resources).mandate}（此前 ${beforeTick}）`
);

/* ── 9. 派系 ─────────────────────────────────────────────── */
const leader = engine.getPlayer(p1.id);
setStats(leader.id, { network: 260 });
grantSilver(leader.id, 5000);
const f = engine.createFaction(leader.id, '清议党', 'qingliu');
ok(!!f && f.name === '清议党', '人脉充足时立党成功');
ok(f.doctrineMeta.name === '清流', `宗旨为 ${f.doctrineMeta.name}`);

const member = engine.getPlayer(occupants.find((o) => o.id !== idleOne.id).id);
engine.joinFaction(member.id, f.id);
const f2 = engine.getFaction(f.id);
ok(f2.members.length === 2, `党内现有 ${f2.members.length} 人`);
ok(f2.power > 0, `党势 ${f2.power}`);
const donated = engine.donateFaction(member.id, 300);
ok(donated.treasury >= 300, `党库 ${donated.treasury} 两`);

/* ── 10. 弹劾镌级 ────────────────────────────────────────── */
const target = engine.getPlayer(occupants[2].id);
setStats(target.id, { exposure: CONST.MAX_EXPOSURE, favor: 0 });
const beforeRank = engine.getPlayer(target.id).rank_id;
const imp = engine.impeach(engine.getPlayer(target.id));
ok(imp.survived === false, '圣眷全无时弹劾成立');
ok(
  engine.getPlayer(target.id).rank_id < beforeRank,
  `镌级：${beforeRank} → ${engine.getPlayer(target.id).rank_id}`
);
ok(engine.getPlayer(target.id).impeach_count === 1, '弹劾次数已记录');

/* ── 11. 朝局概览 ────────────────────────────────────────── */
const ov = engine.courtOverview();
ok(
  ov.vacancies.length === RANKS.filter((r) => r.slots !== null).length,
  `空缺概览覆盖 ${ov.vacancies.length} 个竞争性官阶`
);
ok(ov.players === 4, `在册官员 ${ov.players} 人（1 人已休致）`);

/* ══════════════════════════════════════════════════════════ *
 * 心腹与家族：关系不只是收藏品，是风险敞口
 * ══════════════════════════════════════════════════════════ */

const statsOf = (id) => JSON.parse(engine.getPlayer(id).stats);
const clearCd = (id) => db.prepare('UPDATE players SET cooldowns = ? WHERE id = ?').run('{}', id);
const buff = (id, patch) => engine.applyEffects(engine.getPlayer(id), patch);

const lord = engine.createPlayer('pt_lord', '东家', 'secret123');
const hand = engine.createPlayer('pt_hand', '心腹', 'secret123');
const foil = engine.createPlayer('pt_foil', '靶子', 'secret123');
const distant = engine.createPlayer('pt_distant', '疏远者', 'secret123');

/* ── 12. 心腹代行：暗线的痕迹由心腹分摊 ─────────────────── */
engine.applyRelation(lord.id, hand.id, 'confidant', 80);
buff(lord.id, { guile: 400, network: 200 });
clearCd(lord.id);
const scheme1 = engine.performAction(lord.id, 'scheme', foil.id);
const handTook = statsOf(hand.id).exposure;
ok(handTook > 0, `心腹替东家担下痕迹 ${handTook} 分`);
ok(
  scheme1.logs.some((l) => l.includes('替你担下')),
  '代行已在行动日志中交代',
  JSON.stringify(scheme1.logs)
);
ok(
  statsOf(lord.id).exposure > 0,
  `东家仍自留一部分（${statsOf(lord.id).exposure} 分）—— 心腹不是替罪羊`
);

// 交情不到，他不肯接
engine.applyRelation(lord.id, distant.id, 'confidant', 10);
clearCd(lord.id);
engine.performAction(lord.id, 'scheme', foil.id);
ok(statsOf(distant.id).exposure === 0, '交情不足者不肯替你担事');

// 硬托付则可能反口。单开一位东家，避免强心腹把分担额度吃光、轮不到疏远者
const lord2 = engine.createPlayer('pt_lord2', '二号东家', 'secret123');
buff(lord2.id, { guile: 400, network: 200 });
engine.applyRelation(lord2.id, distant.id, 'confidant', 10);
Math.random = () => 0.05; // 低于 CONFIDANT_BETRAY，必反口
clearCd(lord2.id);
const scheme2 = engine.performAction(lord2.id, 'scheme', foil.id);
Math.random = () => 0.42;
const turned = db
  .prepare("SELECT COUNT(*) AS c FROM relations WHERE from_id = ? AND to_id = ? AND type = 'nemesis'")
  .get(lord2.id, distant.id).c;
ok(turned === 1, '交情不足又硬托付，他反口告发');
ok(statsOf(distant.id).exposure > 0, '反口者自己也沾了手');
ok(
  scheme2.logs.some((l) => l.includes('反口')),
  '反口已在行动日志中交代'
);

/* ── 13. 姻亲与家族势力 ─────────────────────────────────── */
buff(lord.id, { network: 400 });
clearCd(lord.id);
engine.performAction(lord.id, 'marry', foil.id);
ok(engine.kinOf(lord.id).some((k) => k.id === foil.id), '两家已结姻亲');
ok(
  engine.kinOf(foil.id).some((k) => k.id === lord.id),
  '姻亲是相互的 —— 对方也认这门亲'
);
ok(engine.familyPowerOf(lord.id) > 0, `家族势力 ${engine.familyPowerOf(lord.id)}`);

/* ── 14. 连坐：一个人倒下，倒下的不只是他自己 ───────────── */
buff(foil.id, { favor: 300, renown: 200 });
setStats(lord.id, { exposure: CONST.MAX_EXPOSURE, favor: 0 });
const kinBefore = statsOf(foil.id);
const fall = engine.impeach(engine.getPlayer(lord.id));
ok(fall.survived === false, '圣眷全无时弹劾成立');
ok(fall.implicated?.kin >= 1, `姻亲受牵连 ${fall.implicated?.kin} 家`);
ok(
  statsOf(foil.id).favor < kinBefore.favor,
  `姻亲圣眷受损 ${kinBefore.favor} → ${statsOf(foil.id).favor}`
);
ok(statsOf(foil.id).renown < kinBefore.renown, '姻亲声望亦受损');

// 心腹倒台，托付他的东家受牵连
const lord3 = engine.createPlayer('pt_lord3', '三号东家', 'secret123');
buff(lord3.id, { favor: 300, network: 200 });
engine.applyRelation(lord3.id, hand.id, 'confidant', 70);
const ownerBefore = statsOf(lord3.id);
setStats(hand.id, { exposure: CONST.MAX_EXPOSURE, favor: 0 });
engine.impeach(engine.getPlayer(hand.id));
ok(
  statsOf(lord3.id).favor < ownerBefore.favor,
  `心腹倒台，东家圣眷受损 ${ownerBefore.favor} → ${statsOf(lord3.id).favor}`
);
ok(statsOf(lord3.id).network < ownerBefore.network, '东家人脉亦受损');

/* ── 15. 档案中可见 ─────────────────────────────────────── */
const prof = engine.selfProfile(engine.getPlayer(lord.id));
ok(typeof prof.familyPower === 'number', `档案含家族势力 ${prof.familyPower}`);
ok(prof.kinCount >= 1, `档案含姻亲计数 ${prof.kinCount}`);
ok(Array.isArray(prof.retinue), `档案含心腹名录 ${prof.retinue.length} 人`);
ok(
  prof.retinue.every((r) => typeof r.willing === 'boolean'),
  '心腹标注「是否肯替你担事」—— 规则摆上台面，玩家才知道该经营到什么程度'
);

console.log(`\n▌结果：${pass} 通过 / ${fail} 失败\n`);
db.close();
process.exit(fail ? 1 : 0);
