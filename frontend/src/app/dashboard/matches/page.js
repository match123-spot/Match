'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listMyMatches, approveMatch, rejectMatch } from '@/lib/api';

const STATUS_LABELS = {
  pending: 'Awaiting approval',
  shipper_approved: 'Shipper approved — waiting on carrier',
  carrier_approved: 'Carrier approved — waiting on shipper',
  dual_approved: 'Both approved — booking…',
  booked: 'Booked',
  rejected: 'Rejected (auto-rematch triggered)',
  expired: 'Expired (auto-rematch triggered)',
};

const OPEN_STATUSES = ['pending', 'shipper_approved', 'carrier_approved'];

function formatCountdown(deadline, now) {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return 'Expired';
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default function MatchesPage() {
  const router = useRouter();
  const tokenRef = useRef(null);
  const [role, setRole] = useState(null);
  const [matches, setMatches] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState(null);
  const [now, setNow] = useState(null);

  async function refresh() {
    try {
      const data = await listMyMatches(tokenRef.current);
      setMatches(data.matches);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    const tok = localStorage.getItem('fc_token');
    const role = localStorage.getItem('fc_role');
    if (!tok) {
      router.push('/login');
      return;
    }
    tokenRef.current = tok;

    listMyMatches(tok)
      .then((data) => {
        setRole(role);
        setNow(Date.now());
        setMatches(data.matches);
      })
      .catch((err) => {
        setRole(role);
        setNow(Date.now());
        setError(err.message);
      })
      .finally(() => setLoading(false));

    const refreshTimer = setInterval(refresh, 5000);
    const tickTimer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(refreshTimer);
      clearInterval(tickTimer);
    };
  }, [router]);

  async function handleApprove(id) {
    setError('');
    setActingId(id);
    try {
      await approveMatch(tokenRef.current, id);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setActingId(null);
    }
  }

  async function handleReject(id) {
    setError('');
    setActingId(id);
    try {
      await rejectMatch(tokenRef.current, id);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setActingId(null);
    }
  }

  if (loading || now === null) return <p className="p-8 text-sm text-gray-500">Loading…</p>;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Matches</h1>
        <a href="/dashboard" className="text-sm text-gray-500 underline">
          Back to dashboard
        </a>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Both sides have 20 minutes to approve. A reject or timeout triggers an automatic rematch.
      </p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-8 flex flex-col gap-4">
        {matches.length === 0 && <p className="text-sm text-gray-500">No matches yet.</p>}

        {matches.map((m) => {
          const myApprovedAt = role === 'shipper' ? m.shipper_approved_at : m.carrier_approved_at;
          const isOpen = OPEN_STATUSES.includes(m.status) && new Date(m.approval_deadline).getTime() > now;
          const canAct = isOpen && !myApprovedAt;

          return (
            <div key={m.id} className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">
                    {m.origin_region} → {m.destination_region}
                  </p>
                  <p className="text-xs text-gray-500">
                    {m.weight_kg}kg · {m.truck_type_required} · {m.carrier_company_name}
                  </p>
                </div>
                <p className="text-sm font-semibold">{m.score_total}/100</p>
              </div>

              <div className="mt-3 flex items-center justify-between text-sm">
                <span
                  className={
                    m.status === 'booked'
                      ? 'font-medium text-green-700'
                      : m.status === 'rejected' || m.status === 'expired'
                        ? 'text-gray-500'
                        : 'font-medium'
                  }
                >
                  {STATUS_LABELS[m.status] ?? m.status}
                </span>
                {isOpen && <span className="text-xs text-gray-500">{formatCountdown(m.approval_deadline, now)}</span>}
              </div>

              {canAct && (
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleApprove(m.id)}
                    disabled={actingId === m.id}
                    className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleReject(m.id)}
                    disabled={actingId === m.id}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              )}
              {isOpen && myApprovedAt && (
                <p className="mt-3 text-xs text-gray-500">You&rsquo;ve approved — waiting on the other side.</p>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
