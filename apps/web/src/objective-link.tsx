import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAccount } from './accounts';
import { useOrganization } from './organizations';

export function ObjectiveOrganizationLink() {
  const { orgId, id } = useParams(); const { account } = useAccount(); const { select } = useOrganization(); const navigate = useNavigate();
  const allowed = account.memberships.some(m => m.org.id === orgId);
  useEffect(() => { if (allowed && orgId && id) { select(orgId); navigate(`/objectives/${id}`, { replace: true }); } }, [allowed, orgId, id, navigate]);
  return allowed ? <p role="status">Opening objective…</p> : <div role="alert"><p>This organization is unavailable to your account.</p><Link to="/overview">Back to overview</Link></div>;
}
