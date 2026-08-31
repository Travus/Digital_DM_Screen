# Data packs

The reference modules ship **SRD content only**, which is all the licence allows. The SRD carries one archetype per class, so out of the box Player Abilities has Metamagic and Channel Divinity and nothing else, and the condition, rules and disease lists are the SRD versions.

A data pack adds your own content on top at runtime. It is a single JSON file named `something.dmpack.json`, kept wherever you like. It is never copied into the app, so you edit the file in place and reload it.

## Loading a pack

Everything lives under the **Data** menu.

| Command | Does |
| --- | --- |
| **Import Data Pack…** (`Cmd/Ctrl+Shift+D`) | Adds a `.dmpack.json` to the list |
| **Reload Data Packs from Disk** | Re-reads every loaded pack after you edit one |
| **Data Packs → <name> → Remove** | Drops a pack |
| **Bundled SRD Content** | Turns the shipped conditions, rules, abilities and diseases off or on |
| **Bundled Name Pools** | Turns the shipped name generator lists off or on. A pack's own pools stay |

A pack that fails to load stays in the list with the reason beside it, so a file you moved or a typo in the JSON shows up as a warning rather than as content that quietly went missing.

## What a pack can add

Reference content, name pools, or both. Everything is optional — give the pack an `id` and a `name` of its own, and add whichever sections you need.

```json
{
  "formatVersion": 1,
  "id": "my-homebrew",
  "name": "My homebrew",
  "description": "Shown in the Data menu and the sidebar summary.",

  "conditions": [ … ],
  "diseases": [ … ],
  "abilityGroups": [ … ],
  "rules": [ … ],

  "nameStyles": [ … ],
  "traits": [ … ],
  "wants": [ … ],
  "placeDetails": [ … ],
  "placeHooks": [ … ]
}
```

### Conditions and diseases

Both are plain entries, and both use the same shape. `meta` is the small tag beside the name, and `note` is the italic line under the effects. Both are optional.

```json
{
  "id": "becalmed",
  "name": "Becalmed",
  "meta": "Homebrew",
  "summary": "Cannot act on the first round of combat.",
  "lines": [
    "The creature is incapacitated until the end of its first turn.",
    "Ends early if it takes damage."
  ],
  "note": "From the Salt Marches supplement."
}
```

### Ability groups

A group is one tab in the Player Abilities panel. `title` and `blurb` are what the tab is called and the line under it, and `entries` are the same shape as a condition.

```json
{
  "id": "tidal-boons",
  "title": "Tidal Boons",
  "blurb": "Favours the marsh grants to those who bargain with it.",
  "entries": [
    {
      "id": "salt-blessing",
      "name": "Salt Blessing",
      "meta": "Salt Marches · Once per long rest",
      "summary": "Reroll a failed save while standing in salt water.",
      "lines": ["When you fail a saving throw while in contact with salt water, you may reroll it and must use the new result."]
    }
  ]
}
```

### Rules

A rule section is one tab in the Rules Reference panel. `items` are term-and-text pairs, and `tables` are captioned grids. A section can carry either, or both.

```json
{
  "id": "sailing",
  "title": "Sailing",
  "items": [{ "term": "Crewing a boat", "text": "A vessel needs half its crew slots filled to move at all, and all of them to make its full speed." }],
  "tables": [
    {
      "caption": "What the tide brings in",
      "head": ["d6", "Find"],
      "rows": [["1", "A sealed clay jar, still full."]]
    }
  ],
  "note": "Shown under the section in italics."
}
```

### Name pools

A pool is one entry in the Name Generator's dropdown. Names are built as prefix + optional middle + suffix, so the syllable lists are what you write, not whole names.

```json
{
  "id": "marshfolk",
  "label": "Marshfolk",
  "kind": "person",
  "middleChance": 0.4,
  "prefix": ["Bry", "Cass", "Del"],
  "middle": ["an", "el", "ow"],
  "suffix": ["by", "mere", "reed"]
}
```

`kind` decides what the flesh-out button does. A `person` pool gets a quirk and a motive, a `place` pool gets a telling detail and a hook, and a place joins its syllables with a space so `Sel` + `mere` reads as two words. `middleChance` is how often a middle syllable is used, from 0 to 1, and defaults to 0.35.

Only `id` is required. A pool that names an id already loaded adds its syllables to that pool, so three endings is a whole pack section:

```json
{ "id": "human", "suffix": ["stow", "hythe"] }
```

The four flesh-out lists are flat, and belong to no one pool. `traits` and `wants` are what a person is given, `placeDetails` and `placeHooks` what a place is given. Write them lowercase and unpunctuated — they are printed as they are, under the name.

```json
{
  "traits": ["salt-stained to the elbow, whatever the weather"],
  "wants": ["wants a berth on the next boat out"],
  "placeDetails": ["the floor is a foot above the waterline, and it shows"],
  "placeHooks": ["the harbourmaster drinks here and never pays"]
}
```

A pool with no `prefix` and no `suffix` has nothing to build a name from, so it is dropped with a warning rather than offered empty. A pool nobody labelled falls back to its id, and says so.

## Rules that decide what happens on a collision

**A pack adds. It never replaces.** Load two packs that both define a Salt Blessing and you get two Salt Blessing cards, because entry ids are kept separate per pack. Remove one of the packs to be rid of the duplicate.

**A group, section or name pool id that matches one already loaded extends it.** That is how you add a single option to a tab without restating the ones already there, and how the example pack adds Echoing Spell to the shipped Metamagic tab. An id nothing else uses becomes a new tab instead, so give it a `title` — or, for a pool, a `label`.

**Whichever source declares a container first decides what it is called.** A pack extending the shipped `human` pool cannot rename it, or change it from a person pool to a place one. Repeated syllables and repeated flesh-out lines are collapsed, so restating what you are extending costs nothing but does nothing either.

**Condition names must be unique across everything loaded.** The name, not the id, is what the cross-reference popovers scan prose for, and what the initiative tracker stores against a combatant. If your pack restates a condition the SRD already has, turn **Bundled SRD Content** off rather than shipping both.

**Turning the bundled content off is how you replace it wholesale.** Write a pack that covers everything you want, switch the SRD content off, and every card in the reference panels is yours. **Bundled Name Pools** works the same way for the Name Generator: turn it off with a pack loaded and the dropdown holds your pools and no others.

## A worked example

[`examples/example.dmpack.json`](../examples/example.dmpack.json) is a pack that loads, carrying one of each kind of content. Its ability groups exercise both halves of the id rule above, and its name pools do it again: one adds an option to the shipped Metamagic tab and one declares a tab of its own, while one pool is a Marshfolk pool of its own and the other adds two endings to the shipped Human one. Import it, look at what turns up in the panels, then edit the file and choose **Reload Data Packs from Disk** to watch it change.
