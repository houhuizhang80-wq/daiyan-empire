/**
 * 朝臣（NPC）系统验证（独立数据库）
 *
 *   node scripts/npc-test.js
 *
 * 固定 Math.random = 0.3：使丑闻/休致不触发、铨选必定尝试且成功，行为完全可预测。
 * 朝臣姓名使用 npc.js 内部独立的随机源，不受此处影响。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(__dirname, '..', 'data', 'test-npc.db');
for (const f of [TMP, `${TMP}-wal`, `${TMP}-shm`]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
process.env.DB_PATH = TMP;
// 朝臣有自己的随机源（npc.js 的 prand），默认按当前时间播种。
// 钉死它，测试才完全可复现 —— 否则「出手的是哪名朝臣」每次不同，断言会偶发飘红。
process.env.NPC_SEED = '20260915';

/**
 * 可控随机源：改 RNG 即可切换场景。
 * 0.3 为常态（暴露度远在警戒线下，弹劾概率为 0，故不会误触）。
 * 弹劾场景的取值不写死 —— 软阈值下同一随机数需同时满足「触发」与「不过关」两个条件，
 * 由第 10 节按 IMPEACH_WARN / IMPEACH_RATE 现算，避免调参后测试静默失效。
 */
let RNG = 0.3;
Math.random = () => RNG;

const { db, now } = await import('../server/db.js');
const engine = await import('../server/game/engine.js');
const npc = await import('../server/game/npc.js');
const { RANKS, RANK_BY_ID, CONST } = await import('../server/game/data.js');

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

const setStats = (id, patch) => {
  const row = engine.getPlayer(id);
  db.prepare('UPDATE players SET stats = ? WHERE id = ?').run(
    JSON.stringify({ ...JSON.parse(row.stats), ...patch }),
    id
  );
};
const setTenure = (id, n) => db.prepare('UPDATE players SET tenure = ? WHERE id = ?').run(n, id);

engine.initOfficeSlots();

console.log('\n▌朝臣系统验证\n');

/* ── 1. 开朝建制 ─────────────────────────────────────────── */
const seed = npc.seedCourt();
ok(seed.created >= 50, `铺设朝臣 ${seed.created} 员`);
ok(seed.factions === 4, `开设党派 ${seed.factions} 个`);

const npcCount = db.prepare('SELECT COUNT(*) AS c FROM players WHERE is_npc = 1').get().c;
ok(npcCount === seed.created, '朝臣均已入库');

const names = db.prepare('SELECT display_name FROM players WHERE is_npc = 1').all().map((r) => r.display_name);
ok(new Set(names).size === names.length, `姓名无重复（${names.length} 员）`);
const givenNames = new Set(names.map((n) => n.slice(1)));
ok(givenNames.size >= 10, `名讳分布正常（${givenNames.size} 种，非全部同名）`);

/* ── 2. 幂等 ─────────────────────────────────────────────── */
const again = npc.seedCourt();
ok(again.skipped === true && again.created === 0, '重复调用不重复铺设');
ok(
  db.prepare('SELECT COUNT(*) AS c FROM players WHERE is_npc = 1').get().c === npcCount,
  '朝臣总数未变'
);

/* ── 3. 占缺 ─────────────────────────────────────────────── */
const contested = RANKS.filter((r) => r.slots !== null);
let filledTotal = 0;
let capacityTotal = 0;
for (const r of contested) {
  const s = engine.slotStats(r.id);
  filledTotal += s.filled;
  capacityTotal += s.total;
}
ok(filledTotal > 20, `竞争性缺额已占 ${filledTotal} / ${capacityTotal}`);
ok(filledTotal < capacityTotal, `仍留有 ${capacityTotal - filledTotal} 缺给玩家`);

const slotHolders = db
  .prepare('SELECT COUNT(*) AS c FROM office_slots WHERE holder_id IS NOT NULL')
  .get().c;
ok(slotHolders === filledTotal, '占缺记录与统计一致');

const freeTop = engine.slotStats(15);
ok(freeTop.filled < freeTop.total, `内阁群辅尚有 ${freeTop.total - freeTop.filled} 缺未授`);

/* ── 4. 朝臣不可登录 ─────────────────────────────────────── */
const someNpc = engine.getPlayer(
  db.prepare('SELECT id FROM players WHERE is_npc = 1 LIMIT 1').get().id
);
ok(engine.verifyPassword(someNpc, 'secret123') === false, '朝臣无法以任意口令登录');
ok(engine.verifyPassword(someNpc, '') === false, '空口令亦被拒');

/* ── 5. 党派与关系网 ─────────────────────────────────────── */
const factions = engine.listFactions();
ok(factions.length === 4, `党派 ${factions.length} 个`);
ok(factions.every((f) => f.members.length >= 5), '各党均有成员');
ok(factions.every((f) => f.leader_id !== null), '各党均有党魁');
ok(factions.every((f) => f.power > 0), '各党党势已计算');

const patronEdges = db.prepare("SELECT COUNT(*) AS c FROM relations WHERE type = 'patron'").get().c;
const protegeEdges = db.prepare("SELECT COUNT(*) AS c FROM relations WHERE type = 'protege'").get().c;
const rivalEdges = db.prepare("SELECT COUNT(*) AS c FROM relations WHERE type = 'rival'").get().c;
ok(patronEdges > 0 && protegeEdges > 0, `恩主/门生关系 ${patronEdges}/${protegeEdges} 条`);
ok(rivalEdges > 0, `政敌关系 ${rivalEdges} 条（党魁互为政敌）`);

/* ── 6. 每回合自然积累 ───────────────────────────────────── */
const target = engine.getPlayer(
  db.prepare('SELECT id FROM players WHERE is_npc = 1 AND rank_id = 9 LIMIT 1').get().id
);
const beforeStats = JSON.parse(target.stats);
const beforeTenure = target.tenure;
engine.runTick();
const afterRow = engine.getPlayer(target.id);
const afterStats = JSON.parse(afterRow.stats);
ok(afterStats.merit > beforeStats.merit, `政绩自然增长 ${beforeStats.merit} → ${afterStats.merit}`);
ok(afterRow.tenure === beforeTenure + 1, '在任回合 +1');

/* ── 7. 朝臣不受「久不视事休致」影响 ─────────────────────── */
const stale = db
  .prepare('SELECT COUNT(*) AS c FROM players WHERE is_npc = 1 AND retired = 0 AND rank_id >= 4')
  .get().c;
ok(stale > 0, `高位朝臣 ${stale} 员在列`);
const stillThere = db
  .prepare(
    `SELECT COUNT(*) AS c FROM players WHERE is_npc = 1 AND retired = 0 AND rank_id >= 4
     AND last_seen < ?`
  )
  .get(now() - 1000 * 60 * 60 * 24 * 3).c;
ok(stillThere === stale, '离线逾三日的朝臣未被误判休致（已排除在 idle 扫描之外）');

/* ── 8. 朝臣铨选迁转 ─────────────────────────────────────── */
const climber = engine.getPlayer(
  db.prepare('SELECT id FROM players WHERE is_npc = 1 AND rank_id = 5 LIMIT 1').get().id
);
const nextCap = RANK_BY_ID.get(climber.rank_id + 1).cap;
setStats(climber.id, {
  merit: nextCap * 3,
  renown: nextCap * 2,
  network: nextCap * 2,
  favor: nextCap * 1.5,
  exposure: 0,
});
setTenure(climber.id, 10);
const rankBefore = engine.getPlayer(climber.id).rank_id;
engine.runTick();
const rankAfter = engine.getPlayer(climber.id).rank_id;
ok(rankAfter > rankBefore, `朝臣自行迁转：第 ${rankBefore} 级 → 第 ${rankAfter} 级`);
ok(
  engine.recentGazette(80, null).some((g) => g.kind === 'promotion' && g.text.includes('制曰')),
  '迁转已载入邸报'
);

/* ── 9. 朝臣休致腾缺 ─────────────────────────────────────── */
const oldTimer = engine.getPlayer(
  db.prepare('SELECT id FROM players WHERE is_npc = 1 AND rank_id >= 4 AND retired = 0 LIMIT 1').get().id
);
const heldRank = oldTimer.rank_id;
const filledBefore = engine.slotStats(heldRank).filled;
setTenure(oldTimer.id, 999);
engine.runTick();
ok(engine.getPlayer(oldTimer.id).retired === 1, '年资满者休致');
ok(
  engine.slotStats(heldRank).filled < filledBefore,
  `休致后空出缺额（第 ${heldRank} 级 ${filledBefore} → ${engine.slotStats(heldRank).filled}）`
);

/* ── 10. 朝臣丑闻落马 ────────────────────────────────────── */
const corrupt = engine.getPlayer(
  db.prepare('SELECT id FROM players WHERE is_npc = 1 AND rank_id >= 9 AND retired = 0 LIMIT 1').get().id
);
const corruptRank = corrupt.rank_id;
setStats(corrupt.id, { exposure: CONST.MAX_EXPOSURE, favor: 0 });

// 弹劾已由「硬阈值」改为「软阈值」：越过 IMPEACH_WARN 后风险线性上升。
// 于是同一个随机数要同时满足两件事，才能既触发弹劾、又必然落马：
//   ① 触发弹劾：rnd < impeachRisk(满暴露) = IMPEACH_RATE
//   ② 不能过关：rnd >= 0.18（圣眷为 0 时，存活率公式的下限）
// 取窗口中点，既不必写死魔数，也不会因日后调参而静默失效。
const riskAtMax = engine.impeachRisk(CONST.MAX_EXPOSURE);
const surviveFloor = 0.18;
ok(
  riskAtMax > surviveFloor,
  `弹劾窗口非空（满暴露触发率 ${riskAtMax.toFixed(3)} > 圣眷尽失存活下限 ${surviveFloor}）`
);
RNG = (surviveFloor + riskAtMax) / 2;
engine.runTick();
RNG = 0.3;
const corruptAfter = engine.getPlayer(corrupt.id);
ok(corruptAfter.rank_id < corruptRank, `丑闻败露镌级：${corruptRank} → ${corruptAfter.rank_id}`);
ok(corruptAfter.impeach_count === 1, '弹劾次数已记录');
ok(
  db.prepare('SELECT COUNT(*) AS c FROM office_slots WHERE holder_id = ?').get(corrupt.id).c === 0,
  '落马者已释放所占缺额'
);

/* ── 11. 玩家 vs 朝臣：反制 ──────────────────────────────── */
const human = engine.createPlayer('npc_t_human', '新进者', 'secret123');
const bigNpc = engine.getPlayer(
  db.prepare('SELECT id FROM players WHERE is_npc = 1 AND rank_id >= 14 AND retired = 0 LIMIT 1').get().id
);
// 新玩家的政绩/圣眷都是 0，被削减也看不出变化；先给点家底
setStats(human.id, { merit: 200, renown: 80, favor: 60, network: 40 });
const beforeHuman = JSON.parse(engine.getPlayer(human.id).stats);

const line = npc.npcRetaliate(bigNpc, engine.getPlayer(human.id));
ok(typeof line === 'string' && line.includes('反制'), '高位朝臣反制成功', String(line));

const afterHuman = JSON.parse(engine.getPlayer(human.id).stats);
ok(afterHuman.exposure > beforeHuman.exposure, `反制推高玩家暴露度 ${beforeHuman.exposure} → ${afterHuman.exposure}`);
ok(afterHuman.favor < beforeHuman.favor || afterHuman.merit < beforeHuman.merit, '反制削损玩家政绩或圣眷');

const nemesis = db
  .prepare("SELECT COUNT(*) AS c FROM relations WHERE type IN ('rival','nemesis') AND to_id = ?")
  .get(human.id).c;
ok(nemesis > 0, '反制后结下仇怨');

/* ── 12. 玩家对朝臣动手会触发反制 ────────────────────────── */
const p2 = engine.createPlayer('npc_t_human2', '挑衅者', 'secret123');
setStats(p2.id, { guile: 400, network: 200 });
const res = engine.performAction(p2.id, 'scheme', bigNpc.id);
ok(res.logs.length > 0, '密谋构陷朝臣已执行');
ok(res.retaliation === true, '朝臣随即反制');
ok(res.logs.some((l) => l.includes('反制')), '反制文案已回传前端');

/* ── 13. 玩家档案不含朝臣标记 ────────────────────────────── */
const me = engine.selfProfile(engine.getPlayer(human.id));
ok(me.rankId === 0, '新玩家仍从从九品书办起步');
const asSeenByOther = engine.publicProfile(engine.getPlayer(bigNpc.id), human.id);
ok(asSeenByOther.npc === true, '他人档案带朝臣标记');
ok(asSeenByOther.online === false, '朝臣不显示为在线');
const humanSeen = engine.publicProfile(engine.getPlayer(human.id), human.id);
ok(humanSeen.npc === false, '玩家档案不带朝臣标记');

/* ── 14. 私函会话 ────────────────────────────────────────── */
engine.sendDirectMessage(human.id, bigNpc.id, '久仰大人清望。');
engine.sendDirectMessage(bigNpc.id, human.id, '后生可畏。');
const threads = engine.dmConversations(human.id);
ok(threads.length === 1, `会话列表 ${threads.length} 条`);
ok(threads[0].peerId === bigNpc.id && threads[0].total === 2, '往来计数正确');
ok(threads[0].unread === 1, `未读数 ${threads[0].unread}`);
const seenCount = engine.markDmSeen(human.id, bigNpc.id);
ok(seenCount === 1, '标记已读');
ok(engine.dmConversations(human.id)[0].unread === 0, '已读后未读归零');

/* ── 15. 朝局概览区分玩家与朝臣 ──────────────────────────── */
const ov = engine.courtOverview();
const gone = db
  .prepare('SELECT COUNT(*) AS c FROM players WHERE is_npc = 1 AND retired = 1')
  .get().c;
// 朝臣记录总数并非恒定：npcTick 末尾会补员（replenishCourt），空缺一开就补新血。
// 真正的不变量是「只增不删」—— 去位者只是 retired 置 1，记录仍在表里。
const totalNpcRecords = db.prepare('SELECT COUNT(*) AS c FROM players WHERE is_npc = 1').get().c;
ok(ov.players === 2, `在册玩家 ${ov.players} 人（不含朝臣）`);
ok(
  ov.npcs === totalNpcRecords - gone,
  `在册朝臣 ${ov.npcs} 员（共 ${totalNpcRecords} 员，其中 ${gone} 员已去位）`
);
ok(npc.npcCount() === ov.npcs, 'npcCount 与概览一致');
ok(
  totalNpcRecords >= npcCount,
  `朝臣记录只增不删（铺设 ${npcCount} 员 → 现存 ${totalNpcRecords} 员，其间补员 ${totalNpcRecords - npcCount} 员）`
);
const orphan = db
  .prepare('SELECT COUNT(*) AS c FROM players WHERE is_npc = 1 AND retired = 1 AND faction_id IS NOT NULL')
  .get().c;
ok(orphan === 0, `去位者已退出党派（${orphan} 员仍挂在党内）`);

/* ── 16. 朝臣主动出招（举荐 / 拉拢 / 构陷） ──────────────── */
// 反制是被动的，这一节验的是朝臣自己会不会来动你。
// 先给新玩家铺一张关系网：既有交情，也有过节，三种招法才都有机会出现。
const subject = engine.createPlayer('npc_t_subject', '受察者', 'secret123');
// 声望与圣眷刻意压低：构陷的判定是「攻方权势 vs 守方清望」，防守太高则每次都失手，
// 测不出构陷真的落到人身上。低守方才有稳定的得手样本。
setStats(subject.id, { merit: 400, renown: 60, favor: 40, network: 120, guile: 60 });

// 交情与过节都取高位朝臣：他们才够得着人，也才打得穿守备
const top = db
  .prepare('SELECT id FROM players WHERE is_npc = 1 AND retired = 0 ORDER BY rank_id DESC LIMIT 8')
  .all();
for (const f of top.slice(0, 4)) engine.applyRelation(f.id, subject.id, 'protege', 60);
for (const e of top.slice(4, 8)) engine.applyRelation(e.id, subject.id, 'nemesis', 60);

RNG = 0; // 必定出手；同时使 rnd(0.7,1.15) 取 0.7，构陷必然得手
const tally = {};
let acted = 0;
let mismatch = 0;
const snap = () => JSON.parse(engine.getPlayer(subject.id).stats);

// 每轮先把受察者拨回基线：否则被反复构陷之后政绩会归零、痕迹会顶到上限，
// 「下降」与「上升」都观察不到了，断言会因为量已见底而假性失败。
const BASELINE = { merit: 400, renown: 60, favor: 40, network: 120, guile: 60, exposure: 0 };
const resetSubject = () =>
  db
    .prepare('UPDATE players SET stats = ? WHERE id = ?')
    .run(JSON.stringify({ ...snap(), ...BASELINE }), subject.id);

for (let i = 0; i < 400; i += 1) {
  resetSubject();
  const before = snap();
  const r = npc.npcSocialTick();
  if (r.acted) {
    acted += 1;
    tally[r.kind] = (tally[r.kind] || 0) + 1;
  }
  if (r.targetId !== subject.id) continue;
  const after = snap();
  // 每种招法的效果必须与名目相符 —— 否则文案会说一套、结算做另一套
  if (r.kind === 'recommend' && !(after.favor > before.favor && after.renown > before.renown)) {
    mismatch += 1;
  }
  if (r.kind === 'recruit' && !(after.network > before.network)) mismatch += 1;
  if (r.kind === 'frame' && !(after.merit < before.merit && after.exposure > before.exposure)) {
    mismatch += 1;
  }
}
RNG = 0.3;

ok(acted > 0, `朝臣主动出手 ${acted} 次 / 400 回合`);
ok((tally.recommend || 0) > 0, `举荐出现 ${tally.recommend || 0} 次`);
ok((tally.recruit || 0) > 0, `拉拢出现 ${tally.recruit || 0} 次`);
ok((tally.frame || 0) > 0, `构陷出现 ${tally.frame || 0} 次`);
ok(mismatch === 0, `每种招法的结算与名目相符（${mismatch} 处不符）`);

// 举荐是双向的：他被记作你的恩主，你被记作他的门生
const patronOfSubject = db
  .prepare("SELECT COUNT(*) AS c FROM relations WHERE type = 'patron' AND from_id = ?")
  .get(subject.id).c;
const protegeOfActor = db
  .prepare("SELECT COUNT(*) AS c FROM relations WHERE type = 'protege' AND to_id = ?")
  .get(subject.id).c;
ok(patronOfSubject > 0, `举荐后你以他为恩主（${patronOfSubject} 条）`);
ok(protegeOfActor > 0, `举荐后他以你为门生（${protegeOfActor} 条）`);

const privateNotes = db
  .prepare("SELECT COUNT(*) AS c FROM gazette WHERE scope = 'private' AND player_id = ?")
  .get(subject.id).c;
ok(privateNotes > 0, `朝臣的举动已入本人私档（${privateNotes} 条）`);

// 隐私：构陷的公开风闻只让人知道「有事」，不该点名是谁下的手
const npcNames = db
  .prepare('SELECT display_name FROM players WHERE is_npc = 1')
  .all()
  .map((r) => r.display_name);
const rumors = db.prepare("SELECT text FROM gazette WHERE scope = 'global' AND kind = 'rumor'").all();
const leaked = rumors.filter((g) => npcNames.some((n) => g.text.includes(n)));
ok(leaked.length === 0, `公开风闻不点名（${leaked.length} 条泄露了出手者）`);

// 频率：随机没过时不打扰玩家
RNG = 0.99;
ok(npc.npcSocialTick().acted === 0, '随机未过时按兵不动，不打扰玩家');
RNG = 0.3;

console.log(`\n▌结果：${pass} 通过 / ${fail} 失败\n`);
db.close();
process.exit(fail ? 1 : 0);
