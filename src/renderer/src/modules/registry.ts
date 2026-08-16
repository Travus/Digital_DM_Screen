import { abilitiesModule } from './AbilitiesModule'
import { bigDiceModule } from './BigDiceModule'
import { conditionsModule } from './ConditionsModule'
import { diceModule } from './DiceModule'
import { diseasesModule } from './DiseasesModule'
import { initiativeModule } from './InitiativeModule'
import { namesModule } from './NamesModule'
import { notesModule } from './NotesModule'
import { partyModule } from './PartyModule'
import { rulesModule } from './RulesModule'
import { tableModule } from './TableModule'
import { tablesModule } from './TablesModule'
import { timerModule } from './TimerModule'
import { trackersModule } from './TrackersModule'
import type { AnyModule, ModuleCategory } from './types'

export const MODULES: AnyModule[] = [
  conditionsModule,
  rulesModule,
  abilitiesModule,
  diseasesModule,
  partyModule,
  initiativeModule,
  trackersModule,
  notesModule,
  tableModule,
  diceModule,
  bigDiceModule,
  tablesModule,
  namesModule,
  timerModule
]

export const MODULE_CATEGORIES: ModuleCategory[] = ['Reference', 'Tracking', 'Tools']

const BY_ID = new Map(MODULES.map((module) => [module.id, module]))

export function getModule(id: string): AnyModule | undefined {
  return BY_ID.get(id)
}
