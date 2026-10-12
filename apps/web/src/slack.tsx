import { useState, type FormEvent } from 'react';
import { MessageSquare, RefreshCw, Save } from 'lucide-react';
import { Feedback, LoadState, useAction, useOrganization, useOrgQuery } from './organizations';

interface SlackSettings {
  available: boolean; configured: boolean; enabled: boolean; version: number; channelLabel: string;
  objectiveUpdates: boolean; notifications: boolean; pending: number; failed: number; lastSentAt: string | null; lastError: string | null;
}
export function SlackPanel() {
  const { send, reload } = useOrganization(); const query = useOrgQuery<SlackSettings>('integrations/slack', 15000);
  const action = useAction(); const [confirm, setConfirm] = useState(false);
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const value = query.data!;
    void action.run(async () => {
      await send('integrations/slack', { version: value.version, channelLabel: form.get('channelLabel'), webhookUrl: String(form.get('webhookUrl') || '') || undefined,
        enabled: form.get('enabled') === 'on', objectiveUpdates: form.get('objectiveUpdates') === 'on', notifications: form.get('notifications') === 'on' }, 'PUT');
      await reload(); return 'Slack settings saved';
    });
  };
  return <section className="admin-panel slack-panel" aria-label="Slack integration"><h2><MessageSquare size={20}/> Slack integration</h2>
    <p className="account-note">Send objective changes, progress check-ins, comments and assignment notifications to your Slack channel. Messages are visible to people in that channel. Personal mute preferences apply to in-app notifications.</p>
    <LoadState query={query}/>{query.isSuccess && <>
      <p className="account-note">{query.data.configured ? query.data.enabled ? `Sending to ${query.data.channelLabel}` : 'Slack delivery paused' : 'Slack is not connected'}</p>
      {!query.data.available && <p className="account-note">Slack integration is unavailable. Ask your host administrator to enable it.</p>}
      <form key={query.data.version} className="account-form" onSubmit={save}>
        <label className="form-field"><span>Slack channel label</span><input name="channelLabel" defaultValue={query.data.channelLabel || '#okr-updates'} required maxLength={80} disabled={!query.data.available}/></label>
        <label className="form-field"><span>{query.data.configured ? 'Replace Slack webhook (optional)' : 'Slack incoming webhook'}</span><input name="webhookUrl" type="password" autoComplete="off" placeholder={query.data.configured ? 'Leave blank to keep the saved connection' : 'Paste the webhook from Slack app settings'} required={!query.data.configured} maxLength={500} disabled={!query.data.available}/></label>
        <p className="account-note">The webhook determines the destination; the label is for reference. The saved webhook is never displayed.</p>
        <label className="checkbox-field"><input name="enabled" type="checkbox" defaultChecked={query.data.enabled} disabled={!query.data.available}/>Enable Slack delivery</label>
        <label className="checkbox-field"><input name="objectiveUpdates" type="checkbox" defaultChecked={query.data.objectiveUpdates} disabled={!query.data.available}/>Objective changes and progress updates</label>
        <label className="checkbox-field"><input name="notifications" type="checkbox" defaultChecked={query.data.notifications} disabled={!query.data.available}/>Check-ins, comments and assignment notifications</label>
        <p className="account-note">Saving settings discards unsent messages. New events use the saved settings.</p>
        <button className="primary-button" disabled={action.pending || !query.data.available}><Save size={16}/>Save Slack settings</button>
      </form>
      <div className="toolbar"><button className="secondary-button" disabled={action.pending || !query.data.available || !query.data.enabled || !query.data.configured} onClick={() => { void action.run(async () => { const result = await send('integrations/slack/test', { version: query.data!.version }); await reload(); return result.message; }); }}>Send test message</button>
        <button className="secondary-button" onClick={() => { void query.refetch(); }}><RefreshCw size={16}/>Refresh delivery status</button>
        {query.data.failed > 0 && <button className="secondary-button" disabled={action.pending || !query.data.enabled || !query.data.available} onClick={() => { void action.run(async () => { const result = await send('integrations/slack/retry', { version: query.data!.version }); await reload(); return result.message; }); }}>Retry failed messages</button>}
        {query.data.configured && <button className="secondary-button" disabled={action.pending} onClick={() => setConfirm(true)}>Disconnect Slack</button>}
      </div>
      <p className="account-note" aria-label="Slack delivery status">{query.data.pending} pending · {query.data.failed} failed{query.data.lastSentAt && ` · Last sent ${new Date(query.data.lastSentAt).toLocaleString()}`}</p>
      {query.data.lastError && <p role="alert" className="form-error">{query.data.lastError}</p>}
      {confirm && <div className="transfer-confirmation"><p>Disconnect Slack and discard unsent messages?</p><button className="secondary-button" disabled={action.pending} onClick={() => { void action.run(async () => { await send('integrations/slack', { version: query.data!.version }, 'DELETE'); setConfirm(false); await reload(); return 'Slack disconnected'; }); }}>Confirm disconnect</button><button className="secondary-button" onClick={() => setConfirm(false)}>Cancel</button></div>}
    </>}<Feedback {...action}/></section>;
}
