/**
 * The 2014 conditions. Effect text follows the published rules, split into one
 * bullet per distinct effect so a line can be scanned mid-turn rather than read.
 * `note` carries adjacent rules that aren't part of the condition itself.
 */

export interface ConditionEntry {
  name: string
  summary: string
  effects: string[]
  note?: string
}

export const CONDITIONS: ConditionEntry[] = [
  {
    name: 'Blinded',
    summary: "Can't see. Attacks against it have advantage; its own have disadvantage.",
    effects: [
      "Can't see, and automatically fails any ability check that requires sight.",
      'Attack rolls against the creature have advantage.',
      "The creature's attack rolls have disadvantage."
    ]
  },
  {
    name: 'Charmed',
    summary: "Can't attack the charmer, who gains social advantage.",
    effects: [
      "Can't attack the charmer, or target the charmer with harmful abilities or magical effects.",
      'The charmer has advantage on any ability check to interact socially with the creature.'
    ]
  },
  {
    name: 'Deafened',
    summary: "Can't hear. Auto-fails ability checks needing hearing.",
    effects: ["Can't hear, and automatically fails any ability check that requires hearing."]
  },
  {
    name: 'Exhaustion',
    summary: 'Six cumulative levels. Level 6 is death.',
    effects: [
      'Level 1 — Disadvantage on ability checks.',
      'Level 2 — Speed halved.',
      'Level 3 — Disadvantage on attack rolls and saving throws.',
      'Level 4 — Hit point maximum halved.',
      'Level 5 — Speed reduced to 0.',
      'Level 6 — Death.',
      'A creature suffers the effects of its current level and all lower levels.',
      'Finishing a long rest reduces exhaustion by 1, provided the creature has also ingested some food and drink.'
    ],
    note: 'All exhaustion effects end once the level is reduced below 1.'
  },
  {
    name: 'Frightened',
    summary: 'Disadvantage while it can see the source; can’t approach it.',
    effects: [
      'Disadvantage on ability checks and attack rolls while the source of its fear is within line of sight.',
      "Can't willingly move closer to the source of its fear."
    ]
  },
  {
    name: 'Grappled',
    summary: 'Speed 0. Ends if the grappler is incapacitated.',
    effects: [
      "Speed becomes 0, and it can't benefit from any bonus to its speed.",
      'Ends if the grappler is incapacitated.',
      'Ends if an effect removes the grappled creature from the reach of the grappler or grappling effect — thunderwave, for instance.'
    ]
  },
  {
    name: 'Incapacitated',
    summary: "Can't take actions or reactions.",
    effects: ["Can't take actions or reactions."]
  },
  {
    name: 'Invisible',
    summary: 'Heavily obscured. Attacks against it have disadvantage; its own have advantage.',
    effects: [
      'Impossible to see without the aid of magic or a special sense.',
      'Counts as heavily obscured for the purpose of hiding.',
      'Its location can still be detected by any noise it makes or any tracks it leaves.',
      'Attack rolls against the creature have disadvantage.',
      "The creature's attack rolls have advantage."
    ]
  },
  {
    name: 'Paralyzed',
    summary: 'Incapacitated, auto-fails STR/DEX saves, melee hits are crits.',
    effects: [
      "Incapacitated, and can't move or speak.",
      'Automatically fails Strength and Dexterity saving throws.',
      'Attack rolls against the creature have advantage.',
      'Any attack that hits is a critical hit if the attacker is within 5 feet.'
    ]
  },
  {
    name: 'Petrified',
    summary: 'Turned to stone. Resistant to all damage, immune to poison and disease.',
    effects: [
      'Transformed into a solid inanimate substance — usually stone — along with any nonmagical object it is wearing or carrying.',
      'Its weight increases by a factor of ten, and it ceases aging.',
      "Incapacitated, can't move or speak, and is unaware of its surroundings.",
      'Attack rolls against the creature have advantage.',
      'Automatically fails Strength and Dexterity saving throws.',
      'Has resistance to all damage.',
      'Immune to poison and disease, though a poison or disease already in its system is suspended, not neutralised.'
    ]
  },
  {
    name: 'Poisoned',
    summary: 'Disadvantage on attack rolls and ability checks.',
    effects: ['Disadvantage on attack rolls and ability checks.']
  },
  {
    name: 'Prone',
    summary: 'Crawl or stand. Melee attackers have advantage; ranged have disadvantage.',
    effects: [
      'Its only movement option is to crawl, unless it stands up and thereby ends the condition.',
      'Disadvantage on attack rolls.',
      'Attack rolls against it have advantage if the attacker is within 5 feet, and disadvantage otherwise.'
    ],
    note: 'Standing up costs an amount of movement equal to half the creature’s speed. Dropping prone is free.'
  },
  {
    name: 'Restrained',
    summary: 'Speed 0. Attacks against it have advantage; DEX saves at disadvantage.',
    effects: [
      "Speed becomes 0, and it can't benefit from any bonus to its speed.",
      'Attack rolls against the creature have advantage.',
      "The creature's attack rolls have disadvantage.",
      'Disadvantage on Dexterity saving throws.'
    ]
  },
  {
    name: 'Stunned',
    summary: 'Incapacitated, auto-fails STR/DEX saves, attackers have advantage.',
    effects: [
      "Incapacitated, can't move, and can speak only falteringly.",
      'Automatically fails Strength and Dexterity saving throws.',
      'Attack rolls against the creature have advantage.'
    ]
  },
  {
    name: 'Unconscious',
    summary: 'Incapacitated and prone. Melee hits within 5 ft are crits.',
    effects: [
      "Incapacitated, can't move or speak, and is unaware of its surroundings.",
      'Drops whatever it is holding and falls prone.',
      'Automatically fails Strength and Dexterity saving throws.',
      'Attack rolls against the creature have advantage.',
      'Any attack that hits is a critical hit if the attacker is within 5 feet.'
    ]
  }
]

export const CONDITION_NAMES = CONDITIONS.map((condition) => condition.name)
