/**
 * Condensed 2014 rules reference. Wording follows the published rules;
 * abbreviated where a full sentence adds nothing at the table.
 */

import type { RuleItem, RuleSection, RuleTable } from '../../../shared/types'

export type { RuleItem, RuleSection, RuleTable }

export const RULE_SECTIONS: RuleSection[] = [
  {
    id: 'actions',
    title: 'Actions in Combat',
    items: [
      {
        term: 'Attack',
        text: 'One melee or ranged attack. Extra Attack lets you make more than one with this action.'
      },
      {
        term: 'Cast a Spell',
        text: 'Cast a spell with a casting time of 1 action. If you cast a spell as a bonus action, you can’t cast another spell that turn except a cantrip with a casting time of 1 action.'
      },
      {
        term: 'Dash',
        text: 'Gain extra movement for the turn equal to your speed, after applying any modifiers.'
      },
      {
        term: 'Disengage',
        text: 'Your movement doesn’t provoke opportunity attacks for the rest of the turn.'
      },
      {
        term: 'Dodge',
        text: 'Until the start of your next turn, attack rolls against you have disadvantage if you can see the attacker, and you make Dexterity saves with advantage. Lost if you are incapacitated or your speed drops to 0.'
      },
      {
        term: 'Help',
        text: 'The creature you aid gains advantage on its next ability check for the task, before the start of your next turn. Or aid an attack against a creature within 5 feet of you: the ally’s first attack roll has advantage.'
      },
      {
        term: 'Hide',
        text: 'Make a Dexterity (Stealth) check. You need cover or heavy obscurement to attempt it.'
      },
      {
        term: 'Ready',
        text: 'Pick a perceivable trigger and an action or movement to take in response. The response uses your reaction, before the start of your next turn. A readied spell is cast as normal but held with concentration, for up to 1 minute.'
      },
      {
        term: 'Search',
        text: 'Devote your attention to finding something — Wisdom (Perception) or Intelligence (Investigation), depending on the search.'
      },
      {
        term: 'Use an Object',
        text: 'Use an object that requires an action, or interact with a second object on your turn.'
      }
    ],
    note: 'You also get one free object interaction per turn — drawing a weapon, opening a door, and so on.'
  },
  {
    id: 'special',
    title: 'Special Attacks',
    items: [
      {
        term: 'Grapple',
        text: 'Replaces one attack, and needs a free hand. Strength (Athletics) contested by the target’s Strength (Athletics) or Dexterity (Acrobatics). The target must be no more than one size larger than you.'
      },
      {
        term: 'Shove',
        text: 'Replaces one attack. Same contest as a grapple; on a success, knock the target prone or push it 5 feet away. Target must be no more than one size larger.'
      },
      {
        term: 'Two-Weapon Fighting',
        text: 'Attack action with a light melee weapon: a bonus action attacks with a different light melee weapon in your other hand. No ability modifier to that damage unless the modifier is negative.'
      },
      {
        term: 'Opportunity Attack',
        text: 'One melee attack as a reaction when a hostile creature you can see leaves your reach using its movement.'
      },
      {
        term: 'Unseen Attackers',
        text: 'Attacking from an unseen position gives advantage. Attacking a target you can’t see gives disadvantage, and you must guess the square.'
      }
    ]
  },
  {
    id: 'cover',
    title: 'Cover & Vision',
    items: [
      {
        term: 'Half cover',
        text: '+2 to AC and Dexterity saving throws. At least half the body is blocked.'
      },
      { term: 'Three-quarters cover', text: '+5 to AC and Dexterity saving throws.' },
      {
        term: 'Total cover',
        text: 'Can’t be targeted directly by an attack or spell, though areas of effect can still reach it.'
      },
      {
        term: 'Lightly obscured (dim light, patchy fog)',
        text: 'Disadvantage on Wisdom (Perception) checks that rely on sight.'
      },
      {
        term: 'Heavily obscured (darkness, opaque fog)',
        text: 'You effectively suffer the blinded condition when trying to see into it.'
      },
      {
        term: 'Darkvision',
        text: 'Within range, dim light counts as bright light and darkness counts as dim light — in shades of grey.'
      },
      { term: 'Blindsight', text: 'Perceive surroundings within range without relying on sight.' },
      {
        term: 'Truesight',
        text: 'See in normal and magical darkness, see invisible creatures, automatically detect visual illusions and succeed on saves against them, perceive the original form of a shapechanger, and see into the Ethereal Plane.'
      }
    ]
  },
  {
    id: 'dcs',
    title: 'Difficulty Classes',
    tables: [
      {
        head: ['Task difficulty', 'DC'],
        rows: [
          ['Very easy', '5'],
          ['Easy', '10'],
          ['Medium', '15'],
          ['Hard', '20'],
          ['Very hard', '25'],
          ['Nearly impossible', '30']
        ]
      }
    ],
    note: 'Passive score = 10 + all modifiers that normally apply, +5 with advantage, −5 with disadvantage.'
  },
  {
    id: 'travel',
    title: 'Travel Pace',
    tables: [
      {
        head: ['Pace', 'Per minute', 'Per hour', 'Per day', 'Effect'],
        rows: [
          ['Fast', '400 ft', '4 miles', '30 miles', '−5 to passive Wisdom (Perception)'],
          ['Normal', '300 ft', '3 miles', '24 miles', '—'],
          ['Slow', '200 ft', '2 miles', '18 miles', 'Able to use stealth']
        ]
      }
    ],
    note: 'Difficult terrain halves the distance covered. Forced march: beyond 8 hours, each extra hour needs a Constitution save at DC 10 + 1 per hour past 8, or a level of exhaustion.'
  },
  {
    id: 'damage',
    title: 'Improvised Damage',
    tables: [
      {
        head: ['Damage', 'Example'],
        rows: [
          ['1d10', 'Burned by coals, hit by a falling bookcase, pricked by a poison needle'],
          ['2d10', 'Struck by lightning, stung by a giant scorpion'],
          ['4d10', 'Tumbling down a rock slide, stabbed by a giant spider’s fangs'],
          ['10d10', 'Crushed by compacting walls, hit by a wrecking ball'],
          ['18d10', 'Wading through a lava stream, crushed by a giant boulder'],
          ['24d10', 'Submerged in lava, hit by a crashing flying fortress']
        ]
      }
    ],
    note: 'Falling: 1d6 bludgeoning per 10 feet, to a maximum of 20d6. Suffocation: hold breath for 1 + CON modifier minutes (minimum 30 seconds), then survive CON modifier rounds (minimum 1) before dropping to 0 hit points.'
  },
  {
    id: 'objects',
    title: 'Objects',
    tables: [
      {
        caption: 'Object Armour Class',
        head: ['Substance', 'AC'],
        rows: [
          ['Cloth, paper, rope', '11'],
          ['Crystal, glass, ice', '13'],
          ['Wood, bone', '15'],
          ['Stone', '17'],
          ['Iron, steel', '19'],
          ['Mithral', '21'],
          ['Adamantine', '23']
        ]
      },
      {
        caption: 'Object Hit Points',
        head: ['Size', 'Fragile', 'Resilient'],
        rows: [
          ['Tiny (bottle, lock)', '2 (1d4)', '5 (2d4)'],
          ['Small (chest, lute)', '3 (1d6)', '10 (3d6)'],
          ['Medium (barrel, chandelier)', '4 (1d8)', '18 (4d8)'],
          ['Large (cart, 10-ft-by-10-ft window)', '5 (1d10)', '27 (5d10)']
        ]
      }
    ],
    note: 'Objects are immune to poison and psychic damage, and huge or larger objects are damaged section by section rather than as a whole. A DM may rule an object immune or resistant to a damage type — cloth ignores a club, for instance.'
  },
  {
    id: 'rest',
    title: 'Resting & Death',
    items: [
      {
        term: 'Short Rest',
        text: 'At least 1 hour of nothing more strenuous than eating, drinking, reading or tending wounds. Spend Hit Dice to heal: roll the die and add your Constitution modifier for each one spent.'
      },
      {
        term: 'Long Rest',
        text: 'At least 8 hours of sleep or light activity, with no more than 2 hours of watch, reading, talking or eating. Regain all hit points and half your total Hit Dice (minimum 1). One per 24 hours, and you must start with at least 1 hit point.'
      },
      {
        term: 'Interrupted rest',
        text: 'An hour of walking, fighting, casting spells or similar strenuous activity restarts a long rest.'
      },
      {
        term: 'Death Saves',
        text: 'DC 10 at the start of each of your turns at 0 HP. Three successes stabilise you; three failures kill you. A natural 20 restores 1 hit point; a natural 1 counts as two failures.'
      },
      {
        term: 'Damage at 0 HP',
        text: 'Any damage causes one failed death save; a critical hit causes two. Damage equal to or greater than your hit point maximum is instant death.'
      },
      {
        term: 'Massive Damage',
        text: 'If damage reduces you to 0 and the remaining damage equals or exceeds your hit point maximum, you die outright.'
      }
    ]
  }
]
