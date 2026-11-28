import type { MonsterData } from '../config'
import { kouper } from '../kouper/config'
import { raven } from '../raven/config'

export const kouperDuo:MonsterData={...kouper,hp:2400}
export const ravenDuo:MonsterData={...raven,hp:1750}
export const paperAndRaven:MonsterData={
  ...kouperDuo, id:'kouper-raven-duo', name:'呪紙と黒翼',
}
