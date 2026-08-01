/**
 * Named diseases: the six the *contagion* spell can inflict, and the three with
 * their own write-ups. All SRD; `meta` leads with the source, as in the
 * abilities data.
 */

export interface DiseaseEntry {
  id: string
  name: string
  summary: string
  lines: string[]
  meta?: string
  note?: string
}

export const DISEASES: DiseaseEntry[] = [
  {
    id: 'blinding-sickness',
    name: 'Blinding Sickness',
    meta: 'SRD',
    summary: 'Milky-white eyes. Blinded, and poor Wisdom.',
    lines: [
      'Pain grips the creature’s mind and its eyes turn milky white.',
      'It has disadvantage on Wisdom checks and Wisdom saving throws.',
      'It is blinded.'
    ]
  },
  {
    id: 'filth-fever',
    name: 'Filth Fever',
    meta: 'SRD',
    summary: 'A raging fever. Strength fails.',
    lines: [
      'A raging fever sweeps through the creature’s body.',
      'It has disadvantage on Strength checks, Strength saving throws, and attack rolls that use Strength.'
    ]
  },
  {
    id: 'flesh-rot',
    name: 'Flesh Rot',
    meta: 'SRD',
    summary: 'Decaying flesh. Vulnerable to everything.',
    lines: [
      'The creature’s flesh decays.',
      'It has disadvantage on Charisma checks.',
      'It has vulnerability to all damage.'
    ]
  },
  {
    id: 'mindfire',
    name: 'Mindfire',
    meta: 'SRD',
    summary: 'Feverish mind. Acts as though confused in combat.',
    lines: [
      'The creature’s mind becomes feverish.',
      'It has disadvantage on Intelligence checks and Intelligence saving throws.',
      'It behaves as if under the effects of the confusion spell during combat.'
    ]
  },
  {
    id: 'seizure',
    name: 'Seizure',
    meta: 'SRD',
    summary: 'Uncontrollable shaking. Dexterity fails.',
    lines: [
      'The creature is overcome with shaking.',
      'It has disadvantage on Dexterity checks, Dexterity saving throws, and attack rolls that use Dexterity.'
    ]
  },
  {
    id: 'slimy-doom',
    name: 'Slimy Doom',
    meta: 'SRD',
    summary: 'Uncontrolled bleeding. Stunned by any damage.',
    lines: [
      'The creature begins to bleed uncontrollably.',
      'It has disadvantage on Constitution checks and Constitution saving throws.',
      'Whenever it takes damage, it is stunned until the end of its next turn.'
    ]
  },
  {
    id: 'cackle-fever',
    name: 'Cackle Fever',
    meta: 'SRD · Humanoids only',
    summary: 'Fits of mad laughter under stress. Contagious to onlookers.',
    lines: [
      'Symptoms appear 1d4 hours after infection: fever and disorientation, and the creature gains one level of exhaustion that no rest removes until the disease is cured.',
      'Any stress — combat, damage, fright, a nightmare — forces a DC 13 Constitution saving throw.',
      'On a failure the creature takes 5 (1d10) psychic damage and becomes incapacitated with mad laughter for 1 minute.',
      'It can repeat the save at the end of each of its turns, ending the laughter on a success.',
      'Any humanoid that starts its turn within 10 feet of the laughing creature must succeed on a DC 10 Constitution saving throw or become infected.',
      'At the end of each long rest, an infected creature makes a DC 13 Constitution saving throw. On a success the DC drops by 1d6; the disease ends when the DC reaches 0.'
    ],
    note: 'Also called "the shrieks". It spreads through a crowd fast — one failed save in a tavern can seed a dozen more.'
  },
  {
    id: 'sewer-plague',
    name: 'Sewer Plague',
    meta: 'SRD',
    summary: 'Exhaustion that rest cannot shift.',
    lines: [
      'Contracted from filth, offal, or a bite from a creature that dwells in it — rats and otyughs especially. A creature exposed makes a DC 11 Constitution saving throw or becomes infected.',
      'Symptoms appear 1d4 days later: fatigue and cramps, and one level of exhaustion.',
      'The creature regains only half the normal hit points from spending Hit Dice, and no hit points from finishing a long rest.',
      'At the end of each long rest, it makes a DC 11 Constitution saving throw. On a success its exhaustion drops by one level.',
      'The disease ends once exhaustion is reduced below level 1.'
    ]
  },
  {
    id: 'sight-rot',
    name: 'Sight Rot',
    meta: 'SRD',
    summary: 'Blurring vision that ends in blindness.',
    lines: [
      'Contracted by drinking tainted water. The creature makes a DC 15 Constitution saving throw or becomes infected.',
      'One day later its vision blurs, giving a −1 penalty to attack rolls and ability checks that rely on sight.',
      'The penalty worsens by 1 after each long rest. At −5 the creature is blinded until cured.',
      'Cured by applying eyebright ointment to the eyes before a long rest — three doses cures it entirely.',
      'A dose of ointment is made from a rare flower that grows in swampland, by anyone proficient with a herbalism kit.'
    ]
  }
]
