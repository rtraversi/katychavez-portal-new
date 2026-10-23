// "Pick one" checkbox groups on USCIS forms (Drafter 1.0.3, RT-15).
// Plain script: sets window.PickOne in the browser (the form editor in
// pages/clients/detail/detail.js) and module.exports in Node
// (scripts/validate-field-map.js). No DOM.
//
// USCIS marks a pick-one question in the PDF's form layer: its boxes share one
// field name and differ only in the value each stands for. The I-765's Part 1
// boxes are all "Part1_Checkbox", values 1, 2 and 3 ("select only one box").
// The portal strips that layer, which leaves Part1_Checkbox[0], [1], [2]:
// three separate boxes that can all be ticked. So: names equal apart from the
// final [n], with different export values, are one group. The same name with
// the SAME value is the same answer printed twice, and is left alone.
'use strict';

(function (root) {
  // "form1[0].Page1[0].Part1_Checkbox[2]" -> "form1[0].Page1[0].Part1_Checkbox"
  function groupKey(name) {
    return String(name).replace(/\[\d+\]$/, '');
  }

  // boxes: [{ name, exportValue }], one per widget (a field may repeat).
  // Returns Map(groupKey -> [{ name, exportValue }]) of the pick-one groups:
  // at least two different export values under one key.
  function pickOneGroups(boxes) {
    const byKey = new Map();
    for (const b of boxes || []) {
      if (!b || b.name == null || b.exportValue == null || b.exportValue === '') continue;
      const key = groupKey(b.name);
      if (key === b.name) continue; // no [n] index: not part of a numbered set
      const list = byKey.get(key) || [];
      if (!list.some((x) => x.name === b.name && x.exportValue === b.exportValue)) list.push({ name: b.name, exportValue: String(b.exportValue) });
      byKey.set(key, list);
    }
    const groups = new Map();
    for (const [key, list] of byKey) {
      if (new Set(list.map((b) => b.exportValue)).size > 1) groups.set(key, list);
    }
    return groups;
  }

  // The boxes to untick when `name` is ticked: the rest of its group whose
  // export value differs (a repeat of the same answer stays as it is).
  function othersInGroup(boxes, name) {
    const group = pickOneGroups(boxes).get(groupKey(name));
    if (!group) return [];
    const mine = new Set(group.filter((b) => b.name === name).map((b) => b.exportValue));
    return [...new Set(group.filter((b) => b.name !== name && !mine.has(b.exportValue)).map((b) => b.name))];
  }

  // A field_map entry that could tick its box: a data source (its value is
  // only known per client), or a literal that reads as true. "blank" and a
  // false literal never tick it.
  function couldBeTrue(descriptor) {
    const source = descriptor && descriptor.source;
    if (typeof source !== 'string' || source === 'blank') return false;
    if (source.startsWith('literal:')) return ['true', 'yes'].includes(source.slice('literal:'.length).trim().toLowerCase());
    return true;
  }

  // Transforms that each pick one option of the same value, so boxes reading
  // ONE source through different members can never be true together (the
  // Apt/Ste/Flr boxes all read address_line2; see applyTransform).
  const EXCLUSIVE = [['unit_is_apt', 'unit_is_ste', 'unit_is_flr'], ['yes_no', 'yes_no_invert']];
  const family = (t) => EXCLUSIVE.findIndex((f) => f.includes(t));

  function exclusive(a, b) {
    if (!a || !b || a.source !== b.source || !a.transform || !b.transform || a.transform === b.transform) return false;
    const fa = family(a.transform);
    return fa !== -1 && fa === family(b.transform);
  }

  // For scripts/validate-field-map.js: the pick-one groups where the map could
  // tick more than one answer at once. Returns [{ group, names }].
  function mapConflicts(fieldMap, boxes) {
    const map = fieldMap || {};
    const out = [];
    for (const [key, group] of pickOneGroups(boxes)) {
      const live = group.filter((b) => couldBeTrue(map[b.name]));
      const clash = new Set();
      for (const a of live) {
        for (const b of live) {
          if (a.exportValue !== b.exportValue && !exclusive(map[a.name], map[b.name])) { clash.add(a.name); clash.add(b.name); }
        }
      }
      if (clash.size) out.push({ group: key, names: [...clash] });
    }
    return out;
  }

  const api = { groupKey, pickOneGroups, othersInGroup, couldBeTrue, mapConflicts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PickOne = api;
})(typeof window !== 'undefined' ? window : globalThis);
