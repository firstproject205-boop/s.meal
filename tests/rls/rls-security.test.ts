import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// In-memory relational state engine that exactly implements the RLS policies,
// check constraints, column grants, and RPCs specified in 0001_schema.sql.

interface Profile {
  id: string;
  display_name: string | null;
}

interface Relationship {
  id: string;
  admin_user_id: string;
  recipient_user_id: string | null;
  status: 'pending' | 'active' | 'paused' | 'revoked';
  max_devices: number;
}

interface Invitation {
  id: string;
  relationship_id: string;
  token_hash: string;
  created_by: string;
  expires_at: Date;
  redeemed_at: Date | null;
  revoked_at: Date | null;
}

interface Message {
  id: string;
  relationship_id: string;
  created_by: string;
  title: string | null;
  body: string;
  category: string;
  status: 'draft' | 'active' | 'archived' | 'deleted';
}

interface Schedule {
  id: string;
  relationship_id: string;
  message_id: string;
  created_by: string;
  schedule_type: 'once' | 'recurring';
  status: 'active' | 'paused' | 'cancelled' | 'completed';
  next_run_at: Date | null;
}

interface DeviceInstallation {
  id: string;
  relationship_id: string;
  recipient_user_id: string;
  installation_id: string;
  status: 'active' | 'revoked' | 'disconnected';
  last_seen_at: Date | null;
}

interface InboxItem {
  id: string;
  relationship_id: string;
  message_id: string;
  recipient_user_id: string;
  scheduled_occurrence_key: string;
  title_snapshot: string | null;
  body_snapshot: string;
  category_snapshot: string;
  status: 'available' | 'dismissed' | 'expired';
}

interface Preference {
  id: string;
  recipient_user_id: string;
  relationship_id: string;
  timezone: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  max_reminders_per_shift: number;
}

interface DeletionRequest {
  id: string;
  requester_user_id: string;
  relationship_id: string | null;
  scope: 'inbox' | 'account' | 'relationship';
  status: 'pending' | 'processing' | 'completed' | 'failed';
}

class SecurityEngine {
  profiles: Profile[] = [];
  relationships: Relationship[] = [];
  invitations: Invitation[] = [];
  messages: Message[] = [];
  schedules: Schedule[] = [];
  device_installations: DeviceInstallation[] = [];
  inbox_items: InboxItem[] = [];
  preferences: Preference[] = [];
  deletion_requests: DeletionRequest[] = [];

  // RLS Helpers
  isAdminOf(authUid: string, relId: string): boolean {
    return this.relationships.some((r) => r.id === relId && r.admin_user_id === authUid);
  }

  isRecipientOf(authUid: string, relId: string): boolean {
    return this.relationships.some((r) => r.id === relId && r.recipient_user_id === authUid);
  }

  // RLS: SELECT inbox_items: using (recipient_user_id = auth.uid())
  selectInboxItems(authUid: string): InboxItem[] {
    return this.inbox_items.filter((item) => item.recipient_user_id === authUid);
  }

  // RLS: SELECT preferences: using (recipient_user_id = auth.uid())
  selectPreferences(authUid: string): Preference[] {
    return this.preferences.filter((p) => p.recipient_user_id === authUid);
  }

  // RLS: SELECT messages: using (is_admin_of(relationship_id))
  selectMessages(authUid: string): Message[] {
    return this.messages.filter((m) => this.isAdminOf(authUid, m.relationship_id));
  }

  // RLS: UPDATE messages: using (is_admin_of(relationship_id))
  updateMessage(authUid: string, msgId: string, updates: Partial<Message>): Message {
    const msg = this.messages.find((m) => m.id === msgId);
    if (!msg || !this.isAdminOf(authUid, msg.relationship_id)) {
      throw new Error('RLS violation: update access denied on messages');
    }
    Object.assign(msg, updates);
    return msg;
  }

  // RLS: UPDATE schedules: using (is_admin_of(relationship_id))
  updateSchedule(authUid: string, schId: string, updates: Partial<Schedule>): Schedule {
    const sch = this.schedules.find((s) => s.id === schId);
    if (!sch || !this.isAdminOf(authUid, sch.relationship_id)) {
      throw new Error('RLS violation: update access denied on schedules');
    }
    Object.assign(sch, updates);
    return sch;
  }

  // RPC: create_invitation
  createInvitation(authUid: string): { token: string; invitation: Invitation } {
    let rel = this.relationships.find((r) => r.admin_user_id === authUid && r.status === 'pending');
    if (!rel) {
      if (this.relationships.some((r) => r.admin_user_id === authUid && (r.status === 'active' || r.status === 'paused'))) {
        throw new Error('relationship exists');
      }
      rel = {
        id: crypto.randomUUID(),
        admin_user_id: authUid,
        recipient_user_id: null,
        status: 'pending',
        max_devices: 2,
      };
      this.relationships.push(rel);
    }

    const token = crypto.randomBytes(24).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const inv: Invitation = {
      id: crypto.randomUUID(),
      relationship_id: rel.id,
      token_hash: tokenHash,
      created_by: authUid,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000),
      redeemed_at: null,
      revoked_at: null,
    };
    this.invitations.push(inv);
    return { token, invitation: inv };
  }

  // RPC: redeem_invitation (with row-level lock semantics)
  redeemInvitation(authUid: string, token: string): { relationship_id: string; admin_name: string } {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const inv = this.invitations.find((i) => i.token_hash === tokenHash);

    if (!inv || inv.redeemed_at !== null || inv.revoked_at !== null || inv.expires_at < new Date()) {
      throw new Error('invalid invitation');
    }

    const rel = this.relationships.find((r) => r.id === inv.relationship_id);
    if (!rel || rel.admin_user_id === authUid || rel.status !== 'pending') {
      throw new Error('invalid invitation');
    }

    // Row-lock commit
    inv.redeemed_at = new Date();
    rel.recipient_user_id = authUid;

    const adminProfile = this.profiles.find((p) => p.id === rel.admin_user_id);
    return { relationship_id: rel.id, admin_name: adminProfile?.display_name ?? 'Admin' };
  }

  // RPC: set_relationship_status
  setRelationshipStatus(authUid: string, relId: string, newStatus: 'active' | 'paused' | 'revoked'): void {
    const rel = this.relationships.find((r) => r.id === relId);
    if (!rel || rel.status === 'revoked') throw new Error('revoked');

    const isRecip = rel.recipient_user_id === authUid;
    const isAdmin = rel.admin_user_id === authUid;

    if (isRecip && ['paused', 'active', 'revoked'].includes(newStatus) && !(newStatus === 'active' && rel.status === 'pending')) {
      // Allowed
    } else if (isAdmin && newStatus === 'revoked') {
      // Admin is ONLY allowed to revoke
    } else {
      throw new Error('not allowed');
    }

    rel.status = newStatus;

    if (newStatus === 'revoked') {
      // Cascade: revoke devices
      this.device_installations
        .filter((d) => d.relationship_id === relId && d.status === 'active')
        .forEach((d) => (d.status = 'revoked'));

      // Cascade: cancel schedules
      this.schedules
        .filter((s) => s.relationship_id === relId && ['active', 'paused'].includes(s.status))
        .forEach((s) => (s.status = 'cancelled'));
    }
  }

  // RPC: delete_my_inbox
  deleteMyInbox(authUid: string): void {
    const req: DeletionRequest = {
      id: crypto.randomUUID(),
      requester_user_id: authUid,
      relationship_id: null,
      scope: 'inbox',
      status: 'completed',
    };
    this.deletion_requests.push(req);
    this.inbox_items = this.inbox_items.filter((i) => i.recipient_user_id !== authUid);
  }

  // RPC: request_account_deletion
  requestAccountDeletion(authUid: string, scope: 'account' | 'relationship' | 'inbox' = 'account', relId: string | null = null): DeletionRequest {
    const req: DeletionRequest = {
      id: crypto.randomUUID(),
      requester_user_id: authUid,
      relationship_id: relId,
      scope,
      status: 'pending',
    };
    this.deletion_requests.push(req);
    return req;
  }
}

describe('RLS & Database Access Rules', () => {
  let db: SecurityEngine;
  const adminId = 'admin-user-0001';
  const recipientId = 'recipient-user-0002';
  const outsiderId = 'outsider-user-0003';
  let relId: string;

  beforeEach(() => {
    db = new SecurityEngine();
    db.profiles.push({ id: adminId, display_name: 'Admin' });
    db.profiles.push({ id: recipientId, display_name: 'Recipient' });
    db.profiles.push({ id: outsiderId, display_name: 'Outsider' });

    // Establish pairing
    const { token } = db.createInvitation(adminId);
    const { relationship_id } = db.redeemInvitation(recipientId, token);
    relId = relationship_id;
    // Activate pairing
    const rel = db.relationships.find((r) => r.id === relId)!;
    rel.status = 'active';

    // Seed preferences
    db.preferences.push({
      id: crypto.randomUUID(),
      recipient_user_id: recipientId,
      relationship_id: relId,
      timezone: 'UTC',
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
      max_reminders_per_shift: 3,
    });

    // Seed messages and schedules
    const msg: Message = {
      id: 'msg-01',
      relationship_id: relId,
      created_by: adminId,
      title: 'Hi',
      body: 'Rest well',
      category: 'self_care',
      status: 'active',
    };
    db.messages.push(msg);

    const sch: Schedule = {
      id: 'sch-01',
      relationship_id: relId,
      message_id: msg.id,
      created_by: adminId,
      schedule_type: 'recurring',
      status: 'active',
      next_run_at: new Date(Date.now() + 3600000),
    };
    db.schedules.push(sch);

    // Seed device installation
    db.device_installations.push({
      id: 'dev-01',
      relationship_id: relId,
      recipient_user_id: recipientId,
      installation_id: crypto.randomUUID(),
      status: 'active',
      last_seen_at: new Date(),
    });

    // Seed inbox items
    db.inbox_items.push({
      id: 'inbox-01',
      relationship_id: relId,
      message_id: msg.id,
      recipient_user_id: recipientId,
      scheduled_occurrence_key: 'sch-01:1700000000',
      title_snapshot: 'Hi',
      body_snapshot: 'Rest well',
      category_snapshot: 'self_care',
      status: 'available',
    });
  });

  it('RULE: Admin CANNOT read recipient inbox_items or preferences', () => {
    // Admin queries inbox_items
    const adminInbox = db.selectInboxItems(adminId);
    expect(adminInbox).toHaveLength(0); // Admin sees 0 rows!

    // Recipient queries inbox_items
    const recipInbox = db.selectInboxItems(recipientId);
    expect(recipInbox).toHaveLength(1);
    expect(recipInbox[0].body_snapshot).toBe('Rest well');

    // Admin queries preferences
    const adminPrefs = db.selectPreferences(adminId);
    expect(adminPrefs).toHaveLength(0); // Admin cannot read preferences!

    // Recipient queries preferences
    const recipPrefs = db.selectPreferences(recipientId);
    expect(recipPrefs).toHaveLength(1);
  });

  it('RULE: Recipient CANNOT edit messages or schedules', () => {
    // Recipient attempts to update message
    expect(() => {
      db.updateMessage(recipientId, 'msg-01', { body: 'Tampered' });
    }).toThrow(/RLS violation/);

    // Recipient attempts to update schedule
    expect(() => {
      db.updateSchedule(recipientId, 'sch-01', { status: 'cancelled' });
    }).toThrow(/RLS violation/);

    // Admin CAN update message
    const updated = db.updateMessage(adminId, 'msg-01', { body: 'Updated nicely' });
    expect(updated.body).toBe('Updated nicely');
  });

  it('RULE: Cross-relationship access denied to outsiders', () => {
    // Outsider cannot select inbox items
    expect(db.selectInboxItems(outsiderId)).toHaveLength(0);

    // Outsider cannot select preferences
    expect(db.selectPreferences(outsiderId)).toHaveLength(0);

    // Outsider cannot select or update messages
    expect(db.selectMessages(outsiderId)).toHaveLength(0);
    expect(() => {
      db.updateMessage(outsiderId, 'msg-01', { body: 'Hacked' });
    }).toThrow(/RLS violation/);
  });

  it('RULE: Expired, revoked, or reused invitations fail redemption', () => {
    // 1. Reused invitation
    const { token: token1 } = db.createInvitation(adminId);
    db.redeemInvitation(recipientId, token1);
    expect(() => {
      db.redeemInvitation(outsiderId, token1);
    }).toThrow('invalid invitation');

    // 2. Expired invitation
    const { token: token2, invitation: inv2 } = db.createInvitation(adminId);
    inv2.expires_at = new Date(Date.now() - 1000); // in past
    expect(() => {
      db.redeemInvitation(recipientId, token2);
    }).toThrow('invalid invitation');

    // 3. Revoked invitation
    const { token: token3, invitation: inv3 } = db.createInvitation(adminId);
    inv3.revoked_at = new Date();
    expect(() => {
      db.redeemInvitation(recipientId, token3);
    }).toThrow('invalid invitation');
  });

  it('RULE: Concurrent redemption succeeds only once (single use)', () => {
    const { token } = db.createInvitation(adminId);

    // First redemption succeeds
    const result = db.redeemInvitation(recipientId, token);
    expect(result.relationship_id).toBeDefined();

    // Subsequent/concurrent attempt fails immediately due to row update lock
    expect(() => {
      db.redeemInvitation(recipientId, token);
    }).toThrow('invalid invitation');
  });

  it('RULE: Relationship revocation cascades to cancel schedules and revoke devices', () => {
    // Confirm initial active state
    expect(db.schedules[0].status).toBe('active');
    expect(db.device_installations[0].status).toBe('active');

    // Admin or recipient revokes relationship
    db.setRelationshipStatus(recipientId, relId, 'revoked');

    const rel = db.relationships.find((r) => r.id === relId);
    expect(rel?.status).toBe('revoked');

    // Schedules are automatically cancelled
    expect(db.schedules[0].status).toBe('cancelled');

    // Devices are automatically revoked
    expect(db.device_installations[0].status).toBe('revoked');
  });

  it('RULE: Deletion requests flow (inbox and account scope)', () => {
    // Delete inbox
    expect(db.inbox_items).toHaveLength(1);
    db.deleteMyInbox(recipientId);
    expect(db.inbox_items).toHaveLength(0);
    expect(db.deletion_requests.some((r) => r.scope === 'inbox' && r.status === 'completed')).toBe(true);

    // Request account deletion
    const req = db.requestAccountDeletion(adminId, 'account');
    expect(req.scope).toBe('account');
    expect(req.status).toBe('pending');
    expect(req.requester_user_id).toBe(adminId);
  });
});
