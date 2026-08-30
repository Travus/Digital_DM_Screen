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
| **Bundled Name Pools** | Turns the shipped name generator lists off or on |

A pack that fails to load stays in the list with the reason beside it, so a file you moved or a typo in the JSON shows up as a warning rather than as content that quietly went missing.

## What a pack can add

Four kinds of content, all optional. Give the pack an `id` and a `name` of its own, and add whichever of the four you need.

```json
{
  "formatVersion": 1,
  "id": "my-homebrew",
  "name": "My homebrew",
  "description": "Shown in the Data menu and the sidebar summary.",

  "conditions": [ … ],
  "diseases": [ … ],
  "abilityGroups": [ … ],
  "rules": [ … ]
}
```

The name generator's pools are not one of them. A pack cannot carry names, so **Bundled Name Pools** only turns the shipped ones off, and the panel then says it has nothing to draw from. That switch is an off switch for the module rather than a way to make room for your own lists.

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

## Rules that decide what happens on a collision

**A pack adds. It never replaces.** Load two packs that both define a Salt Blessing and you get two Salt Blessing cards, because entry ids are kept separate per pack. Remove one of the packs to be rid of the duplicate.

**A group or section id that matches one already loaded extends it.** That is how you add a single option to a tab without restating the ones already there, and how the example pack adds Echoing Spell to the shipped Metamagic tab. An id nothing else uses becomes a new tab instead, so give it a `title`.

**Condition names must be unique across everything loaded.** The name, not the id, is what the cross-reference popovers scan prose for, and what the initiative tracker stores against a combatant. If your pack restates a condition the SRD already has, turn **Bundled SRD Content** off rather than shipping both.

**Turning the bundled content off is how you replace it wholesale.** Write a pack that covers everything you want, switch the SRD content off, and every card in the reference panels is yours.

## A worked example

[`examples/example.dmpack.json`](../examples/example.dmpack.json) is a pack that loads, carrying one of each of the four kinds of content. Its ability groups exercise both halves of the id rule above: one adds an option to the shipped Metamagic tab, and one declares a tab of its own. Import it, look at what turns up in the panels, then edit the file and choose **Reload Data Packs from Disk** to watch it change.
