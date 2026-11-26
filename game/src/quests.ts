import { tidebeast, type MonsterData } from './config'
import { revotenshi } from './revotenshi/config'
import { sabottenanbon, sabottenanbonOvergrowth } from './sabottenanbon/config'
import { shikouki } from './shikouki/config'

export const difficulties = [1, 2, 3] as const
export type Difficulty = typeof difficulties[number]

interface HuntQuest {
  monster: MonsterData
  name: string
  difficulty: Difficulty
  icon: string
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
    monster: tidebeast, name: tidebeast.name, difficulty: 2, icon: 'tarunru',
    attacks: '腕薙ぎ、突進、回転、跳躍プレス、潮鳴り震波',
    advice: [
      '片腕を引いたら腕薙ぎ、身をかがめたら突進。横にかわして、攻撃が終わってから近づく。',
      '跳躍プレスは着地点から離れ、潮鳴り震波は波の隙間を抜ける。大きな技のあとに溜め斬りを狙える。',
    ],
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
    monster: shikouki, name: shikouki.name, difficulty: 3, icon: 'shikouki',
    attacks: '斬撃、連続穿刺、突進、結晶弾、光線、必殺技「紫煌天獄」',
    advice: [
      '結晶は大剣で破壊できる。光線が結晶に当たると分岐し、斬撃が当たると結晶が爆発する。',
      'HP60%以下で怒り、25%以下で暴走する。紫煌天獄では着地点の予告から離れ、着地後のダウンを狙う。',
      '紫煌天獄の着地衝撃波は直撃で144ダメージ。回避が間に合わないときは着地点を向いてガードする。',
    ],
  },
]

export function questIcon(quest: HuntQuest) {
  return import.meta.env.BASE_URL + 'icons/' + quest.icon + '.webp'
}
