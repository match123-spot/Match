'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, listOrganizations, updateOrganizationStatus } from '@/lib/api';

const STATUS_TABS = ['pending', 'approved', 'suspended'];

export default function AdminPage() {
  const router = useRouter();
  const tokenRef = useRef(null);
  const [tab, setTab] = useState('pending');
  const [orgs, setOrgs] = useState(null);
  const [error, setError] = useState('');
  const [actingId, setActingId] = useState(null);

  async function refresh(status) {
    try {
      const data = await listOrganizations(tokenRef.current, status);
      setOrgs(data.organizations);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    const tok = localStorage.getItem('fc_token');
    if (!tok) {
      router.push('/login');
      return;
    }
    tokenRef.current = tok;

    getMe(tok)
      .then((data) => {
        if (data.user.role !== 'admin') {
          router.push('/dashboard');
          return;
        }
        return refresh(tab);
      })
      .catch(() => router.push('/login'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (tokenRef.current) refresh(tab);
  }, [tab]);

  async function handleSetStatus(orgId, status) {
    setError('');
    setActingId(orgId);
    try {
      await updateOrganizationStatus(tokenRef.current, orgId, status);
      await refresh(tab);
    } catch (err) {
      setError(err.message);
    } finally {
      setActingId(null);
    }
  }

  if (orgs === null) return <p className="p-8 text-sm text-gray-500">Loading…</p>;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Organizations</h1>
        <a href="/dashboard" className="text-sm text-gray-500 underline">
          Back to dashboard
        </a>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        New shipper/carrier signups land here pending approval before they can post shipments or offer capacity.
      </p>

      <div className="mt-6 flex gap-1 rounded-lg border border-gray-200 p-1 w-fit">
        {STATUS_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium capitalize ${
              tab === t ? 'bg-black text-white' : 'text-gray-600'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 flex flex-col gap-2">
        {orgs.length === 0 ? (
          <p className="text-sm text-gray-500">No {tab} organizations.</p>
        ) : (
          orgs.map((org) => (
            <div key={org.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-4">
              <div>
                <p className="font-medium">
                  {org.company_name} <span className="font-normal text-gray-500 capitalize">({org.type})</span>
                </p>
                <p className="text-xs text-gray-500">
                  Created {new Date(org.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex gap-2">
                {org.status !== 'approved' && (
                  <button
                    onClick={() => handleSetStatus(org.id, 'approved')}
                    disabled={actingId === org.id}
                    className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Approve
                  </button>
                )}
                {org.status !== 'suspended' && (
                  <button
                    onClick={() => handleSetStatus(org.id, 'suspended')}
                    disabled={actingId === org.id}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                  >
                    Suspend
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
