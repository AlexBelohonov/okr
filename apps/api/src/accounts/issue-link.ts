import { parseArgs } from 'node:util';
import { z } from 'zod';
import { email, roles } from '@okr/shared';
import { db } from '../db.js';
import { accountConfig, lockUser } from './security.js';
import { issueAction, issueInvitation } from './tokens.js';
import { lockOrganization } from '../organizations/access.js';

// This is a trusted host-operator command, not an HTTP authorization bypass.
try {
  const { values } = parseArgs({ options: { type: { type: 'string' }, org: { type: 'string' }, actor: { type: 'string' }, email: { type: 'string' }, role: { type: 'string', default: 'member' }, send: { type: 'boolean', default: false } } });
  const type = z.enum(['reset', 'invite']).parse(values.type);
  const orgId = z.string().uuid().parse(values.org);
  const actorEmail = email.parse(values.actor);
  const targetEmail = email.parse(values.email);
  const role = z.enum(roles).exclude(['owner']).parse(values.role);
  const config = accountConfig();
  if (values.send && config.emailMode !== 'smtp') throw new Error('--send requires EMAIL_MODE=smtp');
  const link = await db.$transaction(async tx => {
    const actor = await tx.user.findUniqueOrThrow({ where: { email: actorEmail } });
    const target = type === 'reset' ? await tx.user.findUniqueOrThrow({ where: { email: targetEmail } }) : null;
    // Lock every involved account in stable order before the organization. A reset
    // must not hold an org lock while waiting for a member's session/write lock.
    for (const id of [...new Set([actor.id, ...(target ? [target.id] : [])])].sort()) await lockUser(tx, id);
    await lockOrganization(tx, orgId);
    const membership = await tx.membership.findUnique({ where: { orgId_userId: { orgId, userId: actor.id } }, include: { org: true, user: true } });
    if (!membership?.active || !membership.org.active || !membership.user.active || !['owner', 'admin'].includes(membership.role)) throw new Error('Actor must be an active owner/admin of the organization');
    let result: string;
    if (type === 'reset') {
      const current = await tx.user.findUniqueOrThrow({ where: { id: target!.id } });
      const member = await tx.membership.findUnique({ where: { orgId_userId: { orgId, userId: current.id } } });
      if (!member?.active || !current.active) throw new Error('Target must be an active account and organization member');
      result = await issueAction(tx, current.id, 'reset', current.email, config, values.send!);
    } else result = await issueInvitation(tx, orgId, targetEmail, role, config, values.send!);
    await tx.auditEvent.create({ data: { orgId, userId: actor.id, type: type === 'reset' ? 'operator_reset_issued' : 'operator_invitation_issued', text: `Trusted host operator issued ${type} link`, data: { email: targetEmail, delivered: values.send! } } });
    return result;
  });
  process.stdout.write(`${link}\n`);
} catch { process.stderr.write('Link not issued. Check arguments, active account/membership, organization, and SMTP mode.\n'); process.exitCode = 1; }
finally { await db.$disconnect(); }
