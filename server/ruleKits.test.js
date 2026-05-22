// server/ruleKits.test.js — Phase 6c. Pins catalog integrity: every preset
// composes only REAL theme/mode/toggle values (so selectRuleKit can never set
// an illegal field), and listKits exposes only the display shape.
const ruleKits = require('./ruleKits');
const { RULE_KITS, getKit, listKits } = ruleKits;
const themesSystem = require('./systems/themesSystem');

const VALID_MODES = ['classic', 'team', 'solo', 'speed'];

describe('RULE_KITS catalog integrity', () => {
  test('has 6 well-formed, unique-id entries composing only real values', () => {
    expect(Array.isArray(RULE_KITS)).toBe(true);
    expect(RULE_KITS.length).toBe(6);
    for (const k of RULE_KITS) {
      expect(typeof k.id).toBe('string');
      expect(typeof k.label).toBe('string');
      expect(typeof k.icon).toBe('string');
      expect(themesSystem.isValidTheme(k.theme)).toBe(true);
      expect(VALID_MODES).toContain(k.mode);
      expect(typeof k.hardcore).toBe('boolean');
      expect(typeof k.tvShows).toBe('boolean');
    }
    const ids = RULE_KITS.map(k => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('classic_open is the all-defaults reset kit', () => {
    const k = getKit('classic_open');
    expect(k).toMatchObject({ theme: 'any', mode: 'classic', hardcore: false, tvShows: false });
  });
});

describe('getKit + listKits', () => {
  test('getKit returns the kit or null', () => {
    expect(getKit('date_night')).toBeTruthy();
    expect(getKit('does_not_exist')).toBeNull();
    expect(getKit(undefined)).toBeNull();
  });

  test('listKits returns only id/label/icon display rows', () => {
    const list = listKits();
    expect(list.length).toBe(6);
    for (const row of list) {
      expect(Object.keys(row).sort()).toEqual(['icon', 'id', 'label']);
    }
  });
});
