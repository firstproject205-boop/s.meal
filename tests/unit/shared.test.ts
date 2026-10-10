import { describe, it, expect } from 'vitest';
import {
  shiftWindowMs,
  inWindow,
  inQuietHours,
  underCap,
  localMinutes,
  Prefs,
} from '../../extension/src/shared';

const basePrefs: Prefs = {
  relationship_id: '11111111-1111-1111-1111-111111111111',
  timezone: 'UTC',
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  max_reminders_per_shift: 3,
  shift_start: '09:00',
  shift_end: '17:00',
  notifications_enabled: true,
  show_message_content_in_notifications: false,
  companion_enabled: true,
  sound_enabled: false,
  reduced_motion: false,
};

describe('shiftWindowMs', () => {
  it('calculates duration for regular day shifts (09:00 - 17:00 = 8h)', () => {
    const ms = shiftWindowMs({ ...basePrefs, shift_start: '09:00', shift_end: '17:00' });
    expect(ms).toBe(8 * 3600 * 1000);
  });

  it('calculates duration for overnight shifts crossing midnight (22:00 - 06:00 = 8h)', () => {
    const ms = shiftWindowMs({ ...basePrefs, shift_start: '22:00', shift_end: '06:00' });
    expect(ms).toBe(8 * 3600 * 1000);
  });

  it('calculates duration for overnight shifts (23:30 - 07:30 = 8h)', () => {
    const ms = shiftWindowMs({ ...basePrefs, shift_start: '23:30', shift_end: '07:30' });
    expect(ms).toBe(8 * 3600 * 1000);
  });

  it('defaults to 24h when shift_start or shift_end is null', () => {
    expect(shiftWindowMs({ ...basePrefs, shift_start: null, shift_end: '17:00' })).toBe(24 * 3600 * 1000);
    expect(shiftWindowMs({ ...basePrefs, shift_start: '09:00', shift_end: null })).toBe(24 * 3600 * 1000);
    expect(shiftWindowMs({ ...basePrefs, shift_start: null, shift_end: null })).toBe(24 * 3600 * 1000);
  });

  it('returns 24h when start and end are identical (e.g. 09:00 - 09:00)', () => {
    expect(shiftWindowMs({ ...basePrefs, shift_start: '09:00', shift_end: '09:00' })).toBe(24 * 3600 * 1000);
  });
});

describe('inWindow', () => {
  it('evaluates daytime window correctly (13:00 - 15:00 = 780 to 900 mins)', () => {
    expect(inWindow(779, '13:00', '15:00')).toBe(false);
    expect(inWindow(780, '13:00', '15:00')).toBe(true);  // inclusive start
    expect(inWindow(840, '13:00', '15:00')).toBe(true);  // middle
    expect(inWindow(900, '13:00', '15:00')).toBe(false); // exclusive end
  });

  it('evaluates overnight window crossing midnight (22:00 - 07:00 = 1320 to 420 mins)', () => {
    expect(inWindow(1319, '22:00', '07:00')).toBe(false); // 21:59
    expect(inWindow(1320, '22:00', '07:00')).toBe(true);  // 22:00
    expect(inWindow(1400, '22:00', '07:00')).toBe(true);  // 23:20
    expect(inWindow(0, '22:00', '07:00')).toBe(true);     // 00:00
    expect(inWindow(419, '22:00', '07:00')).toBe(true);   // 06:59
    expect(inWindow(420, '22:00', '07:00')).toBe(false);  // 07:00
    expect(inWindow(720, '22:00', '07:00')).toBe(false);  // 12:00
  });

  it('returns false when start or end is null', () => {
    expect(inWindow(800, null, '17:00')).toBe(false);
    expect(inWindow(800, '09:00', null)).toBe(false);
    expect(inWindow(800, null, null)).toBe(false);
  });
});

describe('inQuietHours with timezone and DST transitions', () => {
  it('correctly calculates localMinutes across different timezones', () => {
    const date = new Date('2024-06-15T12:30:00Z');
    expect(localMinutes('UTC', date)).toBe(12 * 60 + 30);
    expect(localMinutes('Asia/Kolkata', date)).toBe(18 * 60 + 0); // UTC+5:30
    expect(localMinutes('America/New_York', date)).toBe(8 * 60 + 30); // EDT (UTC-4)
  });

  it('handles DST spring-forward and fall-back transition dates', () => {
    // EDT transition: March 10, 2024 (clocks jump from 01:59 to 03:00)
    const postSpringForward = new Date('2024-03-10T08:00:00Z'); // 04:00 AM EDT
    expect(localMinutes('America/New_York', postSpringForward)).toBe(4 * 60);

    // Fall back: November 3, 2024 (clocks move back from 01:59 to 01:00)
    const winterDate = new Date('2024-11-04T12:00:00Z'); // 07:00 AM EST (UTC-5)
    expect(localMinutes('America/New_York', winterDate)).toBe(7 * 60);
  });

  it('evaluates inQuietHours in local recipient timezone', () => {
    const prefs: Prefs = {
      ...basePrefs,
      timezone: 'America/New_York',
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
    };

    // 03:00 UTC = 23:00 NY (inside quiet hours)
    expect(inQuietHours(prefs, new Date('2024-01-15T04:00:00Z'))).toBe(true);

    // 17:00 UTC = 12:00 NY (outside quiet hours)
    expect(inQuietHours(prefs, new Date('2024-01-15T17:00:00Z'))).toBe(false);
  });

  it('returns false if quiet hours are not configured', () => {
    const prefs: Prefs = { ...basePrefs, quiet_hours_start: null, quiet_hours_end: null };
    expect(inQuietHours(prefs, new Date())).toBe(false);
  });
});

describe('underCap', () => {
  const now = 1700000000000;
  const eightHoursMs = 8 * 3600 * 1000;

  it('allows notification when stamps count is below limit', () => {
    const p: Prefs = { ...basePrefs, shift_start: '09:00', shift_end: '17:00', max_reminders_per_shift: 3 };
    const stamps = [now - 1000, now - 5000]; // 2 reminders within shift
    expect(underCap(p, stamps, now)).toBe(true);
  });

  it('blocks notification when cap is reached', () => {
    const p: Prefs = { ...basePrefs, shift_start: '09:00', shift_end: '17:00', max_reminders_per_shift: 3 };
    const stamps = [now - 1000, now - 5000, now - 10000]; // 3 reminders within shift
    expect(underCap(p, stamps, now)).toBe(false);
  });

  it('discounts timestamps outside the shift window', () => {
    const p: Prefs = { ...basePrefs, shift_start: '09:00', shift_end: '17:00', max_reminders_per_shift: 2 };
    // One old reminder (9 hours ago), one recent reminder (1 hour ago)
    const stamps = [now - (eightHoursMs + 3600000), now - 3600000];
    expect(underCap(p, stamps, now)).toBe(true);
  });

  it('blocks all notifications if max_reminders_per_shift is 0', () => {
    const p: Prefs = { ...basePrefs, max_reminders_per_shift: 0 };
    expect(underCap(p, [], now)).toBe(false);
  });
});
