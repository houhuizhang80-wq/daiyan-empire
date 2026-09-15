/**
 * 朝臣（NPC）系统
 *
 * 开朝时铺设一批「朝廷原班底」，占据部分缺额，使新服不至于空无一人。
 * 朝臣每回合自行积累政绩、铨选迁转、偶发丑闻与休致，形成有机的朝局流动；
 * 玩家遭其暗算时，权势足够的朝臣会反制。
 *
 * 本模块与 engine.js 互相引用（ESM 循环），双方都只在函数体内调用对方，
 * 不使用顶层求值，因此安全。
 */

import { db, now, currentTick } from '../db.js';
import {
  RANKS,
  RANK_BY_ID,
  MAX_RANK,
  CONTESTED_FROM,
  DOCTRINES,
  CONST,
  DEFAULT_STATS,
  DEFAULT_RESOURCES,
  rankYield,
  organKeysForRank,
} from './data.js';
import {
  applyEffects,
  applyRelation,
  attemptPromotion,
  impeach,
  impeachRisk,
  gazette,
  powerOf,
  amplify,
} from './engine.js';

/* ================================================================== *
 * 姓名池（全部虚构）
 * ================================================================== */

const SURNAMES = [
  '裴', '崔', '卢', '郑', '谢', '沈', '陆', '顾', '苏', '韩',
  '柳', '薛', '岑', '温', '卫', '蒋', '邵', '冯', '阮', '施',
  '秦', '许', '严', '翁', '骆', '钟', '闵', '屠', '屈', '桑',
];

const GIVEN = [
  '延之', '明远', '子昂', '敬亭', '元朗', '伯谦', '仲舒', '叔达', '季常', '怀瑾',
  '承嗣', '景行', '慎之', '从简', '守拙', '知非', '无咎', '立本', '用之', '允恭',
  '弘毅', '致远', '观澜', '抱朴', '栖迟', '澹如', '简之', '慎微', '守正', '清臣',
  '文靖', '子渊', '公度', '彦直', '若愚', '恒之', '行简', '省身', '履端', '慕陶',
];

/* ================================================================== *
 * 开局建制方案
 * ================================================================== */

/** 竞争性官阶的铺陈数量（小于总员额，给玩家留出空间） */
const COURT_PLAN = {
  17: 1, // 首辅
  16: 1, // 次辅
  15: 3, // 群辅（共 4 缺）
  14: 4, // 尚书（六曹共 6 缺）
  13: 1, // 左都御史
  12: 1, // 大理寺卿
  11: 4, // 侍郎（六曹共 6 缺）
  10: 6, // 员外郎（共 12 缺）
  9: 6, // 郎中（共 12 缺）
  8: 1, // 郡守
  7: 1, // 郡丞
  6: 1, // 州同知
  5: 1, // 州判
  4: 1, // 县令（共 3 缺）
};

/** 基层不限员额的朝臣数量 */
const JUNIOR_PLAN = { 0: 7, 1: 6, 2: 6, 3: 5 };

/** 朝堂应维持的朝臣员额。低于此数即开科补员，避免长局之后朝中无人。 */
export const COURT_SIZE =
  Object.values(COURT_PLAN).reduce((a, b) => a + b, 0) +
  Object.values(JUNIOR_PLAN).reduce((a, b) => a + b, 0);

/** 开局党派 */
const FACTION_PLAN = [
  { name: '清议堂', doctrine: 'qingliu', motto: '宁鸣而死，不默而生。' },
  { name: '度支局', doctrine: 'shiwu', motto: '钱谷不欺人。' },
  { name: '守拙会', doctrine: 'shoucheng', motto: '不为天下先。' },
  { name: '新政社', doctrine: 'jijin', motto: '弊不去，政不立。' },
];

/* ================================================================== *
 * 工具
 * ================================================================== */

const rnd = (a, b) => Math.random() * (b - a) + a;
const rndInt = (a, b) => Math.floor(rnd(a, b + 1));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function parseJSON(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function doctrineOf(row) {
  if (!row.faction_id) return null;
  const f = db.prepare('SELECT doctrine FROM factions WHERE id = ?').get(row.faction_id);
  return f ? DOCTRINES[f.doctrine] : null;
}

function takeSlot(rankId, organKey, playerId) {
  // 先试指定衙门；该衙门满员则退而求其次，任取本阶尚空的缺
  // （否则「六曹各二」这类多衙门官阶会因随机落点重复而空置大量缺额）
  const row =
    db
      .prepare(
        'SELECT * FROM office_slots WHERE rank_id = ? AND organ_key = ? AND holder_id IS NULL ORDER BY slot_index LIMIT 1'
      )
      .get(rankId, organKey) ??
    db
      .prepare(
        'SELECT * FROM office_slots WHERE rank_id = ? AND holder_id IS NULL ORDER BY organ_key, slot_index LIMIT 1'
      )
      .get(rankId);
  if (!row) return null;
  db.prepare('UPDATE office_slots SET holder_id = ?, since = ? WHERE id = ?').run(
    playerId,
    now(),
    row.id
  );
  return row;
}

/* ================================================================== *
 * 开朝建制
 * ================================================================== */

/** 朝臣序号，仅用于生成唯一登录名（朝臣不可登录） */
let npcSeq = 0;

/**
 * 独立的线性同余随机源。
 * 刻意不复用 Math.random —— 测试里会把它固定成常量，若共用会导致朝臣姓名全部相同。
 *
 * 默认以当前时间播种：线上每次开朝都该是一张新面孔。
 * 但可用 NPC_SEED 环境变量钉死种子 —— 数值平衡跑批（scripts/sim.js）靠它保证
 * 同一组参数多次运行结果完全一致，否则扫参读数里全是噪声，调参无从谈起。
 */
let seed = ((Number(process.env.NPC_SEED) || Date.now()) ^ 0x5f3759df) >>> 0;
function prand() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
const prndInt = (a, b) => a + Math.floor(prand() * (b - a + 1));

function nextName(used) {
  for (let i = 0; i < 800; i += 1) {
    const name = SURNAMES[prndInt(0, SURNAMES.length - 1)] + GIVEN[prndInt(0, GIVEN.length - 1)];
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  return `无名氏${used.size}`;
}

function mkNpc(rankId, used, factionId = null) {
  const rank = RANK_BY_ID.get(rankId);
  const next = RANK_BY_ID.get(Math.min(rankId + 1, MAX_RANK));
  const base = next.cap;

  // 资历大致落在「下一阶门槛的一半到八成」之间，使其仍需继续经营
  const stats = {
    ...DEFAULT_STATS,
    merit: Math.round(base * rnd(0.22, 0.52)),
    renown: Math.round(base * rnd(0.14, 0.34)),
    network: Math.round(base * rnd(0.14, 0.34)),
    favor: Math.round(base * rnd(0.07, 0.24)),
    guile: Math.round(base * rnd(0.05, 0.22)),
    exposure: rndInt(0, 22),
    health: rndInt(70, 100),
  };
  const resources = {
    ...DEFAULT_RESOURCES,
    silver: Math.round(rank.salary * rnd(4, 16)),
    mandate: rank.mandate,
  };

  const name = nextName(used);
  const t = now();
  const info = db
    .prepare(
      `INSERT INTO players
       (username, display_name, password_hash, created_at, last_seen,
        rank_id, office_key, faction_id, stats, resources, tenure, history, is_npc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      `npc_${(npcSeq += 1).toString().padStart(4, '0')}_${prndInt(100000, 999999)}`,
      name,
      '*', // NPC 不可登录：占位哈希
      t,
      t - 1000 * 60 * 60 * 24 * 30, // 恒为离线
      rankId,
      null,
      factionId,
      JSON.stringify(stats),
      JSON.stringify(resources),
      rndInt(3, 55),
      JSON.stringify([
        { tick: currentTick(), rankId, title: rank.title, note: '朝廷旧人', at: t },
      ])
    );

  const id = info.lastInsertRowid;

  // 竞争性官阶占缺
  if (rank.slots !== null) {
    const keys = organKeysForRank(rankId);
    // 用模块自己的随机源，不用 Math.random：测试会把它钉成常量，
    // 那样所有朝臣都会挤进同一个衙门、同一个党派，朝堂建制失真
    const organKey = keys[Math.floor(prand() * keys.length)];
    const slot = takeSlot(rankId, organKey, id);
    if (slot) {
      db.prepare('UPDATE players SET office_key = ? WHERE id = ?').run(organKey, id);
    }
  } else {
    const keys = organKeysForRank(rankId);
    db.prepare('UPDATE players SET office_key = ? WHERE id = ?').run(keys[0], id);
  }

  db.prepare('UPDATE players SET career_peak = ? WHERE id = ?').run(rankId, id);
  return id;
}

/**
 * 铺设朝臣。幂等：已有朝臣则跳过，除非 force。
 */
export function seedCourt({ force = false } = {}) {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM players WHERE is_npc = 1').get().c;
  if (existing && !force) return { created: 0, factions: 0, skipped: true };

  return db.transaction(() => {
    const used = new Set(
      db.prepare('SELECT display_name FROM players').all().map((r) => r.display_name)
    );

    // 1) 开党
    let factions = 0;
    const factionIds = {};
    for (const f of FACTION_PLAN) {
      const dup = db.prepare('SELECT id FROM factions WHERE name = ?').get(f.name);
      if (dup) {
        factionIds[f.doctrine] = dup.id;
        continue;
      }
      const info = db
        .prepare(
          'INSERT INTO factions (name, doctrine, leader_id, treasury, power, motto, created_at) VALUES (?, ?, NULL, ?, 0, ?, ?)'
        )
        .run(f.name, f.doctrine, rndInt(400, 1600), f.motto, now());
      factionIds[f.doctrine] = info.lastInsertRowid;
      factions += 1;
    }

    // 2) 补缺朝臣
    const created = [];
    for (const [rankIdStr, count] of Object.entries({ ...COURT_PLAN, ...JUNIOR_PLAN })) {
      const rankId = Number(rankIdStr);
      for (let i = 0; i < count; i += 1) {
        const id = mkNpc(rankId, used);
        created.push({ id, rankId });
      }
    }

    // 3) 分党：高位略偏清流守成，但四党在各阶都要有人。
    //    早先高位只派清流/守成/实务，新政社（激进）永远到不了中枢 ——
    //    于是「手黑」这一路在朝堂上始终没有分量：实测按官阶加权挑出手者时，
    //    激进仅占 6% 的出手，构陷这条路等于形同虚设。
    const doctrineKeys = FACTION_PLAN.map((f) => f.doctrine);
    let spread = 0;
    for (const c of created) {
      if (prand() < 0.12) continue; // 一部分人不结党
      const roll = prand();
      let key;
      if (c.rankId >= 14) {
        key = roll < 0.34 ? 'qingliu' : roll < 0.56 ? 'shoucheng' : roll < 0.78 ? 'shiwu' : 'jijin';
      } else if (c.rankId >= 9) {
        key = roll < 0.28 ? 'shiwu' : roll < 0.52 ? 'qingliu' : roll < 0.78 ? 'jijin' : 'shoucheng';
      } else {
        key = doctrineKeys[spread % doctrineKeys.length];
        spread += 1;
      }
      const fid = factionIds[key];
      if (fid) db.prepare('UPDATE players SET faction_id = ? WHERE id = ?').run(fid, c.id);
    }

    // 3b) 兜底：每党至少得有人，否则无魁、无势，形同虚设
    for (const key of doctrineKeys) {
      const fid = factionIds[key];
      if (!fid) continue;
      const n = db.prepare('SELECT COUNT(*) AS c FROM players WHERE faction_id = ?').get(fid).c;
      if (n > 0) continue;
      const donor = db
        .prepare(
          `SELECT faction_id AS fid, COUNT(*) AS c FROM players
           WHERE is_npc = 1 AND faction_id IS NOT NULL AND faction_id != ?
           GROUP BY faction_id ORDER BY c DESC LIMIT 1`
        )
        .get(fid);
      if (!donor) continue;
      const movers = db
        .prepare('SELECT id FROM players WHERE faction_id = ? ORDER BY RANDOM() LIMIT 3')
        .all(donor.fid);
      for (const m of movers) {
        db.prepare('UPDATE players SET faction_id = ? WHERE id = ?').run(fid, m.id);
      }
    }

    // 4) 定党魁：各党中官阶最高者
    for (const fid of Object.values(factionIds)) {
      const top = db
        .prepare('SELECT id FROM players WHERE faction_id = ? ORDER BY rank_id DESC LIMIT 1')
        .get(fid);
      if (top) db.prepare('UPDATE factions SET leader_id = ? WHERE id = ?').run(top.id, fid);
    }

    // 5) 织关系网：党魁 → 党员为恩主/门生；各党魁互为政敌
    for (const fid of Object.values(factionIds)) {
      const row = db.prepare('SELECT leader_id FROM factions WHERE id = ?').get(fid);
      const leader = row?.leader_id;
      if (!leader) continue;
      const members = db
        .prepare('SELECT id FROM players WHERE faction_id = ? AND id != ? ORDER BY RANDOM() LIMIT 6')
        .all(fid, leader);
      for (const m of members) {
        applyRelation(leader, m.id, 'patron', rndInt(30, 60));
        applyRelation(m.id, leader, 'protege', rndInt(35, 70));
      }
    }
    const leaders = db
      .prepare('SELECT id FROM players WHERE is_npc = 1 AND id IN (SELECT leader_id FROM factions WHERE leader_id IS NOT NULL)')
      .all();
    for (let i = 0; i < leaders.length; i += 1) {
      for (let j = i + 1; j < leaders.length; j += 1) {
        applyRelation(leaders[i].id, leaders[j].id, 'rival', rndInt(25, 55));
        applyRelation(leaders[j].id, leaders[i].id, 'rival', rndInt(25, 55));
      }
    }

    gazette(
      'global',
      null,
      'system',
      `朝廷旧人 ${created.length} 员在列，四党并立，各据要津。新进者欲出头，须自下而上。`
    );

    return { created: created.length, factions, skipped: false };
  })();
}

/**
 * 开科补员：朝臣因休致、落马、被挤缺而减少时，朝廷开科取士补足员额。
 * 否则长局之后朝中会空无一人。
 */
export function replenishCourt(maxPerTick = 3) {
  const active = db
    .prepare('SELECT COUNT(*) AS c FROM players WHERE is_npc = 1 AND retired = 0')
    .get().c;
  const deficit = COURT_SIZE - active;
  if (deficit <= 0) return 0;

  const n = Math.min(maxPerTick, deficit);
  return db.transaction(() => {
    const used = new Set(
      db.prepare('SELECT display_name FROM players').all().map((r) => r.display_name)
    );
    // 优先补进人最少的党，维持四党均势
    const factions = db
      .prepare(
        `SELECT f.id, COUNT(p.id) AS n FROM factions f
         LEFT JOIN players p ON p.faction_id = f.id AND p.retired = 0
         GROUP BY f.id ORDER BY n ASC`
      )
      .all();

    let created = 0;
    for (let i = 0; i < n; i += 1) {
      const fid = factions.length ? factions[i % factions.length].id : null;
      mkNpc(prndInt(0, 2), used, fid); // 新进者自基层起
      created += 1;
    }

    // 党魁出缺者，由党内官阶最高者接任
    for (const f of db.prepare('SELECT id, leader_id FROM factions').all()) {
      if (f.leader_id) {
        const cur = db.prepare('SELECT retired FROM players WHERE id = ?').get(f.leader_id);
        if (cur && !cur.retired) continue;
      }
      const top = db
        .prepare(
          'SELECT id FROM players WHERE faction_id = ? AND retired = 0 ORDER BY rank_id DESC LIMIT 1'
        )
        .get(f.id);
      db.prepare('UPDATE factions SET leader_id = ? WHERE id = ?').run(top?.id ?? null, f.id);
    }

    if (created) {
      gazette('global', null, 'system', `朝廷开科，新进 ${created} 员释褐入仕，分发州县候用。`);
    }
    return created;
  })();
}

/* ================================================================== *
 * 每回合行为
 * ================================================================== */

export function npcTick(tick) {
  const npcs = db.prepare('SELECT * FROM players WHERE is_npc = 1 AND retired = 0').all();
  const result = { promoted: 0, impeached: 0, retired: 0, total: npcs.length, recruited: 0 };

  for (const n of npcs) {
    const rank = RANK_BY_ID.get(n.rank_id);
    const doc = doctrineOf(n);

    const stats = { ...DEFAULT_STATS, ...parseJSON(n.stats, {}) };
    const resources = { ...DEFAULT_RESOURCES, ...parseJSON(n.resources, {}) };

    // ── 清算上一回合的旧账：暴露越线者先行发落 ──
    // 必须放在衰减之前，否则越线的暴露度会先被减下去，永远轮不到发落
    if (Math.random() < impeachRisk(stats.exposure)) {
      impeach(n);
      result.impeached += 1;
      continue;
    }

    // ── 政绩自然增长 ──
    // 必须与玩家的官阶收益系数同源：若朝臣仍按旧式增长，长局中他们会被永远
    // 甩在基层，而朝廷又只从基层补员 —— 中枢各缺将长年空置。
    // 系数取玩家的一半上下：朝臣是「平庸的同僚」，不是竞争者里的强者。
    const y = rankYield(n.rank_id);
    stats.merit += Math.round(16 * y * (doc?.meritMul ?? 1) * rnd(0.5, 1.5));
    stats.renown += Math.round(7 * y * (doc?.renownMul ?? 1) * rnd(0.4, 1.6));
    stats.network += Math.round(6 * y * rnd(0.4, 1.6));
    stats.favor += Math.round(3.5 * y * rnd(0.3, 1.7));
    stats.guile += Math.round(5 * y * (doc?.guileMul ?? 1) * rnd(0.4, 1.6));

    // ── 俸禄与政令 ──
    // 朝臣不事经营，俸禄超出用度者大多耗于门第排场，只有一小部分输入党库。
    // 早先全额入党库，长局后党库会堆到数百万两，成为一个毫无意义的数字。
    const cap = rank.salary * 20;
    const afterPay = resources.silver + rank.salary;
    const overflow = Math.max(0, afterPay - cap);
    resources.silver = afterPay - overflow;
    resources.mandate = rank.mandate;
    if (overflow > 0 && n.faction_id) {
      db.prepare('UPDATE factions SET treasury = treasury + ? WHERE id = ?').run(
        Math.round(overflow * 0.15),
        n.faction_id
      );
    }

    // ── 暴露度自然衰减 ──
    stats.exposure = clamp(stats.exposure - CONST.EXPOSURE_DECAY, 0, CONST.MAX_EXPOSURE);

    // ── 偶发丑闻 ──
    if (Math.random() < 0.0035) {
      stats.exposure = clamp(stats.exposure + rnd(35, 70), 0, CONST.MAX_EXPOSURE);
    }

    db.prepare('UPDATE players SET stats = ?, resources = ?, tenure = tenure + 1, last_tick = ? WHERE id = ?').run(
      JSON.stringify(stats),
      JSON.stringify(resources),
      tick,
      n.id
    );

    // ── 休致（年资到了或运气） ──
    const retireChance = n.rank_id >= CONTESTED_FROM ? 0.004 : 0.002;
    if (Math.random() < retireChance || n.tenure > 420) {
      db.prepare('UPDATE office_slots SET holder_id = NULL, since = NULL WHERE holder_id = ?').run(n.id);
      db.prepare('UPDATE players SET retired = 1, faction_id = NULL, office_key = NULL WHERE id = ?').run(n.id);
      gazette('global', null, 'retire', `${n.display_name} 以年老乞休，朝廷允之。`);
      result.retired += 1;
      continue;
    }

    // ── 铨选 ──
    if (Math.random() < 0.4) {
      const fresh = db.prepare('SELECT * FROM players WHERE id = ?').get(n.id);
      try {
        const r = attemptPromotion(fresh.id);
        if (r.success) result.promoted += 1;
      } catch {
        /* 资历未足或无缺，静默跳过 */
      }
    }
  }

  // 补员放在最后：先让在任者迁转腾缺，再补新血，避免新进者一入场就把缺占死
  result.recruited = replenishCourt();

  return result;
}

/* ================================================================== *
 * 朝臣反制
 * ================================================================== */

/**
 * 玩家以暗线手段对付朝臣时，权势足够的朝臣会反手一击。
 * 返回一句邸报文案，或 null（未反制）。
 */
export function npcRetaliate(npcRow, playerRow) {
  const npcStats = { ...DEFAULT_STATS, ...parseJSON(npcRow.stats, {}) };
  const pStats = { ...DEFAULT_STATS, ...parseJSON(playerRow.stats, {}) };

  const offense = (npcStats.guile || 0) + (npcStats.network || 0) * 0.5 + (npcStats.favor || 0) * 0.4;
  const defense = (pStats.renown || 0) * 0.6 + (pStats.favor || 0) * 0.6 + 40;
  // 原上限 0.62 意味着每三次暗算就有两次挨反击，叠加暴露度后暗线必崩
  const chance = clamp(0.1 + offense / (offense + defense * 2), 0.06, 0.32);

  if (Math.random() > chance) return null;

  // 削损量随官阶放大，与玩家的收益系数同源
  const y = rankYield(npcRow.rank_id);
  const merit = -Math.round(rnd(8, 18) * y);
  const favor = -Math.round(rnd(3, 8) * y);
  // 暴露度是绝对刻度（0–100），不能跟着官阶放大；但朝臣越显赫，察觉你的人越有分量，
  // 故给一个很缓的增幅。原先 ×(1+官阶×0.06) 在高位一次就加二十多点，暗线扛不住。
  const exposure = Math.round(rnd(4, 9) * (1 + npcRow.rank_id * 0.04));

  applyEffects(playerRow, { merit, favor, exposure });

  const relType = npcRow.rank_id >= 12 ? 'nemesis' : 'rival';
  applyRelation(npcRow.id, playerRow.id, relType, 40);
  applyRelation(playerRow.id, npcRow.id, relType, 30);

  gazette(
    'private',
    playerRow.id,
    'shadow',
    `${npcRow.display_name} 似乎察觉了什么，反手在考成上动了手脚。`
  );

  return `【反制】${npcRow.display_name} 并非易与之辈。你的政绩与圣眷受了暗损，痕迹也多了几分。`;
}

/** 供排行榜等处使用的朝臣数 */
export function npcCount() {
  return db.prepare('SELECT COUNT(*) AS c FROM players WHERE is_npc = 1 AND retired = 0').get().c;
}

/* ================================================================== *
 * 朝臣主动出招
 * ================================================================== */

/** actor 对某人的关系（同向可能有多条，取最强的一条） */
function relationTo(playerId, targetId) {
  return db
    .prepare(
      'SELECT * FROM relations WHERE from_id = ? AND to_id = ? ORDER BY strength DESC LIMIT 1'
    )
    .get(playerId, targetId);
}

/**
 * 按官阶加权挑一名出手的朝臣 —— 官阶越高，越够得着人。
 * 用 prand 而非 Math.random：测试会把 Math.random 固定成常量，
 * 若共用则每次都挑中同一名朝臣，行为变得可预测且无意义。
 */
function pickActor() {
  const npcs = db.prepare('SELECT * FROM players WHERE is_npc = 1 AND retired = 0').all();
  if (!npcs.length) return null;
  const total = npcs.reduce((a, n) => a + n.rank_id + 1, 0);
  let r = prand() * total;
  for (const n of npcs) {
    r -= n.rank_id + 1;
    if (r <= 0) return n;
  }
  return npcs[npcs.length - 1];
}

/**
 * 挑一名玩家下手。
 * 优先挑与这名朝臣已有往来的人 —— 无缘无故的提携与无缘无故的敌意都不成立，
 * 交情与过节才是朝堂上真实的动机。素无往来者，则挑尚无党籍可拉之人。
 */
function pickTarget(actor, humans) {
  const related = humans.filter((h) => relationTo(actor.id, h.id));
  if (related.length) return related[rndInt(0, related.length - 1)];
  const unaligned = humans.filter((h) => !h.faction_id);
  if (unaligned.length) return unaligned[rndInt(0, unaligned.length - 1)];
  return humans[rndInt(0, humans.length - 1)];
}

/** 已有交情者替你说话，已结怨者下黑手 */
const MOVE_BY_REL = {
  patron: 'recommend',
  protege: 'recommend',
  ally: 'recommend',
  confidant: 'recommend',
  rival: 'frame',
  nemesis: 'frame',
};

function chooseMove(actor, target, rel) {
  const doc = doctrineOf(actor);
  // 「手黑」的党派（激进）够得着人时，动手不挑交情 —— 朝堂上没有人是永远的朋友
  const nasty = (doc?.guileMul ?? 1) >= 1.2 && actor.rank_id >= CONTESTED_FROM;

  if (rel && MOVE_BY_REL[rel.type]) {
    // 对盟友也留两成翻脸的可能：否则每人拉拢过一次之后就永远只举荐，
    // 朝局会退化成一片和气，构陷只剩「玩家先动手」这一条来路。
    if (MOVE_BY_REL[rel.type] === 'recommend' && nasty && Math.random() < 0.2) return 'frame';
    return MOVE_BY_REL[rel.type];
  }
  if (nasty) return 'frame';
  if (!target.faction_id && actor.faction_id) return 'recruit';
  return 'recommend';
}

/**
 * 朝臣主动出招 —— 每回合至多一人对一名玩家出手。
 *
 * 反制（npcRetaliate）是被动的：玩家动了朝臣，朝臣才还手。这里补上主动的一面。
 * 没有这一层，朝堂就只是一堆会自行迁转的数据 —— 你不去惹它，它就永远不会来惹你，
 * 也永远不会有人来提携你，「朝中有人」与「朝中有人惦记你」都无从谈起。
 *
 * 三种招法：
 *   举荐 —— 有交情者替你说话，圣眷声望见长，就此结成门生
 *   拉拢 —— 有党籍者招揽无党之人，人脉见长，且给出一条不必自己钻营的入局路径
 *   构陷 —— 结怨者下黑手，削政绩、推高痕迹
 *
 * 频率刻意压低（每回合至多一人，随在朝人数缓慢上升但封顶 0.45）：
 * 一回合一条消息已是打扰，再多就成噪音了。
 */
export function npcSocialTick() {
  const humans = db.prepare('SELECT * FROM players WHERE is_npc = 0 AND retired = 0').all();
  if (!humans.length) return { acted: 0, kind: null };

  const chance = Math.min(0.45, 0.06 + 0.07 * humans.length);
  if (Math.random() > chance) return { acted: 0, kind: null };

  const actor = pickActor();
  if (!actor) return { acted: 0, kind: null };
  const target = pickTarget(actor, humans);
  if (!target) return { acted: 0, kind: null };

  const rel = relationTo(actor.id, target.id);
  const move = chooseMove(actor, target, rel);
  const rank = RANK_BY_ID.get(actor.rank_id);
  const who = `${actor.display_name}（${rank.grade}${rank.title}）`;

  if (move === 'recommend') {
    const gain = amplify({ favor: 12, renown: 6 }, actor.rank_id);
    applyEffects(target, gain);
    // 举荐者也有所得：识人之明同样是声望
    applyEffects(actor, amplify({ renown: 3, network: 2 }, actor.rank_id));
    applyRelation(actor.id, target.id, 'protege', 28);
    applyRelation(target.id, actor.id, 'patron', 28);
    gazette(
      'global',
      null,
      'recommend',
      `${actor.display_name} 于上前盛称 ${target.display_name} 之能，谓其可当大任。`
    );
    gazette(
      'private',
      target.id,
      'recommend',
      `${who}在上官面前为你说了话。圣眷 +${gain.favor}，声望 +${gain.renown}。你自此以门生自居。`
    );
    return { acted: 1, kind: 'recommend', actorId: actor.id, targetId: target.id };
  }

  if (move === 'recruit') {
    const gain = amplify({ network: 10, favor: 4 }, actor.rank_id);
    applyEffects(target, gain);
    applyRelation(actor.id, target.id, 'ally', 24);
    applyRelation(target.id, actor.id, 'ally', 24);
    const hint = target.faction_id ? '' : ' 他所属的党派，你随时可以投效。';
    gazette(
      'private',
      target.id,
      'faction',
      `${who}遣人致意，愿与你结好。人脉 +${gain.network}，圣眷 +${gain.favor}。${hint}`
    );
    return { acted: 1, kind: 'recruit', actorId: actor.id, targetId: target.id };
  }

  // ── 构陷 ──
  const aStats = { ...DEFAULT_STATS, ...parseJSON(actor.stats, {}) };
  const tStats = { ...DEFAULT_STATS, ...parseJSON(target.stats, {}) };
  const offense = (aStats.guile || 0) + (aStats.network || 0) * 0.5;
  const defense = (tStats.renown || 0) * 0.6 + (tStats.favor || 0) * 0.4 + 40;
  if (offense <= defense * rnd(0.7, 1.15)) {
    // 失了手：只在邸报上留下一句语焉不详的风闻，玩家甚至不知道有人在动他
    gazette(
      'global',
      null,
      'rumor',
      '【风闻】近日有匿名揭帖递入通政司，语涉某司官。查无实据，事遂寝。'
    );
    return { acted: 0, kind: 'frame-missed' };
  }

  // 分量刻意轻于反制（npcRetaliate）：反制是玩家自己招惹来的，该重；
  // 主动构陷是朝堂上无端的恶意，该让人难受，但不该把暗线整条路压垮。
  // 实测按反制的分量给，长局中权臣的均阶会掉到循吏之下（600 回合 11.6 vs 11.8），
  // 因为走暗线的人必然与朝臣结怨，于是被反复主动构陷，等于第二重税。
  const hit = amplify({ merit: -12, favor: -6 }, actor.rank_id);
  // 暴露度是绝对刻度（0–100），不随官阶放大 —— 否则高位朝臣一次构陷就能定人生死
  hit.exposure = Math.round(rnd(3, 8));
  applyEffects(target, hit);
  const relType = actor.rank_id >= 12 ? 'nemesis' : 'rival';
  applyRelation(actor.id, target.id, relType, 35);
  applyRelation(target.id, actor.id, relType, 35);
  gazette('global', null, 'rumor', '【风闻】京师近日颇有异动，然查无实据。');
  gazette(
    'private',
    target.id,
    'shadow',
    `${who}在考成簿上做了手脚。政绩 ${hit.merit}，圣眷 ${hit.favor}，痕迹 +${hit.exposure}。`
  );
  return { acted: 1, kind: 'frame', actorId: actor.id, targetId: target.id };
}

export { powerOf, RANKS };
