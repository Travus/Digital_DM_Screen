/** Syllable pools for the improv name generator. */

export interface NameStyle {
  id: string
  label: string
  /**
   * People get a personality and a motive when fleshed out; places get a
   * detail and a hook. Mixing the two produced shops that "speak in questions".
   */
  kind: 'person' | 'place'
  /** Combined as prefix + optional middle + suffix. */
  prefix: string[]
  middle: string[]
  suffix: string[]
  /** Chance of inserting a middle syllable. */
  middleChance: number
}

export const NAME_STYLES: NameStyle[] = [
  {
    id: 'human',
    label: 'Human',
    kind: 'person',
    middleChance: 0.35,
    prefix: [
      'Al',
      'Ber',
      'Cor',
      'Dav',
      'Ed',
      'Gar',
      'Hal',
      'Jor',
      'Kal',
      'Mar',
      'Rob',
      'Ser',
      'Tho',
      'Wil',
      'Ren',
      'Hen'
    ],
    middle: ['an', 'ar', 'en', 'ic', 'il', 'or', 'ov', 'er'],
    suffix: ['ric', 'wyn', 'den', 'mund', 'bert', 'gar', 'tha', 'lin', 'mir', 'son', 'ley', 'ton']
  },
  {
    id: 'elf',
    label: 'Elf',
    kind: 'person',
    middleChance: 0.6,
    prefix: [
      'Ael',
      'Cael',
      'Elar',
      'Fael',
      'Ily',
      'Lath',
      'Myr',
      'Nael',
      'Riel',
      'Sylv',
      'Thal',
      'Vael'
    ],
    middle: ['an', 'ari', 'ele', 'ith', 'ora', 'yal', 'ien', 'eth'],
    suffix: ['wen', 'dir', 'rian', 'thil', 'las', 'nor', 'mira', 'sae', 'wyn', 'aeth']
  },
  {
    id: 'dwarf',
    label: 'Dwarf',
    kind: 'person',
    middleChance: 0.2,
    prefix: [
      'Bal',
      'Bru',
      'Dur',
      'Gim',
      'Grun',
      'Hild',
      'Kor',
      'Mor',
      'Thra',
      'Ulf',
      'Vond',
      'Dwal'
    ],
    middle: ['ar', 'or', 'un', 'ga', 'ri'],
    suffix: ['din', 'grim', 'nar', 'bek', 'dur', 'thra', 'moir', 'hild', 'fist', 'stone', 'forge']
  },
  {
    id: 'orc',
    label: 'Orc & Half-Orc',
    kind: 'person',
    middleChance: 0.25,
    prefix: [
      'Bog',
      'Dru',
      'Gor',
      'Grash',
      'Karg',
      'Mog',
      'Nar',
      'Rok',
      'Shag',
      'Thok',
      'Uruk',
      'Zug'
    ],
    middle: ['ag', 'ur', 'og', 'ma', 'ka'],
    suffix: ['nak', 'gash', 'thar', 'rok', 'dush', 'zug', 'grim', 'tusk', 'maw', 'skar']
  },
  {
    id: 'halfling',
    label: 'Halfling & Gnome',
    kind: 'person',
    middleChance: 0.4,
    prefix: ['Bil', 'Cor', 'Dan', 'Fen', 'Jam', 'Lid', 'Mer', 'Nib', 'Pip', 'Rosc', 'Tam', 'Wend'],
    middle: ['ber', 'wid', 'ly', 'do', 'per'],
    suffix: ['bo', 'kin', 'foot', 'buck', 'thistle', 'wick', 'topple', 'bramble', 'nook', 'penny']
  },
  {
    id: 'tavern',
    label: 'Tavern',
    kind: 'place',
    middleChance: 1,
    prefix: [
      'The Rusty',
      'The Gilded',
      'The Drunken',
      'The Weeping',
      'The Laughing',
      'The Silver',
      'The Broken',
      'The Hungry',
      'The Salted',
      'The Crooked',
      'The Wandering',
      'The Sleeping'
    ],
    middle: [''],
    suffix: [
      'Flagon',
      'Griffon',
      'Dragon',
      'Anchor',
      'Lantern',
      'Boar',
      'Barrel',
      'Maiden',
      'Kettle',
      'Stag',
      'Crow',
      'Wheel',
      'Hound',
      'Pony'
    ]
  },
  {
    id: 'shop',
    label: 'Shop & Guild',
    kind: 'place',
    middleChance: 1,
    prefix: [
      'Ashen',
      'Copper',
      'Ember',
      'Hollow',
      'Ironwood',
      'Moonlit',
      'Nine',
      'Quill &',
      'Thorn &',
      'Velvet',
      'Whetstone',
      'Amber'
    ],
    middle: [''],
    suffix: [
      'Curios',
      'Apothecary',
      'Armoury',
      'Emporium',
      'Bindery',
      'Ledger',
      'Forge',
      'Reliquary',
      'Provisions',
      'Cartography',
      'Alchemy',
      'Trading House'
    ]
  }
]

export const TRAITS = [
  'constantly counting coins',
  'speaks in questions',
  'nervous laugh after every sentence',
  'missing two fingers, never explains',
  'smells strongly of woodsmoke',
  'refuses to make eye contact',
  'quotes scripture inaccurately',
  'terrified of birds',
  'unreasonably proud of their hat',
  'hums while thinking',
  'never sits down',
  'remembers every name, gets them all slightly wrong',
  'keeps a live animal in their coat',
  'talks about their sibling constantly',
  'chews something the whole conversation',
  'unbearably honest',
  'name-drops a noble who has never met them',
  'flinches at loud noises',
  'writes down everything you say',
  'always cold, always complaining about it'
]

/** Places get their own detail/hook pair — see NameStyle.kind. */
export const PLACE_DETAILS = [
  'the ale is watered, and everyone knows it',
  'far too clean for the neighbourhood',
  'the owner never comes out from the back',
  'a mounted head over the bar, species unclear',
  'prices chalked up and changed hourly',
  'every window boarded from the inside',
  'a dog that growls at exactly one patron',
  'the fire is always out, the room always warm',
  'sawdust on the floor, fresh, covering something',
  'a locked door nobody will explain',
  'far busier than the street outside justifies',
  'the same song, over and over, all night'
]

export const PLACE_HOOKS = [
  'the owner is behind on protection money',
  'a regular has not come in for a week',
  'something in the cellar is not stock',
  'it changed hands last month, quietly',
  'a rival is buying up the debt',
  'the staff are all related, and all lying',
  'it fronts for something duller than you hope',
  'a room upstairs is rented in perpetuity, never used',
  'the previous owner is buried under it',
  'someone is meeting someone here at midnight',
  'the guard never patrols this street, by arrangement',
  'a map is nailed under one of the tables'
]

export const WANTS = [
  'wants a debt forgiven',
  'wants someone gone from town',
  'wants proof their rival is a fraud',
  'wants passage out, tonight',
  'wants an heirloom back',
  'wants to be told a secret worth trading',
  'wants protection they cannot afford',
  'wants a body found',
  'wants to be taken seriously',
  'wants a letter delivered, unopened',
  'wants revenge but lacks the nerve',
  'wants to join the party'
]
