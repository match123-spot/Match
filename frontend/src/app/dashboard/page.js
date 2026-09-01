'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe, getMyRatingSummary } from '@/lib/api';

const MAX_PICKUP_DISTANCE_KM = 150;

const SCORE_WEIGHTS = [
  {
    label: 'Distance fit',
    weight: 30,
    detail: `How close the carrier truck is to the shipment origin — trucks beyond ${MAX_PICKUP_DISTANCE_KM}km are excluded entirely, not just down-ranked`,
  },
  { label: 'Timing overlap', weight: 25, detail: "How well the truck's available window covers the pickup window" },
  { label: 'Truck utilization', weight: 15, detail: "How full the truck runs — near-capacity loads score highest" },
  { label: 'Reliability', weight: 20, detail: "The carrier's average star rating from past shipments" },
  { label: 'Acceptance rate', weight: 10, detail: "The carrier's historical rate of accepting offered matches" },
];

function StarSummary({ summary }) {
  if (!summary || Number(summary.count) === 0) {
    return <p className="text-sm text-gray-500">No ratings yet — complete a shipment to start building your reputation.</p>;
  }
  const stars = Math.round(Number(summary.avg_star));
  return (
    <div className="text-sm">
      <p className="font-medium">
        {'★'.repeat(stars)}
        {'☆'.repeat(5 - stars)}{' '}
        <span className="font-normal text-gray-500">
          {Number(summary.avg_star).toFixed(1)} ({summary.count} rating{summary.count === '1' ? '' : 's'})
        </span>
      </p>
      {summary.role === 'carrier' ? (
        <p className="mt-1 text-gray-500">
          On-time {Math.round(Number(summary.on_time_rate) * 100)}% · Completion{' '}
          {Math.round(Number(summary.completion_rate) * 100)}% · Damage/complaint{' '}
          {Math.round(Number(summary.damage_complaint_rate) * 100)}%
        </p>
      ) : (
        <p className="mt-1 text-gray-500">
          Avg response {Math.round(Number(summary.avg_response_time_minutes) || 0)}min · Cancellation{' '}
          {Math.round(Number(summary.cancellation_rate) * 100)}%
        </p>
      )}
    </div>
  );
}

function MatchingExplainer({ role }) {
  return (
    <div className="mt-8 rounded-lg border border-gray-200 p-6">
      <h2 className="font-medium">How AI matching works</h2>
      <p className="mt-1 text-sm text-gray-500">
        {role === 'carrier'
          ? 'Every shipment a shipper requests a match for is scored against your open truck availability entries.'
          : 'When you request a match, every open carrier truck is scored against your shipment.'}
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {SCORE_WEIGHTS.map((s) => (
          <div key={s.label} className="flex items-center gap-3 text-sm">
            <span className="w-14 shrink-0 text-right font-semibold">{s.weight}%</span>
            <div>
              <span className="font-medium">{s.label}</span>
              <span className="text-gray-500"> — {s.detail}</span>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-sm text-gray-500">
        Geography is a hard cutoff before any weighting happens — a truck in Auckland is never considered for a
        pickup out of Wellington, no matter how well it scores elsewhere. Only trucks within{' '}
        {MAX_PICKUP_DISTANCE_KM}km of the shipment origin are eligible at all.
      </p>

      <p className="mt-3 text-sm text-gray-500">
        Truck type isn&rsquo;t a rigid category match either: a shipment specified as needing a semi is also open to
        a rigid truck if it has enough capacity for the actual weight and pallet count. A right-sized (smaller,
        usually cheaper) truck is flagged as an explicit recommendation rather than silently ranked — it never
        substitutes a non-refrigerated truck for a refrigerated requirement, though.
      </p>

      <p className="mt-3 text-sm text-gray-500">
        The five scores combine into a single 0–100 compatibility score. The top-ranked candidate is offered the
        match, and Claude writes a plain-language explanation of why it&rsquo;s a good (or borderline) fit.
      </p>

      <p className="mt-3 text-sm text-gray-500">
        Claude also recommends the freight rate for{' '}
        {role === 'carrier' ? 'shipments before they reach you' : 'each shipment you pull'}, grounded by a
        distance-and-weight formula so it stays realistic rather than guessing freely.
      </p>

      <p className="mt-3 text-sm text-gray-500">
        Once a match is offered,{' '}
        {role === 'carrier' ? 'you and the shipper' : 'you and the carrier'} both have 20 minutes to approve. If
        either side rejects or the window lapses, the system automatically tries the next-best candidate — no
        manual re-matching needed. You can also set an auto-approval threshold (in{' '}
        <a href="/dashboard/settings" className="underline">
          Auto-approval
        </a>
        ) so matches that clear your price bar approve themselves instantly.
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [ratingSummary, setRatingSummary] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('fc_token');
    if (!token) {
      router.push('/login');
      return;
    }
    getMe(token)
      .then((data) => {
        setUser(data.user);
        if (data.user.role === 'admin') return null;
        return getMyRatingSummary(token);
      })
      .then((data) => data && setRatingSummary(data))
      .catch(() => {
        localStorage.removeItem('fc_token');
        localStorage.removeItem('fc_role');
        router.push('/login');
      });
  }, [router]);

  function logout() {
    localStorage.removeItem('fc_token');
    localStorage.removeItem('fc_role');
    router.push('/login');
  }

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  if (!user) return <p className="p-8 text-sm text-gray-500">Loading…</p>;

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Welcome, {user.full_name}</h1>
        <button onClick={logout} className="text-sm text-gray-500 underline">
          Log out
        </button>
      </div>
      <p className="mt-2 text-sm text-gray-500 capitalize">
        Signed in as <span className="font-medium">{user.role}</span> · {user.email}
      </p>

      {user.role !== 'admin' && user.org_status !== 'approved' && (
        <div className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {user.org_status === 'pending' ? (
            <>
              <span className="font-medium">{user.org_company_name}</span> is pending admin approval. You can set up
              your profile, but you won&rsquo;t appear in matching or be able to request matches until approved.
            </>
          ) : (
            <>
              <span className="font-medium">{user.org_company_name}</span> has been suspended and cannot transact.
              Contact support if you believe this is a mistake.
            </>
          )}
        </div>
      )}

      {user.role === 'admin' && (
        <div className="mt-8 rounded-lg border border-gray-200 p-6">
          <h2 className="font-medium">Admin</h2>
          <a
            href="/admin"
            className="mt-4 inline-block rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
          >
            Review organizations
          </a>
        </div>
      )}

      {user.role !== 'admin' && (
      <>
      <div className="mt-8 rounded-lg border border-gray-200 p-6">
        {user.role === 'carrier' ? (
          <>
            <h2 className="font-medium">Carrier dashboard</h2>
            <div className="mt-4 flex gap-2">
              <a
                href="/dashboard/availability"
                className="inline-block rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
              >
                Manage truck availability
              </a>
              <a
                href="/dashboard/matches"
                className="inline-block rounded-md border border-gray-300 px-4 py-2 text-sm font-medium"
              >
                Matches
              </a>
              <a
                href="/dashboard/settings"
                className="inline-block rounded-md border border-gray-300 px-4 py-2 text-sm font-medium"
              >
                Auto-approval
              </a>
              <a
                href="/dashboard/map"
                className="inline-block rounded-md border border-gray-300 px-4 py-2 text-sm font-medium"
              >
                Live map
              </a>
            </div>
          </>
        ) : (
          <>
            <h2 className="font-medium">Shipper dashboard</h2>
            <div className="mt-4 flex gap-2">
              <a
                href="/dashboard/shipments"
                className="inline-block rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
              >
                View shipments
              </a>
              <a
                href="/dashboard/matches"
                className="inline-block rounded-md border border-gray-300 px-4 py-2 text-sm font-medium"
              >
                Matches
              </a>
              <a
                href="/dashboard/settings"
                className="inline-block rounded-md border border-gray-300 px-4 py-2 text-sm font-medium"
              >
                Auto-approval
              </a>
              <a
                href="/dashboard/map"
                className="inline-block rounded-md border border-gray-300 px-4 py-2 text-sm font-medium"
              >
                Live map
              </a>
            </div>
          </>
        )}
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 p-6">
        <h2 className="font-medium">Your reputation</h2>
        <div className="mt-3">
          <StarSummary summary={ratingSummary?.summary ? { ...ratingSummary.summary, role: ratingSummary.role } : null} />
        </div>
      </div>

      <MatchingExplainer role={user.role} />
      </>
      )}
    </main>
  );
}
