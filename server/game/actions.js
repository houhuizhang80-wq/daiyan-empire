/**
 * 行动系统
 *
 * 三条路径：
 *   open   —— 正当权力：朝廷赋予的政令之权（推行政务、调配钱粮、铨选人事）
 *   shadow —— 地下权力：不落纸面的运作（密谋、把柄、风闻、消弭痕迹）
 *   social —— 关系经营：赠礼、宴请、联姻、结盟
 *
 * 每条行动统一结构：
 *   cost    资源消耗（mandate 政令 / silver 银两 / guile 权谋值）
 *   require 前置校验，返回 null 表示通过，否则返回错误文案
 *   resolve 结算函数，返回 { effects, logs, relations, events }
 */

import { RANK_BY_ID, MAX_RANK, rankYield } from './data.js';

const rnd = (min, max) => Math.random() * (max - min) + min;
const jitter = (v, pct = 0.35) => Math.round(v * rnd(1 - pct, 1 + pct));

/** 密谋的权谋开销：随官阶放大，与引擎的成本校验同一口径 */
export const SCHEME_GUILE_COST = 14;
const schemeCost = (rankId) => SCHEME_GUILE_COST * rankYield(rankId);

/* ================================================================== *
 * 明线：正当权力
 * ================================================================== */

const OPEN_ACTIONS = {
  policy: {
    key: 'policy',
    path: 'open',
    name: '推行新政',
    desc: '在自己辖内推行一项新法。办成了是政绩，办砸了是乱政。',
    cost: { mandate: 3 },
    cooldown: 1,
    resolve: (ctx) => {
      const fail = Math.random() < 0.25 - Math.min(ctx.stats.renown, 60) / 400;
      if (fail) {
        return {
          effects: { merit: -jitter(8), favor: -jitter(5), renown: -jitter(4) },
          logs: ['新政推行受阻，地方豪强联手抵制，非但无功，反倒落了个「扰民」的名声。'],
        };
      }
      return {
        effects: { merit: jitter(18), favor: jitter(4), renown: jitter(3) },
        logs: ['新政次第铺开，境内称便。考成册上，添了浓重的一笔。'],
      };
    },
  },

  allocate: {
    key: 'allocate',
    path: 'open',
    name: '调配钱粮',
    desc: '在权责范围内调拨钱谷。做得漂亮，公帑和私囊都能兼顾。',
    cost: { mandate: 2 },
    cooldown: 1,
    resolve: (ctx) => {
      const rank = RANK_BY_ID.get(ctx.rankId);
      // 银两收入以俸禄为基准，本身就随官阶增长近千倍。
      // 旧式再乘一次 (1 + 官阶×0.3)，会与官阶收益系数叠加，是长局通胀的主因。
      return {
        effects: {
          silver: jitter(Math.round(rank.salary * 0.5)),
          merit: jitter(8),
        },
        logs: ['钱谷调拨完毕，账面平顺，上下无话。'],
      };
    },
  },

  patrol: {
    key: 'patrol',
    path: 'open',
    name: '巡查地方',
    desc: '亲自下去走一圈。看得见的政绩，也看得见的人心。',
    cost: { mandate: 2 },
    cooldown: 1,
    resolve: () => ({
      effects: { merit: jitter(11), renown: jitter(9), health: -4 },
      logs: ['车马劳顿，然境内虚实尽在胸中。士民夹道，颇有颂声。'],
    }),
  },

  memorial: {
    key: 'memorial',
    path: 'open',
    name: '上书言事',
    desc: '递一道折子上去。说得对了，是简在帝心；说错了，是妄议。',
    cost: { mandate: 2 },
    cooldown: 1,
    resolve: (ctx) => {
      const good = Math.random() < 0.45 + Math.min(ctx.stats.renown, 80) / 400;
      if (good) {
        return {
          effects: { favor: jitter(11), renown: jitter(6) },
          logs: ['折子留中三日，随即有旨：「所奏甚合朕意，着照所请。」'],
        };
      }
      return {
        effects: { favor: -jitter(5), renown: jitter(4) },
        logs: ['折子被批了四个字：「知道了。」—— 不好，也不坏。'],
      };
    },
  },

  assess: {
    key: 'assess',
    path: 'open',
    name: '考核属吏',
    desc: '给手底下的人定等第。这是最温和的立威方式，也是攒把柄的地方。',
    cost: { mandate: 2 },
    cooldown: 1,
    resolve: () => ({
      // 权谋值的主要来源，必须自持：密谋一次要 14，若考核只给个位数，
      // 权谋就会持续净流出，暗线只能靠买把柄续命 —— 而那要花银子，
      // 于是整条路卡在「权谋不足 → 买把柄 → 银子不够」的死循环里。
      effects: { network: jitter(9), guile: jitter(16) },
      logs: ['考语一出，几人欢喜几人愁。至少他们都明白了一件事：等第在你手里。'],
    }),
  },

  recommend: {
    key: 'recommend',
    path: 'open',
    name: '举荐人才',
    desc: '保举一人出任某职。从今往后，他就是你的人了。',
    cost: { mandate: 3, silver: 60 },
    cooldown: 1,
    target: 'player',
    require: (ctx) => {
      if (!ctx.target) return '须择一人举荐。';
      if (ctx.target.id === ctx.player.id) return '不能举荐自己。';
      const me = RANK_BY_ID.get(ctx.rankId);
      const him = RANK_BY_ID.get(ctx.target.rank_id);
      if (him.id > me.id) return '对方官阶不低于你，何须你举荐。';
      if (ctx.relationTo(ctx.target.id, 'protege')) return '此人已是你的门生。';
      return null;
    },
    resolve: (ctx) => ({
      effects: { network: jitter(16), renown: jitter(6) },
      targetEffects: { favor: jitter(10), merit: jitter(5) },
      relations: [{ to: ctx.target.id, type: 'protege', delta: 45 }],
      logs: [
        `你具疏保举 ${ctx.targetName}，措辞恳切。`,
        `${ctx.targetName} 闻讯，执门生礼来见。自此座主门生，名分已定。`,
      ],
    }),
  },

  petition: {
    key: 'petition',
    path: 'open',
    name: '求恩主举荐',
    desc: '备一份厚礼，去座师府上走动。人情用一次薄一次。',
    cost: { silver: 150 },
    cooldown: 2,
    require: (ctx) => {
      if (!ctx.patron) return '你尚无恩主可求。先去结交一位上官。';
      return null;
    },
    resolve: (ctx) => ({
      effects: { favor: jitter(14), network: -jitter(4) },
      relations: [{ to: ctx.patron.id, type: 'patron', delta: -8 }],
      logs: [
        `你备了帖子与土仪，登门拜见 ${ctx.patron.name}。`,
        `${ctx.patron.name} 沉吟良久，道：「你的事，我记下了。」`,
      ],
    }),
  },

  petition_office: {
    key: 'petition_office',
    path: 'open',
    name: '自陈求进',
    desc: '直接上疏自荐，请求补授空缺。快，但要看圣眷。',
    cost: { mandate: 4 },
    cooldown: 3,
    resolve: (ctx) => {
      const p = 0.2 + Math.min(ctx.stats.favor, 120) / 300 + Math.min(ctx.stats.renown, 100) / 400;
      if (Math.random() < p) {
        return {
          effects: { favor: jitter(12), renown: jitter(8), merit: jitter(6) },
          logs: ['疏入，上批：「该员办事勤谨，着吏部议叙。」'],
        };
      }
      return {
        effects: { favor: -jitter(6), renown: -jitter(4) },
        logs: ['疏入，留中不发。有人笑你「躁进」。'],
      };
    },
  },
};

/* ================================================================== *
 * 暗线：地下权力
 * ================================================================== */

const SHADOW_ACTIONS = {
  scheme: {
    key: 'scheme',
    path: 'shadow',
    name: '密谋构陷',
    desc: '设一个局，让对手在考成或圣眷上栽一跤。他摔的这一跤，就是你往上走的那一级。',
    cost: { guile: SCHEME_GUILE_COST },
    cooldown: 1,
    target: 'player',
    require: (ctx) => {
      if (!ctx.target) return '须择一人。';
      if (ctx.target.id === ctx.player.id) return '何必为难自己。';
      if (ctx.stats.guile < schemeCost(ctx.rankId)) return '权谋不足，仓促行事只会露出破绽。';
      return null;
    },
    resolve: (ctx) => {
      const power = ctx.stats.guile + ctx.stats.network * 0.5;
      const defense = ctx.target.stats.renown * 0.6 + ctx.target.stats.favor * 0.4 + 20;
      const success = power > defense * rnd(0.7, 1.15);
      if (success) {
        return {
          // 暗线必须有直接收益，否则只是「损人不利己」，走这条路的人必然垫底。
          // 收益须明显高于明线，才对得起暴露度这条命门 —— 代价不是「没收益」，是「会被弹劾」。
          effects: { guile: jitter(12), merit: jitter(48), favor: jitter(22), exposure: jitter(12, 0.3) },
          targetEffects: { merit: -jitter(20), favor: -jitter(12) },
          relations: [{ to: ctx.target.id, type: 'rival', delta: 25 }],
          logs: [
            `你借着一次寻常的文书往返，把 ${ctx.targetName} 的疏漏递到了该看的人案头。`,
            `${ctx.targetName} 吃了暗亏，却始终不知刀从何来。空缺出来的时候，资历最够的恰好是你。`,
          ],
        };
      }
      return {
        effects: { exposure: jitter(22, 0.3), renown: -jitter(6) },
        relations: [{ to: ctx.target.id, type: 'nemesis', delta: 40 }],
        logs: [
          `你的安排出了纰漏。${ctx.targetName} 顺藤摸瓜，几乎摸到了你。`,
          `虽然没有实证，但梁子算是结下了。`,
        ],
      };
    },
  },

  blackmail: {
    key: 'blackmail',
    path: 'shadow',
    name: '收买把柄',
    desc: '银子换来的东西，有时候比圣旨好使。',
    cost: { silver: 200 },
    cooldown: 1,
    target: 'player',
    require: (ctx) => {
      if (!ctx.target) return '须择一人。';
      if (ctx.target.id === ctx.player.id) return '不必查自己。';
      return null;
    },
    resolve: (ctx) => ({
      effects: { guile: jitter(16), network: jitter(15), exposure: jitter(8, 0.4) },
      targetEffects: { favor: -jitter(3) },
      relations: [{ to: ctx.target.id, type: 'confidant', delta: 10 }],
      logs: [
        `你使了一笔银子，从 ${ctx.targetName} 的旧仆口中，问出了几件不该外传的事。`,
        `东西收在暗格里。用不用，什么时候用，都由你。`,
      ],
    }),
  },

  slander: {
    key: 'slander',
    path: 'shadow',
    name: '风闻奏事',
    desc: '不具名的折子递上去，让清议替你动手。',
    cost: { mandate: 2, silver: 80 },
    cooldown: 2,
    target: 'player',
    require: (ctx) => {
      if (!ctx.target) return '须择一人。';
      if (ctx.target.id === ctx.player.id) return '不可自污。';
      return null;
    },
    resolve: (ctx) => {
      const success = Math.random() < 0.6;
      return {
        effects: { exposure: jitter(11, 0.3), favor: jitter(15) },
        targetEffects: success
          ? { renown: -jitter(22), favor: -jitter(6) }
          : { renown: -jitter(6), favor: jitter(8) },
        relations: [{ to: ctx.target.id, type: 'rival', delta: 18 }],
        logs: success
          ? [`风闻四起，${ctx.targetName} 声名扫地，一时门可罗雀。`]
          : [`折子被驳了。${ctx.targetName} 反倒落了个「受诬不屈」的美名。`],
      };
    },
  },

  cover: {
    key: 'cover',
    path: 'shadow',
    name: '消弭痕迹',
    desc: '该烧的烧，该埋的埋，该打点的打点。',
    cost: { silver: 90 },
    cooldown: 1,
    resolve: () => ({
      // 一次消弭只买回约三个回合的痕迹。若能一次抹平，暴露度这条命门就形同虚设。
      effects: { exposure: -jitter(30, 0.25), guile: jitter(3) },
      logs: ['旧账清了，旧人也散了。这一页，翻过去了。'],
    }),
  },

  poach: {
    key: 'poach',
    path: 'shadow',
    name: '暗中挖角',
    desc: '把别人倚重的人，变成自己的人。',
    cost: { silver: 260 },
    cooldown: 1,
    target: 'player',
    require: (ctx) => {
      if (!ctx.target) return '须择一人。';
      if (ctx.target.id === ctx.player.id) return '不必挖自己。';
      return null;
    },
    resolve: (ctx) => ({
      effects: { network: jitter(38), merit: jitter(20), exposure: jitter(6, 0.4) },
      targetEffects: { network: -jitter(12) },
      relations: [
        { to: ctx.target.id, type: 'ally', delta: 15 },
        { to: ctx.target.id, type: 'rival', delta: 10 },
      ],
      logs: [
        `你许了 ${ctx.targetName} 一个将来。他动摇了。`,
        `这世上最锋利的刀，往往是从内部抽出来的。`,
      ],
    }),
  },

  collude: {
    key: 'collude',
    path: 'shadow',
    name: '暗中输诚',
    desc: '越过正途，直接向上面的人表忠心。',
    cost: { silver: 300 },
    cooldown: 2,
    resolve: () => ({
      effects: { favor: jitter(42), merit: jitter(24), exposure: jitter(10, 0.3), renown: -jitter(4) },
      logs: ['中门递了帖子，后门抬了箱子。三日后，你在御前多了一句好话。'],
    }),
  },
};

/* ================================================================== *
 * 社交：关系经营
 * ================================================================== */

const SOCIAL_ACTIONS = {
  gift: {
    key: 'gift',
    path: 'social',
    name: '赠礼',
    desc: '雅物往来，人情自厚。',
    cost: { silver: 80 },
    cooldown: 1,
    target: 'player',
    require: (ctx) => (ctx.target ? null : '须择一人。'),
    resolve: (ctx) => ({
      effects: { network: jitter(6) },
      relations: [{ to: ctx.target.id, type: 'ally', delta: 14 }],
      logs: [`你遣人送了一份礼到 ${ctx.targetName} 府上。回帖很快，措辞客气。`],
    }),
  },

  banquet: {
    key: 'banquet',
    path: 'social',
    name: '设宴结交',
    desc: '摆一桌酒，请几位同僚。酒桌上的交情，比公文里深。',
    cost: { silver: 130 },
    cooldown: 1,
    resolve: () => ({
      effects: { network: jitter(15), renown: jitter(5) },
      logs: ['宴罢夜深，宾主尽欢。散席时，几双手握得比来时紧了些。'],
    }),
  },

  letter: {
    key: 'letter',
    path: 'social',
    name: '修书通问',
    desc: '一封手札，不费银钱，只费心思。',
    cost: { mandate: 1 },
    cooldown: 1,
    target: 'player',
    require: (ctx) => (ctx.target ? null : '须择一人。'),
    resolve: (ctx) => ({
      effects: { network: jitter(5) },
      relations: [{ to: ctx.target.id, type: 'ally', delta: 9 }],
      logs: [`你修书一封致 ${ctx.targetName}，只谈风月，不及政事。`],
    }),
  },

  marry: {
    key: 'marry',
    path: 'social',
    name: '缔结姻亲',
    desc: '两姓之好，实为两势之合。从此荣损与共。',
    cost: { silver: 420 },
    cooldown: 4,
    target: 'player',
    require: (ctx) => {
      if (!ctx.target) return '须择一门当户对之家。';
      if (ctx.relationTo(ctx.target.id, 'kin')) return '两家已是姻亲。';
      return null;
    },
    resolve: (ctx) => ({
      effects: { network: jitter(26), renown: jitter(8) },
      relations: [{ to: ctx.target.id, type: 'kin', delta: 55 }],
      logs: [
        `你与 ${ctx.targetName} 家议定了婚事，六礼齐备。`,
        `红烛高照的那一夜，两家的命运被绑在了同一根绳上。`,
      ],
    }),
  },

  confide: {
    key: 'confide',
    path: 'social',
    name: '托付心腹',
    desc: '把一件要紧的私事交给某人去办。办成了，他就是心腹。',
    cost: { silver: 160, mandate: 1 },
    cooldown: 2,
    target: 'player',
    require: (ctx) => (ctx.target ? null : '须择一人。'),
    resolve: (ctx) => ({
      effects: { network: jitter(12), guile: jitter(6) },
      relations: [{ to: ctx.target.id, type: 'confidant', delta: 30 }],
      logs: [`你把一件不便见光的事托给了 ${ctx.targetName}。他没有多问，只是点了点头。`],
    }),
  },
};

/* ================================================================== *
 * 仕途
 * ================================================================== */

const CAREER_ACTIONS = {
  resign: {
    key: 'resign',
    path: 'career',
    name: '告病致仕',
    desc: '自请去职，退归林下。所有功名、人脉、恩怨，一并归零。',
    cost: {},
    cooldown: 0,
    resolve: () => ({
      effects: {},
      reset: true,
      logs: ['疏上，准了。你解下印绶，走出衙门时天刚亮。'],
    }),
  },
};

export const ACTIONS = {
  ...OPEN_ACTIONS,
  ...SHADOW_ACTIONS,
  ...SOCIAL_ACTIONS,
  ...CAREER_ACTIONS,
};

export const PATH_META = {
  open: { key: 'open', name: '正当权力', color: '#2f6f4e', desc: '朝廷赋予的政令之权，走得稳，但每一步都要熬。' },
  shadow: { key: 'shadow', name: '地下权力', color: '#8a2b3c', desc: '不落纸面的运作，见效快，痕迹也会留下来。' },
  social: { key: 'social', name: '关系经营', color: '#8a6d2b', desc: '人脉是一切的底子，无论你走哪条路。' },
  career: { key: 'career', name: '仕途', color: '#4a5568', desc: '进退去留。' },
};

export function actionList() {
  return Object.values(ACTIONS).map((a) => ({
    key: a.key,
    path: a.path,
    name: a.name,
    desc: a.desc,
    cost: a.cost || {},
    cooldown: a.cooldown || 0,
    target: a.target || 'none',
  }));
}

export { MAX_RANK };
