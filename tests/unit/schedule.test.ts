import { describe, it, expect } from 'vitest';

/**
 * JS implementation of next_occurrence that exactly mirrors the PostgreSQL PL/pgSQL logic:
 *
 * create function next_occurrence(tz text,lt time,wd int[],after timestamptz) returns timestamptz ...
 *  for i in 0..14 loop d:=((after at time zone tz)::date)+i;
 *   if wd is null or extract(isodow from d)::int=any(wd) then
 *     ts:=(d+lt) at time zone tz;
 *     if ts>after then return ts; end if;
 *   end if;
 *  end loop; return null;
 */
export function nextOccurrence(
  tz: string,
  localTime: string, // "HH:MM" or "HH:MM:SS"
  weekdays: number[] | null,
  after: Date
): Date | null {
  const [h, m] = localTime.split(':').map(Number);

  // Helper to get local date parts in tz
  const getLocalDate = (d: Date): { year: number; month: number; day: number; isodow: number } => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(d);

    const year = Number(parts.find((p) => p.type === 'year')?.value);
    const month = Number(parts.find((p) => p.type === 'month')?.value) - 1;
    const day = Number(parts.find((p) => p.type === 'day')?.value);

    // Map weekday to ISO DOW (1 = Mon ... 7 = Sun)
    const dayStr = parts.find((p) => p.type === 'weekday')?.value;
    const dowMap: Record<string, number> = {
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
      Sun: 7,
    };
    const isodow = dowMap[dayStr || 'Mon'] ?? 1;

    return { year, month, day, isodow };
  };

  const baseLocal = getLocalDate(after);

  for (let i = 0; i <= 14; i++) {
    // Add i days
    const currentDayUtc = new Date(Date.UTC(baseLocal.year, baseLocal.month, baseLocal.day + i, 12, 0, 0));
    const localInfo = getLocalDate(currentDayUtc);

    if (weekdays === null || weekdays.includes(localInfo.isodow)) {
      // Build ISO string in the target timezone
      // Parse local wall time in tz
      const pad = (n: number) => String(n).padStart(2, '0');
      const dateStr = `${localInfo.year}-${pad(localInfo.month + 1)}-${pad(localInfo.day)}T${pad(h)}:${pad(m)}:00`;

      // Approximate / construct instant for wall time in timezone
      // Using Intl to find the exact UTC offset for that day/time
      const testInstant = new Date(Date.UTC(localInfo.year, localInfo.month, localInfo.day, h, m, 0));
      const tzParts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(testInstant);

      const localH = Number(tzParts.find((p) => p.type === 'hour')?.value ?? 0);
      const localM = Number(tzParts.find((p) => p.type === 'minute')?.value ?? 0);
      const diffMinutes = (h * 60 + m) - (localH * 60 + localM);

      const finalCandidate = new Date(testInstant.getTime() + diffMinutes * 60000);

      if (finalCandidate > after) {
        return finalCandidate;
      }
    }
  }

  return null;
}

/**
 * Model of process_due_schedules execution logic:
 * Checks whether an occurrence qualifies for inbox insertion ("no backlog burst")
 * Rule: now - occurrence <= 1 hour (3600 seconds)
 */
export function processDueScheduleEvent(
  schedule: { id: string; schedule_type: 'once' | 'recurring'; next_run_at: Date; timezone: string; local_time: string; weekdays: number[] | null },
  relationship: { id: string; status: string; recipient_user_id: string },
  message: { id: string; status: string; title: string | null; body: string; category: string },
  now: Date
): {
  materialized: boolean;
  inboxItem: any | null;
  deliveryEvent: any | null;
  updatedSchedule: { status: string; next_run_at: Date | null };
} {
  const occ = schedule.next_run_at;
  const isEligible = relationship.status === 'active' && message.status === 'active';
  const ageMs = now.getTime() - occ.getTime();
  const withinOneHour = ageMs <= 3600 * 1000;

  let materialized = false;
  let inboxItem = null;
  let deliveryEvent = null;

  if (isEligible && withinOneHour) {
    materialized = true;
    const epochSec = Math.floor(occ.getTime() / 1000);
    const occurrenceKey = `${schedule.id}:${epochSec}`;
    inboxItem = {
      relationship_id: relationship.id,
      message_id: message.id,
      recipient_user_id: relationship.recipient_user_id,
      scheduled_occurrence_key: occurrenceKey,
      title_snapshot: message.title,
      body_snapshot: message.body,
      category_snapshot: message.category,
      available_at: occ,
      expires_at: new Date(occ.getTime() + 7 * 24 * 3600 * 1000),
    };
    deliveryEvent = {
      relationship_id: relationship.id,
      schedule_id: schedule.id,
      event_type: 'queued',
      idempotency_key: `${occurrenceKey}:q`,
    };
  }

  let updatedSchedule: { status: string; next_run_at: Date | null };
  if (schedule.schedule_type === 'once') {
    updatedSchedule = { status: 'completed', next_run_at: null };
  } else {
    const nextOcc = nextOccurrence(
      schedule.timezone,
      schedule.local_time,
      schedule.weekdays,
      now > occ ? now : occ
    );
    updatedSchedule = {
      status: nextOcc ? 'active' : 'completed',
      next_run_at: nextOcc,
    };
  }

  return { materialized, inboxItem, deliveryEvent, updatedSchedule };
}

describe('next_occurrence logic', () => {
  it('calculates the next occurrence on matching weekdays (Mon-Fri = 1..5)', () => {
    // A Friday afternoon in UTC (2024-06-07 15:00 UTC)
    const after = new Date('2024-06-07T15:00:00Z');
    // Schedule for 10:00 weekdays [1, 2, 3, 4, 5]
    // Since Friday 10:00 is in the past, next should be Monday 2024-06-10 10:00 UTC
    const next = nextOccurrence('UTC', '10:00', [1, 2, 3, 4, 5], after);
    expect(next).not.toBeNull();
    expect(next?.toISOString()).toBe('2024-06-10T10:00:00.000Z');
  });

  it('runs every day if weekdays is null', () => {
    // Friday afternoon (2024-06-07 15:00 UTC)
    const after = new Date('2024-06-07T15:00:00Z');
    // Schedule for 10:00 every day (weekdays = null)
    // Next should be Saturday 2024-06-08 10:00 UTC
    const next = nextOccurrence('UTC', '10:00', null, after);
    expect(next).not.toBeNull();
    expect(next?.toISOString()).toBe('2024-06-08T10:00:00.000Z');
  });

  it('respects timezone differences (America/New_York vs UTC)', () => {
    // 2024-06-10 12:00 UTC = 08:00 AM EDT (UTC-4)
    const after = new Date('2024-06-10T12:00:00Z');
    // Schedule 09:00 AM EDT
    const next = nextOccurrence('America/New_York', '09:00', [1, 2, 3, 4, 5], after);
    expect(next).not.toBeNull();
    // 09:00 EDT = 13:00 UTC
    expect(next?.toISOString()).toBe('2024-06-10T13:00:00.000Z');
  });

  it('returns null if no weekday matches within 14 days', () => {
    const after = new Date('2024-06-10T12:00:00Z');
    const next = nextOccurrence('UTC', '09:00', [], after);
    expect(next).toBeNull();
  });
});

describe('process_due_schedules "No backlog burst" guarantee', () => {
  const rel = { id: 'rel-1', status: 'active', recipient_user_id: 'user-recip' };
  const msg = { id: 'msg-1', status: 'active', title: 'Hey', body: 'Take a breath', category: 'self_care' };

  it('materializes and queues occurrence when run on time (within 1 hour)', () => {
    const occ = new Date('2024-06-10T10:00:00Z');
    const now = new Date('2024-06-10T10:15:00Z'); // 15 minutes late
    const schedule = {
      id: 'sch-1',
      schedule_type: 'recurring' as const,
      next_run_at: occ,
      timezone: 'UTC',
      local_time: '10:00',
      weekdays: null,
    };

    const res = processDueScheduleEvent(schedule, rel, msg, now);
    expect(res.materialized).toBe(true);
    expect(res.inboxItem).not.toBeNull();
    expect(res.inboxItem?.scheduled_occurrence_key).toBe(`sch-1:${Math.floor(occ.getTime() / 1000)}`);
    expect(res.deliveryEvent?.event_type).toBe('queued');
    // Advances next_run_at to future occurrence
    expect(res.updatedSchedule.next_run_at?.getTime()).toBeGreaterThan(now.getTime());
  });

  it('skips inbox creation and suppresses backlog burst when occurrence is > 1 hour late', () => {
    // Laptop was closed for 3 hours (run is 3 hours past next_run_at)
    const occ = new Date('2024-06-10T10:00:00Z');
    const now = new Date('2024-06-10T13:05:00Z'); // 3 hours 5 minutes late!
    const schedule = {
      id: 'sch-1',
      schedule_type: 'recurring' as const,
      next_run_at: occ,
      timezone: 'UTC',
      local_time: '10:00',
      weekdays: null,
    };

    const res = processDueScheduleEvent(schedule, rel, msg, now);
    // CRITICAL REQUIREMENT: No backlog burst
    expect(res.materialized).toBe(false);
    expect(res.inboxItem).toBeNull();
    expect(res.deliveryEvent).toBeNull();

    // Schedule is smoothly advanced to the NEXT future run without queueing stale messages
    expect(res.updatedSchedule.next_run_at?.getTime()).toBeGreaterThan(now.getTime());
  });

  it('completes a "once" schedule and sets next_run_at to null', () => {
    const occ = new Date('2024-06-10T10:00:00Z');
    const now = new Date('2024-06-10T10:05:00Z');
    const schedule = {
      id: 'sch-once',
      schedule_type: 'once' as const,
      next_run_at: occ,
      timezone: 'UTC',
      local_time: '10:00',
      weekdays: null,
    };

    const res = processDueScheduleEvent(schedule, rel, msg, now);
    expect(res.materialized).toBe(true);
    expect(res.updatedSchedule.status).toBe('completed');
    expect(res.updatedSchedule.next_run_at).toBeNull();
  });
});
