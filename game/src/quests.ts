import { tidebeast, type MonsterData } from './config'
import { emperor } from './emperor/config'
import { kogobon } from './kogobon/config'
import { variant, revotenshi } from './revotenshi/config'
import { sabottenanbon, sabottenanbonOvergrowth } from './sabottenanbon/config'
import { shikouki } from './shikouki/config'
import { raven } from './raven/config'
import { kouencho } from './kouencho/config'
import { wanda } from './wanda/config'

export const difficultyInfo = {
  1: { name: '★1', description: '初級' },
  2: { name: '★2', description: '中級' },
  3: { name: '★3', description: '上級' },
  4: { name: '★4', description: '超上級' },
  emperor: { name: 'エンペラー', description: '最高難度' },
} as const
export const difficulties = [1, 2, 3, 4, 'emperor'] as const
export type Difficulty = typeof difficulties[number]

interface HuntQuest {
  monster: MonsterData
  name: string
  difficulty: Difficulty
  icon: string
  species?: string
  englishName?: string
  attacks: string
  advice: readonly string[]
}

export const quests: readonly HuntQuest[] = [
  {
    monster: sabottenanbon, name: 'サボッテンアンボン（通常）', difficulty: 1, icon: 'sabottenanbon',
    attacks: '三連棘、正面ブレス、回転ブレスと棘の一斉爆発',
    advice: [
      '棘を構えたら、正面から横へ移動して射線を外す。避けたあとに一発ずつ斬り込もう。',
      '怒っている間のブレスは口の向きに追従する。構えを見たら早めに側面へ回る。',
      '足元に爆発の予兆が出たら範囲外へ。棘の一斉爆発が終わったあとは、近づいて反撃しやすい。',
    ],
  },
  {
    monster: kogobon, name: kogobon.name, difficulty: 1, icon: 'kogobon',
    attacks: '咆哮、叩きつけ、跳び込み',
    advice: [
      '咆哮はコウゴボンの方を向いてガードするか、扇形の横へ抜ける。ガードできればHPは減らない。',
      '叩きつけは円の外へ歩き、跳び込みは着地点の予告を見て横へ回避。攻撃が終わったら反撃しよう。',
      '攻撃を3回出すたびに5秒間息切れする。落ち着いて近づいて大剣を振ろう。',
    ],
  },
  {
    monster: kouencho, name: kouencho.name, difficulty: 1, icon: 'kouencho',
    attacks: '火炎弾、火翼急襲、火翼回転、火羽落とし、火炎放射、全域炎輪',
    advice: [
      '炎翼鳥種。炎の予告を横へ抜けて、低く降りたところに反撃しよう。',
      '全域炎輪では足元に迫る炎の波に合わせて回避。波が消えた後は低空で4秒間動けなくなる。',
    ],
  },
  {
    monster: tidebeast, name: tidebeast.name, difficulty: 2, icon: 'tarunru',
    attacks: '腕薙ぎ、突進、回転、跳躍プレス、潮鳴り震波',
    advice: [
      '片腕を引いたら腕薙ぎ、身をかがめたら突進。横にかわして、攻撃が終わってから近づく。',
      '跳躍プレスは着地点から離れ、潮鳴り震波は波の隙間を抜ける。大きな技のあとに溜め斬りを狙える。',
    ],
  },
  {
    monster: variant, name: variant.name, difficulty: 2, icon: 'revotenshi',
    attacks: '片翼なぎ払い、跳び踏み、尾の打ち下ろし、両翼突き刺し、翼風圧、双翼地裂',
    advice: ['両翼を上げたら斜め横へ。刺さった翼爪を狙おう。','翼風圧は範囲外へ。双翼地裂は波が届く瞬間に回避し、頭を狙おう。'],
  },
  {
    monster: revotenshi, name: revotenshi.name, difficulty: 2, icon: 'revotenshi',
    attacks: '光線、スピン、翼の竜巻、無敵バリアと分身体召喚',
    advice: [
      '竜巻に当たると5秒間、移動方向が反転する。竜巻と光線は予兆を見て横へかわす。',
      'バリア中は本体のHPが少しずつ回復する。分身体を2体倒すとバリアが壊れるので、本体がダウンしている間に叩く。',
    ],
  },
  {
    monster: sabottenanbonOvergrowth, name: sabottenanbonOvergrowth.name, difficulty: 2, icon: 'sabottenanbon',
    attacks: '高密度の棘弾幕、正面・回転ブレス、広範囲の棘爆発',
    advice: [
      '通常個体より棘が多く、攻撃が速い。攻撃を欲張らず、予兆が出た時点で横に動く。',
      '足元に棘が残っているときは、ボスだけを見て追わず、爆発範囲の外に回ってから反撃する。',
    ],
  },
  {
    monster: raven, name: raven.name, difficulty: 2, icon: 'terracular-raven',
    attacks: '双腕連撃、黒翼回転、光線、黒羽、装甲突進、邪眼刻印、千眼黒翼陣',
    advice: [
      '種族は異形機械種。翼を広げたら円の外へ。装甲を構えたら予告線を横に抜ける。',
      '邪眼刻印は足元に固定される。光る円から歩いて出よう。怒り中は刻印と黒羽が増える。',
      '千眼黒翼陣では順番に出る射線を外し、最後の衝撃波までに本体から離れる。衝撃波のあとは反撃しやすい。',
    ],
  },
  {
    monster: shikouki, name: shikouki.name, difficulty: 3, icon: 'shikouki',
    attacks: '斬撃、連続穿刺、突進、結晶弾、光線、必殺技「紫煌天獄」',
    advice: [
      '結晶は大剣で破壊できる。光線が結晶に当たると分岐し、斬撃が当たると結晶が爆発する。',
      'HP60%以下で怒り、25%以下で暴走する。紫煌天獄では着地点の予告から離れ、着地後のダウンを狙う。',
      '紫煌天獄の着地衝撃波は直撃で144ダメージ。回避が間に合わないときは着地点を向いてガードする。',
    ],
  },
  {
    monster: wanda, name: wanda.name, difficulty: 4, icon: 'wanda-butterfly-king',
    species: '天翼皇種 · 風／重力', englishName: 'Wanda Butterfly King',
    attacks: '天翼刃、皇刃十字斬、天空爆撃、重力吸引、三連天空波、天断光線、超高速降下斬撃、追跡暴風渦、必殺技「天空崩壊」「天皇終焉陣」',
    advice: [
      '地上の青緑の影を攻撃すれば、上空の本体に届く。影をタップしてロックオンできる。',
      '三連天空波は足元に波が届く瞬間に回避。急降下は予告線の横に抜けるか、ガードでしのぐ。',
      '天空崩壊では青緑の安全地帯に入る。天皇終焉陣では光線と一緒に時計回りに動き、最後の紫の円から離れる。',
      'どちらの必殺技も、終了後に3秒の反撃チャンスがある。',
    ],
  },
  {
    monster: emperor, name: emperor.name, difficulty: 'emperor', icon: 'tarunru',
    attacks: '腕薙ぎ、潮鳴り震波、返し牙、退路狩り、皇圧三連',
    advice: [
      '空振りを見てすぐ横から攻め続けると、返し牙が来る。半身をひねったら追撃まで待とう。',
      '後ろ回避を繰り返すと、退路に帯状の衝撃波が出る。予告を見たら横か斜め前へ。',
      'HPが半分を切ると皇圧三連。二撃目は一拍遅い。最後の正面叩きつけを横に抜けたら反撃しよう。',
    ],
  },
]

function iconUrl(icon: string) {
  return import.meta.env.BASE_URL + 'icons/' + icon + '.webp'
}

export function questIcon(quest: HuntQuest) {
  return iconUrl(quest.icon)
}

export function monsterIcon(monster: MonsterData) {
  return iconUrl(monster.reticle?.icon ?? quests.find(quest => quest.monster.id === monster.id)?.icon ?? monster.id)
}
