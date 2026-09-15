/**
 * 核心游戏引擎
 * 负责：玩家生命周期、资源结算、行动执行、铨选晋升、占缺、回合推进、随机事件、弹劾审判
 */

import bcrypt from 'bcryptjs';
import {
  db,
  now,
  currentTick,
  worldSet,
  tx,
} from '../db.js';
import {
  RANKS,
  RANK_BY_ID,
  ORGANS,
  MAX_RANK,
  CONTESTED_FROM,
  DOCTRINES,
  EVENT_TEMPLATES,
  CONST,
  DEFAULT_STATS,
  DEFAULT_RESOURCES,
  CENTRAL_ORGAN_KEYS,
  SLOT_SCALE,
  rankYield,
  silverScale,
  totalSlots,
  organKeysForRank,
} from './data.js';
import { ACTIONS } from './actions.js';
import { seedCourt, npcTick, npcRetaliate, npcSocialTick } from './npc.js';

/* ================================================================== *
 * 工具
 * ================================================================== */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function parseJSON(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export { totalSlots, organKeysForRank, CENTRAL_ORGAN_KEYS };

/** 功绩分：铨选时看的综合资历 */
export function scoreOf(stats) {
  return (
    (stats.merit || 0) +
    (stats.renown || 0) * 0.6 +
    (stats.network || 0) * 0.8 +
    (stats.favor || 0) * 1.2
  );
}

/** 权势值：用于排行榜与派系实力，暗线权重更高但见不得光 */
export function powerOf(p) {
  const s = parseJSON(p.stats, {});
  const r = parseJSON(p.resources, {});
  return Math.round(
    (s.merit || 0) * 1.0 +
      (s.renown || 0) * 0.8 +
      (s.network || 0) * 1.2 +
      (s.favor || 0) * 1.5 +
      (s.guile || 0) * 0.9 +
      (r.silver || 0) / 50 +
      p.rank_id * 120
  );
}

/* ------------------------------------------------------------------ *
 * 官阶放大
 * ------------------------------------------------------------------ */

/** 随官阶放大的「资历」类属性。暴露度与精力是绝对量（0–100 的刻度），不参与放大。 */
const CAREER_KEYS = ['merit', 'renown', 'network', 'favor', 'guile'];

/**
 * 按官阶换算一组增减。
 *
 * @param effects      原始增减
 * @param rankId       该玩家的官阶
 * @param opts.silver  是否按银两口径换算银两（打点的开价用；俸禄类的收入不用）
 *
 * 资历类属性按 rankYield 放大（正负同倍），使「一级官阶的落差」在收益与
 * 代价两端同时成立；银两按 silverScale 换算，使打点在各阶都值几回合俸禄。
 */
export function amplify(effects, rankId, { silver = false } = {}) {
  const y = rankYield(rankId);
  const ss = silver ? silverScale(rankId) : 1;
  const out = {};
  for (const [k, v] of Object.entries(effects || {})) {
    if (!v) continue;
    if (CAREER_KEYS.includes(k)) out[k] = Math.round(v * y);
    else if (k === 'silver') out[k] = Math.round(v * ss);
    else out[k] = v;
  }
  return out;
}

function bumpHistory(row, rankId, note) {
  const history = parseJSON(row.history, []);
  history.push({ tick: currentTick(), rankId, title: RANK_BY_ID.get(rankId)?.title, note, at: now() });
  return history.slice(-60);
}

/* ================================================================== *
 * 占缺表初始化
 * ================================================================== */

export function initOfficeSlots() {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO office_slots (rank_id, organ_key, slot_index, holder_id, since)
     VALUES (?, ?, ?, NULL, NULL)`
  );
  const run = db.transaction(() => {
    for (const rank of RANKS) {
      if (rank.slots === null) continue;
      for (const organKey of organKeysForRank(rank.id)) {
        const n = rank.organ === '*' ? rank.slots : rank.slots;
        for (let i = 1; i <= n; i += 1) insert.run(rank.id, organKey, i);
      }
    }
  });
  run();
}

/**
 * 缺额统计。
 * total 取自占缺表的实际行数而非静态配置 —— 员额会随人口放量，不能再用常量。
 */
export function slotStats(rankId) {
  const rank = RANK_BY_ID.get(rankId);
  if (!rank || rank.slots === null) return { total: null, filled: 0 };
  const total = db
    .prepare('SELECT COUNT(*) AS c FROM office_slots WHERE rank_id = ?')
    .get(rankId).c;
  const filled = db
    .prepare('SELECT COUNT(*) AS c FROM office_slots WHERE rank_id = ? AND holder_id IS NOT NULL')
    .get(rankId).c;
  return { total, filled };
}

/**
 * 按在册真人数放量补建缺额。
 * 只增不减 —— 玩家减少时已有官职不会凭空消失。
 * @returns 新增的缺额数
 */
export function ensureSlots(humanCount) {
  let added = 0;
  for (const [rankIdStr, ratio] of Object.entries(SLOT_SCALE)) {
    const rankId = Number(rankIdStr);
    const rank = RANK_BY_ID.get(rankId);
    const keys = organKeysForRank(rankId);
    const baseTotal = totalSlots(rankId) ?? 1;
    const target = Math.max(baseTotal, Math.ceil(humanCount * ratio));

    const current = db
      .prepare('SELECT COUNT(*) AS c FROM office_slots WHERE rank_id = ?')
      .get(rankId).c;
    for (let i = current; i < target; i += 1) {
      const organKey = keys[i % keys.length];
      const slotIndex = Math.floor(i / keys.length) + 1;
      const res = db
        .prepare(
          `INSERT OR IGNORE INTO office_slots (rank_id, organ_key, slot_index, holder_id, since)
           VALUES (?, ?, ?, NULL, NULL)`
        )
        .run(rankId, organKey, slotIndex);
      added += res.changes;
    }
    void rank;
  }
  return added;
}

function findFreeSlot(rankId, preferOrgan = null) {
  const rows = db
    .prepare('SELECT * FROM office_slots WHERE rank_id = ? AND holder_id IS NULL ORDER BY slot_index')
    .all(rankId);
  if (!rows.length) return null;
  if (preferOrgan) {
    const hit = rows.find((r) => r.organ_key === preferOrgan);
    if (hit) return hit;
  }
  return rows[0];
}

function takeSlot(rankId, organKey, playerId) {
  // 先试指定衙门；该衙门满员则退而求其次，任取本阶尚空的缺。
  // 若只认指定衙门，「六曹各二」这类多衙门官阶会因随机落点重复而空置大量缺额。
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

/**
 * 腾出某人在某一官阶上占的缺。
 *
 * 必须按官阶精确释放，不能用 releaseSlots（那会连刚拿到的新缺一并清掉）。
 * 早先晋升时只占新缺、不腾旧缺，导致同一人同时占着两个缺，
 * 占缺表逐渐被「已升迁者留下的空壳」填满 —— 缺额看着全满，实际无人在任，
 * 晋升通道被彻底堵死。
 */
function releaseSlotAt(playerId, rankId) {
  return db
    .prepare('UPDATE office_slots SET holder_id = NULL, since = NULL WHERE holder_id = ? AND rank_id = ?')
    .run(playerId, rankId).changes;
}

function releaseSlots(playerId) {
  db.prepare('UPDATE office_slots SET holder_id = NULL, since = NULL WHERE holder_id = ?').run(
    playerId
  );
}

/* ================================================================== *
 * 玩家
 * ================================================================== */

export function createPlayer(username, displayName, password) {
  const exists = db.prepare('SELECT id FROM players WHERE username = ?').get(username);
  if (exists) {
    const err = new Error('此名号已被占用');
    err.status = 409;
    throw err;
  }
  const hash = bcrypt.hashSync(password, 10);
  const t = now();
  const info = db
    .prepare(
      `INSERT INTO players
       (username, display_name, password_hash, created_at, last_seen,
        rank_id, office_key, stats, resources, history)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      username,
      displayName,
      hash,
      t,
      t,
      CONST.START_RANK,
      null,
      JSON.stringify(DEFAULT_STATS),
      JSON.stringify(DEFAULT_RESOURCES),
      JSON.stringify([
        {
          tick: currentTick(),
          rankId: CONST.START_RANK,
          title: RANK_BY_ID.get(CONST.START_RANK).title,
          note: '释褐入仕',
          at: t,
        },
      ])
    );
  const id = info.lastInsertRowid;
  gazette('global', null, 'arrival', `${displayName} 释褐入仕，授从九品书办。`, t);
  return getPlayer(id);
}

export function getPlayer(id) {
  return db.prepare('SELECT * FROM players WHERE id = ?').get(id);
}

export function getPlayerByUsername(username) {
  return db.prepare('SELECT * FROM players WHERE username = ?').get(username);
}

export function verifyPassword(row, password) {
  // 朝臣的 password_hash 是占位符 '*'，bcrypt 无法解析，须先行拦截
  if (!row?.password_hash || row.password_hash.length < 20) return false;
  try {
    return bcrypt.compareSync(password, row.password_hash);
  } catch {
    return false;
  }
}

/** 对外可见的档案（隐去权谋值、暴露度等隐秘属性） */
export function publicProfile(row, viewerId = null) {
  if (!row) return null;
  const stats = parseJSON(row.stats, {});
  const rank = RANK_BY_ID.get(row.rank_id);
  const faction = row.faction_id
    ? db.prepare('SELECT id, name, doctrine FROM factions WHERE id = ?').get(row.faction_id)
    : null;
  const rel = viewerId
    ? db
        .prepare(
          'SELECT type, strength FROM relations WHERE from_id = ? AND to_id = ? ORDER BY strength DESC'
        )
        .all(viewerId, row.id)
    : [];
  return {
    id: row.id,
    name: row.display_name,
    rankId: row.rank_id,
    grade: rank.grade,
    title: rank.title,
    organ: row.office_key ? ORGANS[row.office_key]?.name ?? rank.title : rank.title,
    organKey: row.office_key,
    tenure: row.tenure,
    power: powerOf(row),
    renown: Math.round(stats.renown || 0),
    network: Math.round(stats.network || 0),
    faction,
    relations: rel,
    retired: !!row.retired,
    npc: !!row.is_npc,
    online: !row.is_npc && now() - row.last_seen < 90_000,
  };
}

/** 自己的完整档案 */
export function selfProfile(row) {
  const stats = parseJSON(row.stats, {});
  const resources = parseJSON(row.resources, {});
  const rank = RANK_BY_ID.get(row.rank_id);
  const nextRank = row.rank_id < MAX_RANK ? RANK_BY_ID.get(row.rank_id + 1) : null;
  const score = scoreOf(stats);
  const slots = nextRank ? slotStats(nextRank.id) : null;
  const faction = row.faction_id
    ? db.prepare('SELECT * FROM factions WHERE id = ?').get(row.faction_id)
    : null;
  const relations = db
    .prepare(
      `SELECT r.type, r.strength, p.id, p.display_name, p.rank_id
       FROM relations r JOIN players p ON p.id = r.to_id
       WHERE r.from_id = ? ORDER BY r.strength DESC`
    )
    .all(row.id);

  return {
    id: row.id,
    username: row.username,
    name: row.display_name,
    rankId: row.rank_id,
    grade: rank.grade,
    title: rank.title,
    organKey: row.office_key,
    organ: row.office_key ? ORGANS[row.office_key]?.name : ORGANS[rank.organ]?.name ?? '待铨',
    rankNote: rank.note,
    salary: rank.salary,
    mandateMax: rank.mandate,
    tenure: row.tenure,
    stats,
    resources,
    score: Math.round(score),
    power: powerOf(row),
    peak: row.career_peak,
    impeachCount: row.impeach_count,
    faction,
    cooldowns: parseJSON(row.cooldowns, {}),
    history: parseJSON(row.history, []).slice(-20).reverse(),
    nextRank: nextRank
      ? {
          id: nextRank.id,
          grade: nextRank.grade,
          title: nextRank.title,
          cap: nextRank.cap,
          slots: slots.total,
          filled: slots.filled,
          ready: score >= nextRank.cap && row.tenure >= 3,
        }
      : null,
    relations: relations.map((r) => ({
      type: r.type,
      strength: r.strength,
      id: r.id,
      name: r.display_name,
      title: RANK_BY_ID.get(r.rank_id)?.title,
    })),
    doctrine: faction ? DOCTRINES[faction.doctrine] : null,
    // 家族势力与心腹：两者都是「风险敞口」，不只是收藏品
    familyPower: familyPowerOf(row.id),
    kinCount: kinOf(row.id).filter((k) => !k.retired).length,
    // 姻亲要两个方向都列出来 —— 上面 relations 只查 from_id = 自己，
    // 对方结过来的那门亲不会出现在那里，只看 relations 会漏掉一半姻亲
    kin: kinOf(row.id)
      .filter((k) => !k.retired)
      .map((k) => ({
        id: k.id,
        name: k.display_name,
        title: RANK_BY_ID.get(k.rank_id)?.title,
        strength: k.strength,
      })),
    retinue: retinueOf(row.id)
      .filter((r) => !r.retired)
      .map((r) => ({
        id: r.id,
        name: r.display_name,
        title: RANK_BY_ID.get(r.rank_id)?.title,
        strength: r.strength,
        // 交情到了才肯替你担事 —— 把这条规则摆到台面上，玩家才知道该经营到什么程度
        willing: r.strength >= CONST.CONFIDANT_TRUST,
      })),
  };
}

export function touch(playerId) {
  db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').run(now(), playerId);
}

/* ================================================================== *
 * 邸报
 * ================================================================== */

export function gazette(scope, playerId, kind, text, at = now()) {
  db.prepare(
    'INSERT INTO gazette (scope, player_id, kind, text, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(scope, playerId, kind, text, at);
}

export function recentGazette(limit = 60, playerId = null) {
  return db
    .prepare(
      `SELECT id, scope, player_id, kind, text, created_at
       FROM gazette
       WHERE scope = 'global' OR (scope = 'private' AND player_id = ?)
       ORDER BY id DESC LIMIT ?`
    )
    .all(playerId, limit);
}

/* ================================================================== *
 * 效果结算
 * ================================================================== */

export function applyEffects(row, effects = {}, multiplier = 1) {
  // 重新读取最新行。调用方手上的 row 可能是一次事务早先取的快照，
  // 若拿它做「读—改—写」，会把中途别的结算静默覆盖掉。
  // 实测踩过：心腹代行刚把痕迹写到心腹账上，紧接着的 targetEffects
  // 用旧快照回写，又把它抹回了原值 —— 代行看上去生效了，实则没有。
  const fresh = row?.id ? db.prepare('SELECT * FROM players WHERE id = ?').get(row.id) ?? row : row;
  const stats = { ...DEFAULT_STATS, ...parseJSON(fresh.stats, {}) };
  const resources = { ...DEFAULT_RESOURCES, ...parseJSON(fresh.resources, {}) };
  const rank = RANK_BY_ID.get(fresh.rank_id);
  const applied = {};

  for (const [k, rawV] of Object.entries(effects)) {
    const v = Math.round(rawV * multiplier);
    if (!v) continue;
    if (k in stats) {
      stats[k] = Math.max(0, stats[k] + v);
      if (k === 'exposure') stats[k] = clamp(stats[k], 0, CONST.MAX_EXPOSURE);
      if (k === 'health') stats[k] = clamp(stats[k], 0, 100);
      applied[k] = v;
    } else if (k in resources) {
      resources[k] = Math.max(0, resources[k] + v);
      if (k === 'mandate') resources[k] = clamp(resources[k], 0, rank.mandate);
      applied[k] = v;
    }
  }

  db.prepare('UPDATE players SET stats = ?, resources = ? WHERE id = ?').run(
    JSON.stringify(stats),
    JSON.stringify(resources),
    row.id
  );

  return { stats, resources, applied };
}

function relationTo(playerId, targetId, type) {
  return db
    .prepare('SELECT * FROM relations WHERE from_id = ? AND to_id = ? AND type = ?')
    .get(playerId, targetId, type);
}

/* ================================================================== *
 * 心腹与家族
 * ================================================================== */

/** 某人的心腹：他托付隐秘之事的人 */
export function retinueOf(playerId) {
  return db
    .prepare(
      `SELECT r.strength, p.id, p.display_name, p.rank_id, p.retired
       FROM relations r JOIN players p ON p.id = r.to_id
       WHERE r.from_id = ? AND r.type = 'confidant'
       ORDER BY r.strength DESC`
    )
    .all(playerId);
}

/** 某人的姻亲：两个方向都算 —— 亲家是相互的 */
export function kinOf(playerId) {
  return db
    .prepare(
      `SELECT r.strength, r.from_id, r.to_id, p.id, p.display_name, p.rank_id, p.retired
       FROM relations r JOIN players p
         ON p.id = CASE WHEN r.from_id = ? THEN r.to_id ELSE r.from_id END
       WHERE r.type = 'kin' AND (r.from_id = ? OR r.to_id = ?)`
    )
    .all(playerId, playerId, playerId);
}

/**
 * 家族势力：姻亲一族的权势之和。
 * 一荣俱荣 —— 结一门好亲，等于平白多出几分底气；结错了，就是拖累。
 */
export function familyPowerOf(playerId) {
  const kin = kinOf(playerId).filter((k) => !k.retired);
  const total = kin.reduce((a, k) => a + powerOf(getPlayer(k.id)), 0);
  return Math.min(Math.round(total), CONST.KIN_POWER_CAP);
}

/**
 * 心腹代行：暗线的痕迹，由心腹按交情深浅分摊。
 *
 * 这是心腹最实际的用处 —— 你手上干净，脏活有人干。
 * 但心腹不是替罪羊：单次最多担走 CONFIDANT_SHARE，且交情不到
 * CONFIDANT_TRUST 的人根本不肯接；硬要托付，他还可能反口告发。
 *
 * 返回 { self, absorbed, by, betrayed }：本人自留的痕迹、被分担的总量、
 * 分担者名单、以及是否有人反口。
 */
function absorbExposure(ownerId, amount) {
  if (!amount || amount <= 0) return { self: amount, absorbed: 0, by: [], betrayed: null };
  const edges = db
    .prepare(
      `SELECT r.strength, p.* FROM relations r JOIN players p ON p.id = r.to_id
       WHERE r.from_id = ? AND r.type = 'confidant' AND p.retired = 0
       ORDER BY r.strength DESC LIMIT 3`
    )
    .all(ownerId);
  if (!edges.length) return { self: amount, absorbed: 0, by: [], betrayed: null };

  let pool = Math.round(amount * CONST.CONFIDANT_SHARE);
  const by = [];
  let absorbed = 0;
  let betrayed = null;

  for (const e of edges) {
    if (pool <= 0) break;

    // 交情不到，他不肯替你担 —— 硬托付就是把人往对面推
    if (e.strength < CONST.CONFIDANT_TRUST) {
      if (Math.random() < CONST.CONFIDANT_BETRAY) {
        applyRelation(ownerId, e.id, 'confidant', -100);
        applyRelation(ownerId, e.id, 'nemesis', 45);
        applyEffects(e, { exposure: Math.round(amount * 0.5) });
        betrayed = { id: e.id, name: e.display_name };
        break;
      }
      continue;
    }

    const take = Math.min(pool, Math.max(1, Math.round(amount * CONST.CONFIDANT_SHARE * (e.strength / 100))));
    applyEffects(e, { exposure: take });
    absorbed += take;
    pool -= take;
    by.push({ id: e.id, name: e.display_name, took: take });
  }

  return { self: Math.max(0, amount - absorbed), absorbed, by, betrayed };
}

export function applyRelation(fromId, toId, type, delta) {
  if (fromId === toId) return;
  const existing = relationTo(fromId, toId, type);
  const t = now();
  if (existing) {
    const strength = clamp(existing.strength + delta, 0, 100);
    db.prepare('UPDATE relations SET strength = ?, updated_at = ? WHERE id = ?').run(
      strength,
      t,
      existing.id
    );
    if (strength === 0) db.prepare('DELETE FROM relations WHERE id = ?').run(existing.id);
  } else if (delta > 0) {
    db.prepare(
      'INSERT INTO relations (from_id, to_id, type, strength, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(fromId, toId, type, clamp(delta, 0, 100), t, t);
  }
}

/* ================================================================== *
 * 行动执行
 * ================================================================== */

export function performAction(playerId, actionKey, targetId = null) {
  const action = ACTIONS[actionKey];
  if (!action) {
    const e = new Error('并无此令');
    e.status = 400;
    throw e;
  }

  return tx(() => {
    const row = getPlayer(playerId);
    if (!row || row.retired) {
      const e = new Error('你已不在朝中');
      e.status = 403;
      throw e;
    }

    const tick = currentTick();
    const cooldowns = parseJSON(row.cooldowns, {});
    if (cooldowns[actionKey] && cooldowns[actionKey] > tick) {
      const e = new Error(`此事尚需静候，第 ${cooldowns[actionKey]} 回合后可再行`);
      e.status = 429;
      throw e;
    }

    const stats = { ...DEFAULT_STATS, ...parseJSON(row.stats, {}) };
    const resources = { ...DEFAULT_RESOURCES, ...parseJSON(row.resources, {}) };

    // 成本：银两按官阶口径换算，政令点不换算（每回合恢复量本就随官阶增长）。
    // 校验与扣减共用同一份数额，避免「验得起、扣不起」。
    const rawCosts = {};
    for (const [k, v] of Object.entries(action.cost || {})) rawCosts[k] = -v;
    const costEffects = amplify(rawCosts, row.rank_id, { silver: true });

    for (const [k, v] of Object.entries(costEffects)) {
      const need = -v;
      const have = k === 'silver' || k === 'mandate' ? resources[k] : stats[k];
      if ((have || 0) < need) {
        const e = new Error(`资力不足：尚缺 ${k} ${need - (have || 0)}`);
        e.status = 400;
        throw e;
      }
    }

    const target = targetId ? getPlayer(targetId) : null;

    // 交给行动的对象必须是「已解析」的形态。
    // ctx.target 若直接给数据库原始行，ctx.target.stats 仍是 JSON 字符串，
    // 取 .renown 会得到 undefined，比较式静默变成 NaN ——
    // 密谋的成败判定因此恒为 false，暗线的旗舰动作从未成功过一次。
    const targetView = target
      ? {
          ...target,
          stats: { ...DEFAULT_STATS, ...parseJSON(target.stats, {}) },
          resources: { ...DEFAULT_RESOURCES, ...parseJSON(target.resources, {}) },
        }
      : null;

    const ctx = {
      player: row,
      rankId: row.rank_id,
      stats,
      resources,
      target: targetView,
      targetName: targetView?.display_name,
      relationTo: (tid, type) => relationTo(playerId, tid, type),
      patron: db
        .prepare(
          `SELECT p.* FROM relations r JOIN players p ON p.id = r.to_id
           WHERE r.from_id = ? AND r.type = 'patron' ORDER BY r.strength DESC LIMIT 1`
        )
        .get(playerId),
    };

    if (action.require) {
      const err = action.require(ctx);
      if (err) {
        const e = new Error(err);
        e.status = 400;
        throw e;
      }
    }

    // 扣成本：数额已在成本校验处换算完毕（costEffects）

    // 派系倾向修正
    const faction = row.faction_id
      ? db.prepare('SELECT * FROM factions WHERE id = ?').get(row.faction_id)
      : null;
    const doctrine = faction ? DOCTRINES[faction.doctrine] : null;
    let mul = 1;
    if (doctrine) {
      if (action.path === 'open') mul *= doctrine.meritMul;
      if (action.path === 'shadow') mul *= doctrine.guileMul;
    }

    const out = action.resolve(ctx) || {};
    // 收益随官阶放大。银两收入不换算 —— 俸禄与钱粮调拨本就随官阶增长，再乘一次会双重放大。
    const effects = amplify(out.effects || {}, row.rank_id);

    // 声望/暴露的派系修正
    if (doctrine) {
      if (effects.renown) effects.renown *= doctrine.renownMul;
      if (effects.exposure) effects.exposure *= doctrine.exposureMul;
    }

    // 心腹代行：痕迹由心腹分担一部分。放在派系修正之后 ——
    // 修正的是「这件事留下多少痕迹」，分摊的是「这些痕迹记在谁头上」。
    let confidant = null;
    if (action.path === 'shadow' && effects.exposure > 0) {
      confidant = absorbExposure(playerId, Math.round(effects.exposure));
      effects.exposure = confidant.self;
    }

    const before = { ...stats, ...resources };
    const merged = { ...costEffects };
    for (const [k, v] of Object.entries(effects)) merged[k] = (merged[k] || 0) + v;

    const { stats: newStats } = applyEffects(row, merged, mul);

    if (out.targetEffects && target) {
      // 下手者的官阶决定这一刀有多重：首辅要收拾一个书办，不必用同样的力道
      applyEffects(target, amplify(out.targetEffects, row.rank_id), 1);
    }
    for (const r of out.relations || []) {
      applyRelation(playerId, r.to, r.type, r.delta);
    }

    // 朝臣反制：以暗线手段对付朝廷旧人，对方未必肯吃这个亏
    let retaliation = null;
    if (target && target.is_npc && action.path === 'shadow') {
      const freshTarget = getPlayer(target.id);
      const freshSelf = getPlayer(playerId);
      if (freshTarget && !freshTarget.retired) {
        retaliation = npcRetaliate(freshTarget, freshSelf);
      }
    }

    // 冷却
    if (action.cooldown) cooldowns[actionKey] = tick + action.cooldown;
    db.prepare('UPDATE players SET cooldowns = ? WHERE id = ?').run(JSON.stringify(cooldowns), playerId);

    // 日志
    db.prepare(
      'INSERT INTO action_log (player_id, action_key, target_id, ok, detail, created_at) VALUES (?, ?, ?, 1, ?, ?)'
    ).run(
      playerId,
      actionKey,
      targetId,
      JSON.stringify({ effects: merged, logs: out.logs || [] }),
      now()
    );

    // 邸报
    const isShadow = action.path === 'shadow';
    for (const line of out.logs || []) {
      if (isShadow) {
        gazette('private', playerId, 'shadow', line);
      } else if (action.path === 'open' || action.path === 'social') {
        gazette('private', playerId, 'info', line);
      }
    }
    if (isShadow) {
      gazette('global', null, 'rumor', '【风闻】京师近日颇有异动，然查无实据。');
    }

    // 心腹代行的交代：分担了多少、谁担的、有没有人反口 —— 玩家必须看得见
    if (confidant?.betrayed) {
      const line = `${confidant.betrayed.name} 不肯替你担这件事，反口把你捅了出去。`;
      (out.logs ||= []).push(line);
      gazette('private', playerId, 'shadow', line);
    } else if (confidant?.absorbed > 0) {
      const names = confidant.by.map((b) => b.name).join('、');
      const line = `${names} 替你担下了 ${confidant.absorbed} 分痕迹。`;
      (out.logs ||= []).push(line);
      gazette('private', playerId, 'shadow', line);
    }

    if (retaliation) {
      (out.logs ||= []).push(retaliation);
    }

    const result = {
      logs: out.logs || [],
      effects: merged,
      stats: newStats,
      profile: selfProfile(getPlayer(playerId)),
      reset: !!out.reset,
      retaliation: !!retaliation,
    };

    if (out.reset) {
      releaseSlots(playerId);
      db.prepare(
        `UPDATE players SET rank_id = ?, office_key = NULL, faction_id = NULL,
         stats = ?, resources = ?, tenure = 0, retired = 0, career_peak = ?,
         history = ? WHERE id = ?`
      ).run(
        CONST.START_RANK,
        JSON.stringify(DEFAULT_STATS),
        JSON.stringify(DEFAULT_RESOURCES),
        row.career_peak,
        JSON.stringify(bumpHistory(getPlayer(playerId), CONST.START_RANK, '致仕归里，重头再来')),
        playerId
      );
      result.profile = selfProfile(getPlayer(playerId));
    }

    // 暴露度越线则按概率触发弹劾
    const after = getPlayer(playerId);
    const afterStats = parseJSON(after.stats, {});
    if (Math.random() < impeachRisk(afterStats.exposure)) {
      result.impeachment = impeach(after);
      result.profile = selfProfile(getPlayer(playerId));
    }

    void before;
    return result;
  });
}

/* ================================================================== *
 * 铨选晋升
 * ================================================================== */

export function promotionReadiness(row) {
  if (row.rank_id >= MAX_RANK) return { ready: false, reason: '已位极人臣，无可复加。' };
  const stats = parseJSON(row.stats, {});
  const next = RANK_BY_ID.get(row.rank_id + 1);
  const score = scoreOf(stats);
  if (row.tenure < 3) return { ready: false, reason: `在任未满三回合（今 ${row.tenure}），资历尚浅。` };
  if (score < next.cap)
    return {
      ready: false,
      reason: `功绩未足：今 ${Math.round(score)} / 需 ${next.cap}`,
      score,
      cap: next.cap,
    };

  const slots = slotStats(next.id);
  if (slots.total !== null && slots.filled >= slots.total) {
    // 缺满时，真人可挤走占着位置的朝廷旧人（朝臣之间不互相挤）
    const evictable = db
      .prepare(
        `SELECT COUNT(*) AS c FROM office_slots s JOIN players p ON p.id = s.holder_id
         WHERE s.rank_id = ? AND p.is_npc = 1`
      )
      .get(next.id).c;
    if (!row.is_npc && evictable > 0) {
      return { ready: true, score, cap: next.cap, next, evict: true };
    }
    return {
      ready: false,
      reason: `${next.title}已无缺可补，须待有人去位。`,
      score,
      cap: next.cap,
    };
  }
  return { ready: true, score, cap: next.cap, next };
}

/** 该阶上权势最弱的朝臣 —— 供真人挤缺时挑软柿子 */
function weakestNpcAt(rankId) {
  const holders = db
    .prepare(
      `SELECT p.* FROM office_slots s JOIN players p ON p.id = s.holder_id
       WHERE s.rank_id = ? AND p.is_npc = 1`
    )
    .all(rankId);
  if (!holders.length) return null;
  return holders.reduce((a, b) => (powerOf(b) < powerOf(a) ? b : a));
}

/** 令一名朝臣去位，腾出其所占缺额 */
function retireNpc(npcRow, note) {
  releaseSlots(npcRow.id);
  db.prepare('UPDATE players SET retired = 1, faction_id = NULL, office_key = NULL WHERE id = ?').run(
    npcRow.id
  );
  gazette('global', null, 'retire', `${npcRow.display_name} 去位。${note}`);
}

export function attemptPromotion(playerId) {
  return tx(() => {
    const row = getPlayer(playerId);
    if (!row || row.retired) {
      const e = new Error('你已不在朝中');
      e.status = 403;
      throw e;
    }
    const check = promotionReadiness(row);
    if (!check.ready) {
      const e = new Error(check.reason);
      e.status = 400;
      throw e;
    }

    const stats = { ...DEFAULT_STATS, ...parseJSON(row.stats, {}) };
    const next = check.next;
    const score = check.score;

    // 成功率：功绩越足、圣眷越高，越稳
    let p = 0.35 + ((score - next.cap) / Math.max(next.cap, 1)) * 0.55 + (stats.favor || 0) / 400;
    p += (stats.renown || 0) / 900;
    // 痕迹对升迁的拖累只作轻微修正。原为 exposure/500 —— 暴露度常年五十上下，
    // 等于每级扣掉一成成功率，恰好吃掉暗线多出来的那点收益，暗线因此必亏。
    // 暴露度的主要代价应当是「被弹劾」，不该在这里再征一道。
    p -= (stats.exposure || 0) / 1400;
    p = clamp(p, 0.05, 0.95);

    const success = Math.random() < p;

    if (!success) {
      // 铨选落空，资历小损（按官阶换算，否则高位者毫发无伤）
      applyEffects(row, amplify({ favor: -4, renown: -3 }, row.rank_id));
      gazette(
        'global',
        null,
        'rumor',
        `${row.display_name} 铨选 ${next.title} 未果，仍留原任。`
      );
      db.prepare(
        'INSERT INTO action_log (player_id, action_key, ok, detail, created_at) VALUES (?, ?, 0, ?, ?)'
      ).run(playerId, 'promote', JSON.stringify({ next: next.id, p }), now());
      return {
        success: false,
        message: `部议已上，然圣意未允。你仍居原职，只是名字已经在名单上了。`,
        profile: selfProfile(getPlayer(playerId)),
      };
    }

    // 占缺：先取新缺，再腾旧缺 —— 取不到则原职不动，不会两头落空
    const candidates = organKeysForRank(next.id);
    let organKey;
    if (next.slots !== null) {
      const prefer =
        candidates.length > 1
          ? candidates[Math.floor(Math.random() * candidates.length)]
          : candidates[0];
      let slot = takeSlot(next.id, prefer, playerId);
      if (!slot) {
        // 缺满：真人可令该阶最昏聩的朝臣让贤。否则晋升通道会被永久堵死。
        const victim = weakestNpcAt(next.id);
        if (victim) {
          retireNpc(victim, `后进 ${row.display_name} 补 ${next.grade}${next.title}。`);
          slot = takeSlot(next.id, prefer, playerId);
        }
      }
      if (!slot) {
        const e = new Error('缺已被人占去，请稍后再试。');
        e.status = 409;
        throw e;
      }
      organKey = slot.organ_key;
    } else {
      organKey = candidates[Math.floor(Math.random() * candidates.length)];
    }
    releaseSlotAt(playerId, row.rank_id);

    // 消耗资历
    const consume = 0.65;
    const deltas = {
      merit: -Math.round((stats.merit || 0) * consume),
      renown: -Math.round((stats.renown || 0) * consume * 0.7),
      network: -Math.round((stats.network || 0) * consume * 0.4),
      favor: -Math.round((stats.favor || 0) * consume * 0.35),
    };
    applyEffects(row, deltas);

    const peak = Math.max(row.career_peak, next.id);
    db.prepare(
      `UPDATE players SET rank_id = ?, office_key = ?, tenure = 0, career_peak = ?, history = ?
       WHERE id = ?`
    ).run(
      next.id,
      organKey,
      peak,
      JSON.stringify(bumpHistory(row, next.id, `迁 ${next.grade}${next.title}`)),
      playerId
    );

    gazette(
      'global',
      null,
      'promotion',
      `制曰：${row.display_name} 擢 ${next.grade}${next.title}，${ORGANS[organKey]?.name ?? ''}行走。`
    );
    db.prepare(
      'INSERT INTO action_log (player_id, action_key, ok, detail, created_at) VALUES (?, ?, 1, ?, ?)'
    ).run(playerId, 'promote', JSON.stringify({ next: next.id, p }), now());

    return {
      success: true,
      message: `制书下，你迁 ${next.grade}${next.title}。${next.note}`,
      profile: selfProfile(getPlayer(playerId)),
    };
  });
}

/* ================================================================== *
 * 弹劾审判
 * ================================================================== */

/**
 * 本回合是否被台谏盯上。
 *
 * 越过警戒线之后，风险随暴露度线性上升，而非到点即发 ——
 * 硬阈值会让「差一点」与「刚好越线」判若云泥，玩家无从判断该收手到何种程度。
 */
export function impeachRisk(exposure) {
  const over = (exposure || 0) - CONST.IMPEACH_WARN;
  if (over <= 0) return 0;
  const span = CONST.MAX_EXPOSURE - CONST.IMPEACH_WARN;
  return Math.min(1, over / span) * CONST.IMPEACH_RATE;
}

export function impeach(row) {
  const stats = { ...DEFAULT_STATS, ...parseJSON(row.stats, {}) };
  // 圣眷的「高低」必须相对官阶来量：高位者圣眷动辄上千，若直接代入原式，
  // 弹劾必活，暗线在高阶就成了无风险套利。以 70×官阶系数 为标尺换算。
  // 上限压到 0.8 —— 圣眷再厚也压不死台谏，风波终归有掀翻人的时候。
  const scale = 70 * rankYield(row.rank_id);
  const survive = Math.random() < clamp((stats.favor || 0) / ((stats.favor || 0) + scale) + 0.18, 0.12, 0.8);
  const rank = RANK_BY_ID.get(row.rank_id);

  if (survive) {
    // 圣眷与清名按官阶换算，暴露度是绝对刻度（-55 已足够把红线压回安全区）
    applyEffects(row, { exposure: -55, ...amplify({ favor: -35, renown: -10 }, row.rank_id) });
    gazette(
      'global',
      null,
      'impeach',
      `台谏交章论 ${row.display_name}，上命「留中再议」。风波暂息。`
    );
    return { survived: true, message: '弹章盈尺，然圣眷未衰。你安然过关，只是元气大伤。' };
  }

  // 落马只降 1 级。早先「从六品以上降 2 级」看似更有威慑，实测却把暗线打成了
  // 「弹劾循环」：高位每升一级要十余回合，一次落马两级的坑填不回来，
  // 长局中权臣的均阶反而低于循吏（600 回合 11.6 vs 11.9，80% 被弹劾过）。
  // 降 1 级既保留了「一朝翻船、前功尽弃」的分量，又让暗线爬得快这件事真正兑现。
  const drop = 1;
  const newRank = Math.max(0, row.rank_id - drop);
  releaseSlots(row.id);
  db.prepare(
    `UPDATE players SET rank_id = ?, office_key = NULL, impeach_count = impeach_count + 1,
     stats = ?, history = ? WHERE id = ?`
  ).run(
    newRank,
    JSON.stringify({ ...stats, exposure: 45, favor: Math.round((stats.favor || 0) * 0.4) }),
    JSON.stringify(bumpHistory(row, newRank, '坐事镌级')),
    row.id
  );
  gazette(
    'global',
    null,
    'impeach',
    `制曰：${row.display_name} 坐事镌级，降 ${RANK_BY_ID.get(newRank).grade}${RANK_BY_ID.get(newRank).title}。`
  );

  /* ── 连坐 ──
   * 一个人倒下，倒下的从来不只是他自己。这是「家族利益链」与「心腹体系」
   * 真正的分量所在：关系不是收藏品，是风险敞口。
   */
  const implicated = { kin: 0, patrons: 0 };

  // 姻亲：两姓之好，实为两势之合，故休戚与共
  for (const k of kinOf(row.id)) {
    if (k.retired || k.id === row.id) continue;
    const kinRow = getPlayer(k.id);
    if (!kinRow || kinRow.retired) continue;
    applyEffects(kinRow, amplify({ favor: -14, renown: -6 }, kinRow.rank_id));
    applyRelation(row.id, k.id, 'kin', -10);
    gazette(
      'private',
      k.id,
      'impeach',
      `${row.display_name} 坐事镌级。两家休戚相关，你亦受牵连。`
    );
    implicated.kin += 1;
  }

  // 心腹：他替你办过的事，此刻都记回到你头上
  const patrons = db
    .prepare(
      `SELECT r.from_id AS id, p.display_name FROM relations r JOIN players p ON p.id = r.from_id
       WHERE r.to_id = ? AND r.type = 'confidant' AND p.retired = 0`
    )
    .all(row.id);
  for (const p of patrons) {
    const ownerRow = getPlayer(p.id);
    if (!ownerRow) continue;
    const bite = amplify(
      { favor: -Math.round(10 * CONST.CONFIDANT_IMPLICATION), network: -Math.round(8 * CONST.CONFIDANT_IMPLICATION) },
      ownerRow.rank_id
    );
    applyEffects(ownerRow, bite);
    gazette(
      'private',
      p.id,
      'shadow',
      `${row.display_name} 是你的人，他这一倒，你的圣眷与人脉也跟着损了。`
    );
    implicated.patrons += 1;
  }

  if (implicated.kin || implicated.patrons) {
    gazette(
      'global',
      null,
      'impeach',
      `${row.display_name} 既败，姻党与门下皆受波及，朝中一时人人自危。`
    );
  }

  void rank;
  return {
    survived: false,
    implicated,
    message: `弹章入，上震怒。你从 ${rank.grade}${rank.title} 上被拽了下来。`,
  };
}

/* ================================================================== *
 * 派系
 * ================================================================== */

export function createFaction(playerId, name, doctrine) {
  return tx(() => {
    const row = getPlayer(playerId);
    const stats = parseJSON(row.stats, {});
    if (row.faction_id) {
      const e = new Error('你已在党中，不可另立山头。');
      e.status = 400;
      throw e;
    }
    if ((stats.network || 0) < 40) {
      const e = new Error('人脉不足四十，无人肯附，此党立不起来。');
      e.status = 400;
      throw e;
    }
    const res = parseJSON(row.resources, {});
    if ((res.silver || 0) < 300) {
      const e = new Error('立党须银三百两，以结众心。');
      e.status = 400;
      throw e;
    }
    if (!DOCTRINES[doctrine]) {
      const e = new Error('宗旨不明。');
      e.status = 400;
      throw e;
    }
    const dup = db.prepare('SELECT id FROM factions WHERE name = ?').get(name);
    if (dup) {
      const e = new Error('此党名已有人用。');
      e.status = 409;
      throw e;
    }
    const t = now();
    const info = db
      .prepare(
        'INSERT INTO factions (name, doctrine, leader_id, treasury, power, motto, created_at) VALUES (?, ?, ?, 0, 0, ?, ?)'
      )
      .run(name, doctrine, playerId, DOCTRINES[doctrine].desc, t);
    applyEffects(row, { silver: -300, influence: 10 });
    db.prepare('UPDATE players SET faction_id = ? WHERE id = ?').run(info.lastInsertRowid, playerId);
    gazette('global', null, 'faction', `${row.display_name} 立「${name}」一党，宗旨${DOCTRINES[doctrine].name}。`);
    return getFaction(info.lastInsertRowid);
  });
}

export function getFaction(id) {
  const f = db.prepare('SELECT * FROM factions WHERE id = ?').get(id);
  if (!f) return null;
  const members = db
    .prepare('SELECT id, display_name, rank_id FROM players WHERE faction_id = ? ORDER BY rank_id DESC')
    .all(id);
  return {
    ...f,
    doctrineMeta: DOCTRINES[f.doctrine],
    members: members.map((m) => ({
      id: m.id,
      name: m.display_name,
      rankId: m.rank_id,
      title: RANK_BY_ID.get(m.rank_id)?.title,
    })),
    power: members.reduce((acc, m) => acc + powerOf(getPlayer(m.id)), 0),
  };
}

export function listFactions() {
  const rows = db.prepare('SELECT id FROM factions ORDER BY id').all();
  return rows.map((r) => getFaction(r.id)).sort((a, b) => b.power - a.power);
}

export function joinFaction(playerId, factionId) {
  return tx(() => {
    const row = getPlayer(playerId);
    if (row.faction_id) {
      const e = new Error('你已入党中，先去位再言其他。');
      e.status = 400;
      throw e;
    }
    const f = db.prepare('SELECT * FROM factions WHERE id = ?').get(factionId);
    if (!f) {
      const e = new Error('并无此党。');
      e.status = 404;
      throw e;
    }
    db.prepare('UPDATE players SET faction_id = ? WHERE id = ?').run(factionId, playerId);
    applyEffects(row, { network: 8, exposure: 6 });
    gazette('global', null, 'faction', `${row.display_name} 入「${f.name}」。`);
    return getFaction(factionId);
  });
}

export function leaveFaction(playerId) {
  return tx(() => {
    const row = getPlayer(playerId);
    if (!row.faction_id) {
      const e = new Error('你本不在党中。');
      e.status = 400;
      throw e;
    }
    const f = db.prepare('SELECT * FROM factions WHERE id = ?').get(row.faction_id);
    if (f && f.leader_id === playerId) {
      const e = new Error('你是党魁。欲散此党，须先传位于人，或径行「散党」。');
      e.status = 400;
      throw e;
    }
    db.prepare('UPDATE players SET faction_id = NULL WHERE id = ?').run(playerId);
    applyEffects(row, { network: -12, renown: -8 });
    gazette('global', null, 'faction', `${row.display_name} 退出「${f?.name ?? '旧党'}」。`);
    return true;
  });
}

export function donateFaction(playerId, amount) {
  return tx(() => {
    const row = getPlayer(playerId);
    if (!row.faction_id) {
      const e = new Error('你不在党中。');
      e.status = 400;
      throw e;
    }
    const res = parseJSON(row.resources, {});
    const amt = Math.max(0, Math.floor(amount));
    if ((res.silver || 0) < amt) {
      const e = new Error('银两不足。');
      e.status = 400;
      throw e;
    }
    applyEffects(row, { silver: -amt, influence: Math.round(amt / 60) });
    db.prepare('UPDATE factions SET treasury = treasury + ? WHERE id = ?').run(amt, row.faction_id);
    gazette('global', null, 'faction', `${row.display_name} 输金 ${amt} 两入党库。`);
    return getFaction(row.faction_id);
  });
}

/* ================================================================== *
 * 回合推进
 * ================================================================== */

export function runTick() {
  const tick = tx(() => {
    const t = currentTick() + 1;
    worldSet('tick', t);
    return t;
  });

  // 按在册真人数放量补缺，避免少数缺额把整个晋升通道堵死
  const humans = db
    .prepare('SELECT COUNT(*) AS c FROM players WHERE retired = 0 AND is_npc = 0')
    .get().c;
  ensureSlots(humans);

  const players = db.prepare('SELECT * FROM players WHERE retired = 0 AND is_npc = 0').all();

  for (const p of players) {
    const rank = RANK_BY_ID.get(p.rank_id);
    const stats = { ...DEFAULT_STATS, ...parseJSON(p.stats, {}) };
    const resources = { ...DEFAULT_RESOURCES, ...parseJSON(p.resources, {}) };

    resources.silver += rank.salary;
    resources.mandate = rank.mandate;
    stats.health = clamp(stats.health + CONST.HEALTH_REGEN, 0, 100);
    stats.exposure = clamp(stats.exposure - CONST.EXPOSURE_DECAY, 0, CONST.MAX_EXPOSURE);

    // 暴露度不只是弹劾的引信，也是持续付出的代价：
    // 风评一坏，上头的信任会一点点流失。否则只要勤于消弭痕迹，
    // 暗线就成了「多一个动作、零成本」的套利，人人都会走。
    const erosion = Math.round(stats.exposure * CONST.EXPOSURE_EROSION * rankYield(p.rank_id));
    if (erosion) stats.favor = Math.max(0, stats.favor - erosion);

    db.prepare(
      'UPDATE players SET stats = ?, resources = ?, tenure = tenure + 1, last_tick = ? WHERE id = ?'
    ).run(JSON.stringify(stats), JSON.stringify(resources), tick, p.id);

    // 随机事件
    if (Math.random() < 0.1 && stats.health > 20) {
      spawnEvent(p);
    }
  }

  // 久不视事者，令其致仕，以空其缺（朝臣另由 npcTick 处置，不在此列）
  const idle = db
    .prepare(
      'SELECT * FROM players WHERE retired = 0 AND is_npc = 0 AND rank_id >= ? AND last_seen < ?'
    )
    .all(CONTESTED_FROM, now() - 1000 * 60 * 60 * 24 * 3);
  for (const p of idle) {
    releaseSlots(p.id);
    db.prepare('UPDATE players SET retired = 1, faction_id = NULL, office_key = NULL WHERE id = ?').run(p.id);
    gazette('global', null, 'retire', `${p.display_name} 久不视事，奉旨休致。`);
  }

  // 朝臣行止
  const npcResult = npcTick(tick);

  // 朝臣主动出招（举荐 / 拉拢 / 构陷）—— 放在 npcTick 之后，
  // 让当回合刚迁转、刚补员的新面孔也能在下回合进入可出手的池子，而不必等到下一轮
  const social = npcSocialTick(tick);

  // 派系权势
  for (const f of db.prepare('SELECT id FROM factions').all()) {
    const members = db.prepare('SELECT * FROM players WHERE faction_id = ?').all(f.id);
    const power = members.reduce((a, m) => a + powerOf(m), 0);
    db.prepare('UPDATE factions SET power = ? WHERE id = ?').run(power, f.id);
  }

  void npcResult;
  void social;
  return tick;
}

/* ================================================================== *
 * 随机事件
 * ================================================================== */

function pickTemplate(rankId) {
  const pool = EVENT_TEMPLATES.filter((t) => rankId >= t.minRank && rankId <= t.maxRank);
  const total = pool.reduce((a, t) => a + t.weight, 0);
  let r = Math.random() * total;
  for (const t of pool) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return pool[pool.length - 1];
}

export function spawnEvent(row) {
  const tpl = pickTemplate(row.rank_id);
  db.prepare(
    'INSERT INTO pending_events (player_id, template, payload, resolved, created_at) VALUES (?, ?, ?, 0, ?)'
  ).run(row.id, tpl.key, JSON.stringify({ title: tpl.title, text: tpl.text }), now());
  gazette('private', row.id, 'event', `【${tpl.title}】${tpl.text}`);
  return tpl.key;
}

export function listEvents(playerId) {
  return db
    .prepare('SELECT * FROM pending_events WHERE player_id = ? AND resolved = 0 ORDER BY id')
    .all(playerId)
    .map((e) => {
      const tpl = EVENT_TEMPLATES.find((t) => t.key === e.template);
      const payload = parseJSON(e.payload, {});
      return {
        id: e.id,
        key: e.template,
        title: payload.title || tpl?.title,
        text: payload.text || tpl?.text,
        options: (tpl?.options || []).map((o) => ({
          key: o.key,
          label: o.label,
          desc: o.desc,
          cost: o.cost,
        })),
      };
    });
}

export function resolveEvent(playerId, eventId, optionKey) {
  return tx(() => {
    const ev = db
      .prepare('SELECT * FROM pending_events WHERE id = ? AND player_id = ? AND resolved = 0')
      .get(eventId, playerId);
    if (!ev) {
      const e = new Error('此事已了。');
      e.status = 404;
      throw e;
    }
    const tpl = EVENT_TEMPLATES.find((t) => t.key === ev.template);
    const opt = tpl?.options.find((o) => o.key === optionKey);
    if (!opt) {
      const e = new Error('并无此议。');
      e.status = 400;
      throw e;
    }
    const row = getPlayer(playerId);
    const stats = { ...DEFAULT_STATS, ...parseJSON(row.stats, {}) };
    const resources = { ...DEFAULT_RESOURCES, ...parseJSON(row.resources, {}) };
    // 校验与结算必须用同一套换算后的数额，否则会出现「验得起、扣不起」
    const costs = amplify(opt.cost || {}, row.rank_id, { silver: true });
    const gains = amplify(opt.effect || {}, row.rank_id, { silver: true });
    for (const [k, v] of Object.entries(costs)) {
      const have = k === 'silver' || k === 'mandate' ? resources[k] : stats[k];
      if ((have || 0) < v) {
        const e = new Error(`资力不足：尚缺 ${k} ${v - (have || 0)}`);
        e.status = 400;
        throw e;
      }
    }
    applyEffects(row, { ...costs, ...gains });
    db.prepare('UPDATE pending_events SET resolved = 1 WHERE id = ?').run(eventId);
    const line = `【${tpl.title}】你决意「${opt.label}」。—— ${opt.desc}`;
    gazette('private', playerId, 'event', line);
    return { line, profile: selfProfile(getPlayer(playerId)) };
  });
}

/* ================================================================== *
 * 榜单与全局
 * ================================================================== */

export function leaderboard(limit = 50) {
  const rows = db
    .prepare('SELECT * FROM players WHERE retired = 0 ORDER BY rank_id DESC, id ASC')
    .all();
  return rows
    .map((r) => ({
      id: r.id,
      name: r.display_name,
      rankId: r.rank_id,
      grade: RANK_BY_ID.get(r.rank_id).grade,
      title: RANK_BY_ID.get(r.rank_id).title,
      organ: r.office_key ? ORGANS[r.office_key]?.name : ORGANS[RANK_BY_ID.get(r.rank_id).organ]?.name,
      power: powerOf(r),
      tenure: r.tenure,
      npc: !!r.is_npc,
      online: !r.is_npc && now() - r.last_seen < 90_000,
    }))
    .sort((a, b) => b.rankId - a.rankId || b.power - a.power)
    .slice(0, limit);
}

export function courtOverview() {
  const rows = db.prepare('SELECT * FROM players WHERE retired = 0').all();
  const humans = rows.filter((r) => !r.is_npc);
  return {
    tick: currentTick(),
    players: humans.length,
    npcs: rows.length - humans.length,
    online: humans.filter((r) => now() - r.last_seen < 90_000).length,
    highest: rows.length
      ? (() => {
          const top = rows.reduce((a, b) => (b.rank_id > a.rank_id ? b : a));
          return { name: top.display_name, title: RANK_BY_ID.get(top.rank_id).title };
        })()
      : null,
    vacancies: RANKS.filter((r) => r.slots !== null).map((r) => {
      const s = slotStats(r.id);
      return { rankId: r.id, title: r.title, grade: r.grade, total: s.total, filled: s.filled };
    }),
  };
}

export function searchPlayers(keyword, viewerId, limit = 30) {
  const like = `%${keyword || ''}%`;
  const rows = db
    .prepare(
      `SELECT * FROM players WHERE retired = 0 AND (display_name LIKE ? OR username LIKE ?)
       ORDER BY rank_id DESC LIMIT ?`
    )
    .all(like, like, limit);
  return rows.map((r) => publicProfile(r, viewerId));
}

export function listAllPlayers(viewerId, limit = 200) {
  const rows = db
    .prepare(
      `SELECT * FROM players WHERE retired = 0
       ORDER BY rank_id DESC, is_npc ASC, last_seen DESC LIMIT ?`
    )
    .all(limit);
  return rows.map((r) => publicProfile(r, viewerId));
}

export function sendDirectMessage(fromId, toId, text) {
  const clean = String(text || '').slice(0, 500).trim();
  if (!clean) {
    const e = new Error('空函不寄。');
    e.status = 400;
    throw e;
  }
  const t = now();
  db.prepare(
    'INSERT INTO direct_messages (from_id, to_id, text, created_at) VALUES (?, ?, ?, ?)'
  ).run(fromId, toId, clean, t);
  const from = getPlayer(fromId);
  gazette('private', toId, 'letter', `【私函】${from.display_name}：${clean}`, t);
  return { ok: true, at: t };
}

export function dmHistory(a, b, limit = 50) {
  return db
    .prepare(
      `SELECT * FROM direct_messages
       WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
       ORDER BY id DESC LIMIT ?`
    )
    .all(a, b, b, a, limit)
    .reverse();
}

/** 私函会话列表：每个往来对象一行，附最近一条与未读数 */
export function dmConversations(playerId, limit = 50) {
  const rows = db
    .prepare(
      `SELECT
         CASE WHEN from_id = ? THEN to_id ELSE from_id END AS peer,
         MAX(id) AS last_id,
         COUNT(*) AS total,
         SUM(CASE WHEN to_id = ? AND seen = 0 THEN 1 ELSE 0 END) AS unread
       FROM direct_messages
       WHERE from_id = ? OR to_id = ?
       GROUP BY peer
       ORDER BY last_id DESC
       LIMIT ?`
    )
    .all(playerId, playerId, playerId, playerId, limit);

  return rows.map((r) => {
    const peer = getPlayer(r.peer);
    const last = db.prepare('SELECT * FROM direct_messages WHERE id = ?').get(r.last_id);
    return {
      peerId: r.peer,
      name: peer?.display_name ?? '已去位者',
      title: peer ? RANK_BY_ID.get(peer.rank_id)?.title : null,
      npc: !!peer?.is_npc,
      total: r.total,
      unread: r.unread || 0,
      last: last?.text ?? '',
      lastFromMe: last?.from_id === playerId,
      at: last?.created_at ?? 0,
    };
  });
}

/** 打开会话时把对方寄来的信标记为已读 */
export function markDmSeen(playerId, peerId) {
  return db
    .prepare('UPDATE direct_messages SET seen = 1 WHERE to_id = ? AND from_id = ? AND seen = 0')
    .run(playerId, peerId).changes;
}

export { RANKS, RANK_BY_ID, ORGANS, DOCTRINES, MAX_RANK, CONST };
