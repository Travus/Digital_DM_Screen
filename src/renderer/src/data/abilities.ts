/**
 * Player-facing option lists that come up constantly at the table.
 *
 * Mechanically faithful summaries rather than verbatim text — trimmed to what a
 * DM needs to adjudicate the option mid-turn.
 *
 * **SRD content only.** The SRD carries one archetype per class, so what ships
 * here is thin: eight metamagic options, and the channel divinities of the Life
 * domain and the Oath of Devotion.
 *
 * Tabs are whatever groups are loaded — nothing here is special-cased. A data
 * pack can add a tab by declaring a group with an id of its own, or extend one
 * of these by reusing its id.
 *
 * `meta` always leads with the source, then any further qualifiers, separated by
 * " · " and never parenthesised — "SRD · Cleric · Life". Packs follow the same
 * convention but cite the book an option *first* appeared in, not a reprint.
 */

import type { AbilityGroup, ReferenceEntry } from '../../../shared/types'

export type AbilityEntry = ReferenceEntry
export type { AbilityGroup }

const METAMAGIC: AbilityEntry[] = [
  {
    id: 'mm-careful',
    name: 'Careful Spell',
    meta: 'SRD · 1 sorcery point',
    summary: 'Chosen creatures auto-succeed on the save.',
    lines: [
      'Cast a spell that forces creatures to make a saving throw.',
      'Choose up to your Charisma modifier of them (minimum 1).',
      'Each chosen creature automatically succeeds on its saving throw against the spell.'
    ]
  },
  {
    id: 'mm-distant',
    name: 'Distant Spell',
    meta: 'SRD · 1 sorcery point',
    summary: 'Double the range, or make touch 30 feet.',
    lines: [
      'A spell with a range of 5 feet or more has its range doubled.',
      'A spell with a range of touch gains a range of 30 feet instead.'
    ]
  },
  {
    id: 'mm-empowered',
    name: 'Empowered Spell',
    meta: 'SRD · 1 sorcery point',
    summary: 'Reroll damage dice up to your Charisma modifier.',
    lines: [
      'When you roll damage for a spell, reroll up to your Charisma modifier in damage dice (minimum 1).',
      'You must use the new rolls.'
    ],
    note: 'The one option that stacks: it can be used even if another Metamagic was already applied to the same casting.'
  },
  {
    id: 'mm-extended',
    name: 'Extended Spell',
    meta: 'SRD · 1 sorcery point',
    summary: 'Double the duration, up to 24 hours.',
    lines: [
      'A spell with a duration of 1 minute or longer has its duration doubled.',
      'The new duration can be no longer than 24 hours.'
    ]
  },
  {
    id: 'mm-heightened',
    name: 'Heightened Spell',
    meta: 'SRD · 3 sorcery points',
    summary: 'One target has disadvantage on its first save.',
    lines: [
      'Cast a spell that forces a creature to make a saving throw to resist its effects.',
      'One target of the spell has disadvantage on its first saving throw against it.'
    ]
  },
  {
    id: 'mm-quickened',
    name: 'Quickened Spell',
    meta: 'SRD · 2 sorcery points',
    summary: 'Cast a 1-action spell as a bonus action.',
    lines: ['A spell with a casting time of 1 action is cast as a bonus action instead.'],
    note: 'The usual bonus-action spell restriction still applies: no other spell that turn except a cantrip with a casting time of 1 action.'
  },
  {
    id: 'mm-subtle',
    name: 'Subtle Spell',
    meta: 'SRD · 1 sorcery point',
    summary: 'No somatic or verbal components.',
    lines: [
      'Cast the spell without any somatic or verbal components.',
      'Material components are still required.'
    ]
  },
  {
    id: 'mm-twinned',
    name: 'Twinned Spell',
    meta: 'SRD · Sorcery points = spell level',
    summary: 'Target a second creature with the same spell.',
    lines: [
      'The spell must target only one creature and must not have a range of self.',
      'Spend sorcery points equal to the spell’s level — 1 point for a cantrip — to target a second creature in range.'
    ]
  }
]

const CHANNEL_DIVINITY: AbilityEntry[] = [
  {
    id: 'cd-turn-undead',
    name: 'Turn Undead',
    meta: 'SRD · Cleric · All domains',
    summary: 'Undead within 30 ft flee for 1 minute on a failed WIS save.',
    lines: [
      'As an action, present your holy symbol. Each undead within 30 feet that can see or hear you makes a Wisdom saving throw.',
      'On a failure it is turned for 1 minute, or until it takes any damage.',
      'A turned creature must spend its turns moving as far from you as it can, and cannot willingly move within 30 feet of you.',
      'It cannot take reactions. For its action it can only Dash, or try to escape an effect preventing it from moving. With nowhere to go, it can Dodge.'
    ]
  },
  {
    id: 'cd-preserve-life',
    name: 'Preserve Life',
    meta: 'SRD · Cleric · Life',
    summary: 'Heal 5 × cleric level, split among creatures within 30 ft.',
    lines: [
      'As an action, restore hit points equal to five times your cleric level, divided as you choose among creatures within 30 feet.',
      'This cannot raise a creature above half its hit point maximum.',
      'It has no effect on undead or constructs.'
    ]
  },
  {
    id: 'cd-sacred-weapon',
    name: 'Sacred Weapon',
    meta: 'SRD · Paladin · Devotion',
    summary: 'Add CHA to attack rolls; the weapon sheds light and counts as magical.',
    lines: [
      'As an action, imbue one weapon you are holding for 1 minute.',
      'Add your Charisma modifier to attack rolls with it (minimum +1).',
      'It emits bright light in a 20-foot radius and dim light 20 feet beyond, and counts as magical if it was not already.',
      'You can end the effect on your turn as part of any other action.'
    ]
  },
  {
    id: 'cd-turn-unholy',
    name: 'Turn the Unholy',
    meta: 'SRD · Paladin · Devotion',
    summary: 'As Turn Undead, but fiends and undead.',
    lines: [
      'As an action, each fiend or undead within 30 feet that can see or hear you makes a Wisdom saving throw.',
      'On a failure it is turned for 1 minute or until it takes damage.'
    ]
  }
]

export const ABILITY_GROUPS: AbilityGroup[] = [
  {
    id: 'metamagic',
    title: 'Metamagic',
    blurb:
      'Sorcerer. Options are chosen at 3rd, 10th and 17th level, and only one may be used per casting — except Empowered Spell.',
    entries: METAMAGIC
  },
  {
    id: 'channel-divinity',
    title: 'Channel Divinity',
    blurb:
      'Cleric and paladin. One use per short or long rest at first, two at higher levels. Save DC is the caster’s spell save DC.',
    entries: CHANNEL_DIVINITY
  }
]
