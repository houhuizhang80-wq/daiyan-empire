/**
 * 数值平衡跑批模拟
 *
 *   node scripts/sim.js                    # 默认 30 人 × 300 回合
 *   node scripts/sim.js --players=60 --ticks=600
 *
 * 用独立数据库跑完整对局，检验三件事：
 *   1. 晋升曲线是否合理（会不会永远升不上去，或一晚上就拜相）
 *   2. 明线与暗线是否都能通天（两条路都该走得通，代价不同）
 *   3. 缺额竞争是否形成（高位该抢，不该空着）
 *
 * 不触碰线上存档。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? Number(hit.split('=')[1]) : d;
};
const PLAYERS = arg('players', 30);
const TICKS = arg('ticks', 300);
const SEED = arg('seed', 20260915);
/** 扫参时并行跑多组配置，需各自独立的库文件，否则会互相踩踏 */
const TAG = process.argv.find((a) => a.startsWith('--tag='))?.split('=')[1] ?? '';
/** 精简输出：只打关键结论，便于一次扫十几组参数 */
const BRIEF = process.argv.includes('--brief');

const TMP = path.join(
  __dirname,
  '..',
  'data',
  `sim-${PLAYERS}x${TICKS}${TAG ? `-${TAG}` : ''}.db`
);
for (const f of [TMP, `${TMP}-wal`, `${TMP}-shm`]) if (fs.existsSync(f)) fs.rmSync(f, { force: true });
process.env.DB_PATH = TMP;
/**
 * 朝臣有自己的随机源（npc.js 的 prand），默认按当前时间播种 —— 线上要的就是每次开朝
 * 一张新面孔。但跑批必须钉死它，否则同一组参数两次运行结果不同（实测权臣均阶
 * 12.7 与 11.9 的差别全是噪声），扫参读数便毫无意义。
 */
process.env.NPC_SEED = String(SEED);

/* 可复现的随机源：让跑批结果稳定，便于对比调参前后的差异 */
let seed = SEED >>> 0;
Math.random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};

const { db, currentTick } = await import('../server/db.js');
const engine = await import('../server/game/engine.js');
const npc = await import('../server/game/npc.js');
const { RANKS, RANK_BY_ID, CONST, DOCTRINES, RANK_YIELD, YIELD_BASE } = await import('../server/game/data.js');
const { SCHEME_GUILE_COST } = await import('../server/game/actions.js');

/* 扫参：--yield=1.12 --warn=62 --impeach=0.45 --cover=68 —— 免去改一次源码跑一次的往复 */
const YIELD_OVERRIDE = Number(
  process.argv.find((a) => a.startsWith('--yield='))?.split('=')[1] ?? 0
);
const WARN_OVERRIDE = Number(
  process.argv.find((a) => a.startsWith('--warn='))?.split('=')[1] ?? 0
);
const IMPEACH_OVERRIDE = Number(
  process.argv.find((a) => a.startsWith('--impeach='))?.split('=')[1] ?? 0
);
const EROSION_OVERRIDE = Number(
  process.argv.find((a) => a.startsWith('--erosion='))?.split('=')[1] ?? 0
);
if (YIELD_OVERRIDE) {
  for (const r of RANKS) {
    RANK_YIELD.set(r.id, Number(Math.pow(YIELD_OVERRIDE, r.id).toFixed(3)));
  }
}
// 弹劾已改为软阈值：--warn 调警戒线，--impeach 调「暴露拉满时每回合的落马概率」。
// 早先 --impeach 覆盖的是已被删除的硬阈值 IMPEACH_THRESHOLD，会让扫参静默失效。
if (WARN_OVERRIDE) CONST.IMPEACH_WARN = WARN_OVERRIDE;
if (IMPEACH_OVERRIDE) CONST.IMPEACH_RATE = IMPEACH_OVERRIDE;
// 暴露度对圣眷的侵蚀：暗线除弹劾之外的「日常代价」。设 0 可单独观察它的影响。
if (process.argv.some((a) => a.startsWith('--erosion='))) {
  CONST.EXPOSURE_EROSION = EROSION_OVERRIDE;
}

/** 报告表头回显实际生效的官阶系数（未扫参时为 data.js 中的设定值） */
const YIELD_BASE_LIVE = YIELD_OVERRIDE || YIELD_BASE;

/** 权臣何时收手消弭痕迹。越低越谨慎，但要赔上更多回合。 */
const COVER_AT = arg('cover', 68);

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const ARCHETYPES = ['循吏', '干吏', '权臣'];

/** 三条路线共用的明线底子：正当权力 + 正常人情往来 */
const BASE_ACTIONS = ['policy', 'allocate', 'patrol', 'memorial', 'assess', 'banquet'];

/** 增速里程碑：抵达这些官阶所用的回合数，比终局均阶更能分辨快慢 */
const MILESTONES = [6, 9, 12, 15];

engine.initOfficeSlots();
npc.seedCourt();

/* ================================================================== *
 * 造人
 * ================================================================== */

const players = [];
for (let i = 0; i < PLAYERS; i += 1) {
  const archetype = ARCHETYPES[i % ARCHETYPES.length];
  const row = engine.createPlayer(
    `sim_${String(i).padStart(3, '0')}`,
    `${archetype}${String(i).padStart(2, '0')}`,
    'simpassword'
  );
  players.push({
    id: row.id,
    name: row.display_name,
    archetype,
    promotions: 0,
    impeached: 0,
    actions: {},
    milestones: {},
  });
}

const npcIds = db.prepare('SELECT id FROM players WHERE is_npc = 1').all().map((r) => r.id);

/* ================================================================== *
 * 行动策略
 * ================================================================== */

/** 按优先级依次尝试，取第一条能执行成功的；tally 用于统计行动使用频率 */
function tryActions(playerId, keys, targetId = null, tally = null) {
  for (const k of keys) {
    try {
      engine.performAction(playerId, k, targetId);
      if (tally) tally[k] = (tally[k] || 0) + 1;
      return k;
    } catch {
      /* 资力不足或冷却中，试下一条 */
    }
  }
  return null;
}

/**
 * 依次把每个行动都做一遍。
 *
 * 早先误用 tryActions 当主循环，结果每人每回合只做一个行动 ——
 * 循吏 100% 的回合都在「推行新政」，巡查、上书、考核一次没碰过，
 * 整个跑批测的是一个每回合只办一件事的假玩家。政令点本就够办四五件事。
 */
function doAll(playerId, keys, tally = null) {
  const done = [];
  for (const k of keys) {
    try {
      engine.performAction(playerId, k);
      if (tally) tally[k] = (tally[k] || 0) + 1;
      done.push(k);
    } catch {
      /* 资力不足或冷却中，略过 */
    }
  }
  return done;
}

/**
 * 挑「打得过」的人下手。
 *
 * 密谋的成败取决于 己方权谋+人脉 与 对方声望+圣眷 的对比。专挑位高权重者，
 * 几乎必然失手，而失手要赔上暴露度 —— 那是权臣的命门。会办事的人都挑软柿子。
 */
function pickWinnable(playerId, stats) {
  const power = (stats.guile || 0) + (stats.network || 0) * 0.5;
  const pool = db
    .prepare('SELECT id, stats FROM players WHERE retired = 0 AND id != ?')
    .all(playerId)
    .map((r) => {
      const s = JSON.parse(r.stats || '{}');
      return { id: r.id, defense: (s.renown || 0) * 0.6 + (s.favor || 0) * 0.4 + 20 };
    })
    .sort((a, b) => a.defense - b.defense);
  // 在「最软的六十人」里挑，且只挑确实打得过的
  const soft = pool.slice(0, 60);
  const winnable = soft.filter((r) => power > r.defense * 1.05);
  if (winnable.length) return pick(winnable).id;
  return soft.length ? pick(soft).id : null;
}

/** 随便找个在朝的人 —— 社交类行动必须指定对象 */
function pickPeer(playerId) {
  const pool = db
    .prepare('SELECT id FROM players WHERE retired = 0 AND id != ? LIMIT 200')
    .all(playerId);
  return pool.length ? pick(pool).id : null;
}

function takeTurn(p) {
  const row = engine.getPlayer(p.id);
  if (!row || row.retired) return;

  // 1) 裁断待决之事
  for (const ev of engine.listEvents(p.id)) {
    const affordable = ev.options.filter((o) => {
      const res = JSON.parse(row.resources || '{}');
      const st = JSON.parse(row.stats || '{}');
      return Object.entries(o.cost || {}).every(([k, v]) => {
        const have = k === 'silver' || k === 'mandate' ? res[k] : st[k];
        return (have || 0) >= v;
      });
    });
    const choice = pick(affordable.length ? affordable : ev.options);
    try {
      engine.resolveEvent(p.id, ev.id, choice.key);
    } catch {
      /* 忽略 */
    }
  }

  const stats = JSON.parse(engine.getPlayer(p.id).stats || '{}');
  const rank = engine.getPlayer(p.id).rank_id;
  // 密谋的权谋开销随官阶放大，判本钱够不够也得按同一口径
  const guileCost = SCHEME_GUILE_COST * RANK_YIELD.get(rank);

  // 2) 施政
  //    受控实验：三条路线共用同一套「正当权力 + 人情往来」的底子，
  //    唯一变量是往暗线里投多少回合（0% / 50% / 100%）。
  //    否则比的是「谁动作多」，而不是「地下权力划不划算」。
  doAll(p.id, BASE_ACTIONS, p.actions);

  const bump = (k) => {
    p.actions[k] = (p.actions[k] || 0) + 1;
  };

  const shadowTurn = () => {
    if ((stats.exposure || 0) >= COVER_AT) {
      tryActions(p.id, ['cover'], null, p.actions);
      return;
    }
    if ((stats.guile || 0) < guileCost) {
      // 权谋不足，先使银子买把柄 —— 权谋值是暗线的本钱
      tryActions(p.id, ['blackmail'], pickWinnable(p.id, stats), p.actions);
      return;
    }
    const t = pickWinnable(p.id, stats);
    if (!t) return;
    // 单独结算密谋，以便区分「得手」与「失手」—— 失手只赔暴露度，是暗线最大的隐性成本
    try {
      const r = engine.performAction(p.id, 'scheme', t);
      bump('scheme');
      if ((r.effects?.merit || 0) > 0) bump('scheme✓');
    } catch {
      tryActions(p.id, ['slander', 'poach', 'collude'], t, p.actions);
    }
  };

  // 三条路线每回合都只有「一个额外的动作」的差别：
  // 循吏拿它去应酬，干吏一半回合拿去运作，权臣每回合都运作。
  if (p.archetype === '循吏') {
    tryActions(p.id, ['recommend', 'gift', 'letter'], pickPeer(p.id), p.actions);
  } else if (p.archetype === '干吏') {
    if (Math.random() < 0.5) shadowTurn();
  } else {
    shadowTurn();
  }

  // 3) 铨选
  const before = engine.getPlayer(p.id).rank_id;
  try {
    const r = engine.attemptPromotion(p.id);
    if (r.success) p.promotions += 1;
  } catch {
    /* 未达标或无缺 */
  }
  const after = engine.getPlayer(p.id);
  if (after.impeach_count > 0 && before > after.rank_id) p.impeached += 1;
}

/* ================================================================== *
 * 跑批
 * ================================================================== */

const firstReach = {}; // rankId -> tick 首次有人达到
const history = []; // 每 N 回合快照

const SNAPSHOT_EVERY = Math.max(10, Math.round(TICKS / 12));

for (let t = 1; t <= TICKS; t += 1) {
  for (const p of players) takeTurn(p);
  engine.runTick();

  for (const p of players) {
    const r = engine.getPlayer(p.id);
    if (!r.retired && firstReach[r.rank_id] === undefined) firstReach[r.rank_id] = t;
    // 抵达里程碑官阶的回合数 —— 缺额饱和之后均阶不再有区分度，这才是真正的增速指标
    if (!r.retired) {
      for (const m of MILESTONES) {
        if (r.rank_id >= m && p.milestones[m] === undefined) p.milestones[m] = t;
      }
    }
  }

  if (t % SNAPSHOT_EVERY === 0 || t === TICKS) {
    const rows = players.map((p) => engine.getPlayer(p.id)).filter((r) => !r.retired);
    const ranks = rows.map((r) => r.rank_id);
    const exposures = rows.map((r) => JSON.parse(r.stats).exposure || 0);
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    history.push({
      tick: t,
      n: rows.length,
      avgRank: avg(ranks),
      maxRank: ranks.length ? Math.max(...ranks) : 0,
      minRank: ranks.length ? Math.min(...ranks) : 0,
      avgExposure: avg(exposures),
      over50: exposures.filter((e) => e > 50).length,
      promoted: p0(rows.map((r) => JSON.parse(r.stats).merit)),
    });
  }
}

function p0(a) {
  return a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
}

/* ================================================================== *
 * 报告
 * ================================================================== */

const line = (s = '') => {
  if (!BRIEF) console.log(s);
};
const bar = (n, max, width = 34) => '█'.repeat(Math.max(0, Math.round((n / Math.max(max, 1)) * width)));

line();
line('╔══════════════════════════════════════════════════════════════════╗');
line('║              大衍帝国 · 数值平衡跑批报告                        ║');
line('╚══════════════════════════════════════════════════════════════════╝');
line(`  规模      ${PLAYERS} 名玩家 × ${TICKS} 回合（每回合 ${Math.round(CONST.TICK_MS / 60000)} 分钟）`);
line(`  折算      约 ${(TICKS * CONST.TICK_MS / 3600000).toFixed(1)} 小时真实时间`);
line(`  朝臣      56 员 · 竞争性缺额 54 个`);
line(
  `  参数      官阶系数 ${YIELD_BASE_LIVE} · 弹劾警戒 ${CONST.IMPEACH_WARN} · ` +
    `拉满落马率 ${CONST.IMPEACH_RATE} · 收手线 ${COVER_AT} · 权谋开销 ${SCHEME_GUILE_COST}`
);
line();

/* ── 1. 晋升曲线 ── */
line('▌一、晋升曲线（历次快照）');
line('  回合   在册   均阶   最高   均暴露  暴露>50   均政绩');
for (const h of history) {
  line(
    `  ${String(h.tick).padStart(4)}   ${String(h.n).padStart(4)}   ` +
      `${h.avgRank.toFixed(2).padStart(5)}   ${String(h.maxRank).padStart(3)}   ` +
      `${h.avgExposure.toFixed(1).padStart(6)}   ${String(h.over50).padStart(6)}   ${String(h.promoted).padStart(6)}`
  );
}
line();

/* ── 2. 首次到达各阶所需回合 ── */
line('▌二、首次抵达各阶所需回合');
const reached = Object.entries(firstReach)
  .map(([k, v]) => [Number(k), v])
  .sort((a, b) => a[0] - b[0]);
const maxReach = reached.length ? reached[reached.length - 1][0] : 0;
for (const [rankId, tick] of reached) {
  const r = RANK_BY_ID.get(rankId);
  line(
    `  ${String(tick).padStart(4)} 回合   ${r.grade}${r.title.padEnd(6)} ` +
      `(${String(Math.round((tick * CONST.TICK_MS) / 3600000)).padStart(3)} 小时)  ${bar(rankId, maxReach)}`
  );
}
line();

/* ── 3. 三种路线的结局 ── */
line('▌三、三条路线对比');
const byArch = {};
for (const p of players) {
  const r = engine.getPlayer(p.id);
  const st = JSON.parse(r.stats || '{}');
  (byArch[p.archetype] ||= []).push({
    rank: r.retired ? -1 : r.rank_id,
    exposure: st.exposure || 0,
    impeached: r.impeach_count,
    promotions: p.promotions,
    peak: r.career_peak,
    retired: r.retired,
  });
}
line('  路线    人数   平均阶  最高阶  平均暴露  弹劾人次  弹劾人数  均迁转  生涯顶点  去位');
for (const [k, list] of Object.entries(byArch)) {
  const avg = (f) => (list.reduce((a, x) => a + f(x), 0) / list.length).toFixed(2);
  const events = list.reduce((a, x) => a + x.impeached, 0);
  const victims = list.filter((x) => x.impeached > 0).length;
  line(
    `  ${k.padEnd(6)}  ${String(list.length).padStart(4)}   ` +
      `${avg((x) => Math.max(0, x.rank)).padStart(6)}   ` +
      `${String(Math.max(...list.map((x) => x.rank))).padStart(4)}   ` +
      `${avg((x) => x.exposure).padStart(8)}   ` +
      `${String(events).padStart(8)}   ` +
      `${String(victims).padStart(8)}   ` +
      `${avg((x) => x.promotions).padStart(6)}   ` +
      `${avg((x) => x.peak).padStart(8)}   ` +
      `${String(list.filter((x) => x.retired).length).padStart(4)}`
  );
}
line();

/* ── 3b. 行动构成与终局属性 ── */
line('▌三之二、行动构成（每百回合）与终局属性');
for (const [k, list] of Object.entries(byArch)) {
  const rows = players.filter((p) => p.archetype === k);
  const tally = {};
  for (const p of rows) {
    for (const [ak, n] of Object.entries(p.actions)) tally[ak] = (tally[ak] || 0) + n;
  }
  const top = Object.entries(tally)
    .map(([ak, n]) => [ak, (n / rows.length / TICKS) * 100])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 9)
    .map(([ak, n]) => `${ak} ${n.toFixed(1)}`)
    .join('  ');
  line(`  ${k}：${top}`);
}
line();
line('  路线   均政绩   均声望   均人脉   均圣眷   均权谋   均暴露   均银两');
for (const [k] of Object.entries(byArch)) {
  const rows = players.filter((p) => p.archetype === k).map((p) => engine.getPlayer(p.id));
  const avg = (f) => Math.round(rows.reduce((a, r) => a + f(r), 0) / rows.length);
  const st = (r) => JSON.parse(r.stats || '{}');
  const rs = (r) => JSON.parse(r.resources || '{}');
  line(
    `  ${k.padEnd(6)} ${String(avg((r) => st(r).merit || 0)).padStart(7)} ` +
      `${String(avg((r) => st(r).renown || 0)).padStart(8)} ` +
      `${String(avg((r) => st(r).network || 0)).padStart(8)} ` +
      `${String(avg((r) => st(r).favor || 0)).padStart(8)} ` +
      `${String(avg((r) => st(r).guile || 0)).padStart(8)} ` +
      `${String(avg((r) => st(r).exposure || 0)).padStart(8)} ` +
      `${String(avg((r) => rs(r).silver || 0)).padStart(8)}`
  );
}
line();

/* ── 3c. 增速里程碑 ── */
line('▌三之三、抵达各阶所需回合（中位；未达者不计入）');
const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
line(`  路线   ${MILESTONES.map((m) => `${RANK_BY_ID.get(m).grade}${RANK_BY_ID.get(m).title}`.padEnd(8)).join(' ')}`);
for (const [k] of Object.entries(byArch)) {
  const rows = players.filter((p) => p.archetype === k);
  const cells = MILESTONES.map((m) => {
    const ts = rows.map((p) => p.milestones[m]).filter((v) => v !== undefined);
    const md = median(ts);
    return (md === null ? `未达(${ts.length})` : `${md}(${ts.length})`).padEnd(8);
  });
  line(`  ${k.padEnd(6)} ${cells.join(' ')}`);
}
line('  括号内为在该回合前已达此阶的人数');
line();

/* ── 4. 终局分布 ── */
line('▌四、终局官阶分布（玩家 + 朝臣）');
const all = db.prepare('SELECT * FROM players WHERE retired = 0').all();
const dist = new Map();
for (const r of all) dist.set(r.rank_id, (dist.get(r.rank_id) || 0) + 1);
const maxCount = Math.max(...dist.values());
for (let i = RANKS.length - 1; i >= 0; i -= 1) {
  const n = dist.get(i) || 0;
  const rank = RANK_BY_ID.get(i);
  const stat = engine.slotStats(i);
  // 分母必须取实际占缺行数：员额会随人口放量，静态配置早已不是真值
  const slotText = stat.total === null ? '不限' : `${stat.filled}/${stat.total}`;
  line(
    `  ${rank.grade}${rank.title.padEnd(6)} ${String(slotText).padStart(6)}  ` +
      `${String(n).padStart(3)} 人  ${bar(n, maxCount, 24)}`
  );
}
line();

/* ── 5. 缺额竞争 ── */
line('▌五、缺额竞争');
const contested = RANKS.filter((r) => r.slots !== null);
let filled = 0;
let cap = 0;
const hot = [];
for (const r of contested) {
  const s = engine.slotStats(r.id);
  filled += s.filled;
  cap += s.total;
  if (s.filled >= s.total) hot.push(r.title);
}
line(`  竞争性缺额占用  ${filled} / ${cap}（${((filled / cap) * 100).toFixed(0)}%）`);
line(`  已满员官阶      ${hot.length} / ${contested.length}  ${hot.length ? `→ ${hot.join('、')}` : ''}`);
line();

/* ── 6. 经济与派系 ── */
line('▌六、经济与派系');
const silvers = all.map((r) => JSON.parse(r.resources || '{}').silver || 0).sort((a, b) => a - b);
const sum = silvers.reduce((a, b) => a + b, 0);
line(`  银两总额  ${sum.toLocaleString()}  中位 ${silvers[Math.floor(silvers.length / 2)]?.toLocaleString()}`);
line(`  最富      ${silvers[silvers.length - 1]?.toLocaleString()}   最穷 ${silvers[0]?.toLocaleString()}`);
for (const f of engine.listFactions()) {
  line(
    `  ${f.name.padEnd(5)} ${DOCTRINES[f.doctrine].name}  党员 ${String(f.members.length).padStart(2)}  党势 ${String(f.power).padStart(7)}  党库 ${String(f.treasury).padStart(6)}`
  );
}
line();

/* ── 7. 诊断 ── */
line('▌七、诊断');
const finalRows = players.map((p) => engine.getPlayer(p.id)).filter((r) => !r.retired);
const finalAvg = finalRows.length
  ? finalRows.reduce((a, r) => a + r.rank_id, 0) / finalRows.length
  : 0;
const topRank = finalRows.length ? Math.max(...finalRows.map((r) => r.rank_id)) : 0;
const verdicts = [];
const verdict = (cond, good, bad) => {
  const text = cond ? good : bad;
  verdicts.push({ ok: cond, text });
  line(`  ${cond ? '✓' : '✗'} ${text}`);
};

/**
 * 晋升节奏的目标区间随回合数放宽。
 *
 * 300 回合（默认规模）的目标是 3–11 级。但官阶晋升受缺额容量封顶（全服仅 54 个
 * 竞争性缺额），长局的均阶必然继续上爬并逼近容量上限 —— 拿同一把上界尺子去量
 * 600 回合，只会得到一个必然失败的裁决，裁决本身失去意义。
 *
 * 实测曲线：400 回合 10.3、600 回合 12.0（均阶 ≈ √回合数 增长）。
 * 故上界按每多 100 回合放宽 1 级，封顶 14（再高就意味着全员挤在中枢，官阶体系已失效）。
 */
const paceHigh = Math.min(14, 11 + Math.max(0, (TICKS - 300) / 100));
verdict(
  finalAvg >= 3 && finalAvg <= paceHigh,
  `晋升节奏合理：均阶 ${finalAvg.toFixed(1)}（目标区间 3–${paceHigh}）`,
  `晋升节奏失衡：均阶 ${finalAvg.toFixed(1)}，不在 3–${paceHigh} 区间`
);
/**
 * 顶层可达性只在足够长的局里才有意义。
 * 按实测曲线，第 12 级约需 230 回合，故 300 回合以下一律不计 ——
 * 否则一次 100 回合的快速自查会亮出红叉，让人误以为平衡崩了。
 */
const topReachable = TICKS >= 300;
verdict(
  !topReachable || (topRank >= 12 && topRank <= 17),
  topReachable
    ? `顶层可达：最高第 ${topRank} 级（${RANK_BY_ID.get(topRank).title}）`
    : `顶层可达：本局仅 ${TICKS} 回合，尚不足以抵达中枢（最高第 ${topRank} 级）`,
  `顶层不可达：最高仅第 ${topRank} 级，说明卡死了`
);
verdict(
  filled / cap >= 0.6,
  `缺额竞争形成：占用率 ${((filled / cap) * 100).toFixed(0)}%`,
  `缺额大量空置：占用率仅 ${((filled / cap) * 100).toFixed(0)}%`
);

const shadowRows = byArch['权臣'] || [];
const cleanRows = byArch['循吏'] || [];
const shadowAvg = shadowRows.reduce((a, x) => a + Math.max(0, x.rank), 0) / (shadowRows.length || 1);
const cleanAvg = cleanRows.reduce((a, x) => a + Math.max(0, x.rank), 0) / (cleanRows.length || 1);
const shadowImp = shadowRows.filter((x) => x.impeached > 0).length / (shadowRows.length || 1);
verdict(
  shadowAvg > cleanAvg && shadowImp > 0,
  `暗线有效但有代价：均阶高 ${(shadowAvg - cleanAvg).toFixed(2)}，${(shadowImp * 100).toFixed(0)}% 被弹劾过`,
  `暗线失衡：均阶差 ${(shadowAvg - cleanAvg).toFixed(2)}，弹劾率 ${(shadowImp * 100).toFixed(0)}%`
);
verdict(
  cleanAvg >= 3,
  `明线可行：循吏均阶 ${cleanAvg.toFixed(1)}`,
  `明线不可行：循吏均阶仅 ${cleanAvg.toFixed(1)}`
);
line();
line(`  回合终值 ${currentTick()}`);
line();

/* ── 精简模式：每组配置一行，便于成批扫参 ── */
if (BRIEF) {
  const cfg = `yield=${YIELD_BASE_LIVE} warn=${CONST.IMPEACH_WARN} rate=${CONST.IMPEACH_RATE} erosion=${CONST.EXPOSURE_EROSION} cover=${COVER_AT}`;
  const parts = Object.entries(byArch).map(([k, list]) => {
    const avgRank = (list.reduce((a, x) => a + Math.max(0, x.rank), 0) / list.length).toFixed(1);
    const top = Math.max(...list.map((x) => x.rank));
    const imp = ((list.filter((x) => x.impeached > 0).length / list.length) * 100).toFixed(0);
    return `${k} ${avgRank}/${top}(${imp}%)`;
  });
  const flags = verdicts.map((v) => (v.ok ? '✓' : '✗')).join('');
  console.log(
    `[${cfg}] ${PLAYERS}人×${TICKS}回合  ${parts.join('  ')}  ${flags}`
  );
  for (const v of verdicts) if (!v.ok) console.log(`    ✗ ${v.text}`);
}

db.close();

// 跑批库是纯中间产物，用完即弃。但在某些受管环境里，批量删除会被安全策略拦下 ——
// 那不该让一次成功的跑批以非零码退出（结果早已打印完毕）。故吞掉删除异常，
// 只提示残留文件，让调用方自行清理。
try {
  fs.rmSync(TMP, { force: true });
  for (const f of [`${TMP}-wal`, `${TMP}-shm`]) fs.rmSync(f, { force: true });
} catch {
  console.error(`（提示：跑批库未能自动删除，可手动清理 ${path.basename(TMP)}）`);
}
