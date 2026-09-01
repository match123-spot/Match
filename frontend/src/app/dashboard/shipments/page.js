'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listShipments, pullMockShipments, getMatchCandidates, getLiveCandidates, requestMatch } from '@/lib/api';

const LIVE_POLL_MS = 15000;
const MAX_PICKUP_DISTANCE_KM = 150;

const SCORE_LABELS = {
  distance: 'Distance fit',
  timing: 'Timing overlap',
  utilization: 'Truck utilization',
  reliability: 'Reliability',
  acceptanceRate: 'Acceptance rate',
};

function fmtMoney(n) {
  return n == null ? 'TBC' : `$${Number(n).toFixed(2)}`;
}

function fmtWindow(start, end) {
  if (!start) return 'TBC';
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  const opts = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' };
  return e ? `${s.toLocaleString([], opts)} – ${e.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : s.toLocaleString([], opts);
}

function RateComparison({ shipment }) {
  const contracted = shipment.contracted_rate != null ? Number(shipment.contracted_rate) : null;
  const ai = shipment.ai_recommended_rate != null ? Number(shipment.ai_recommended_rate) : null;
  const savings = contracted != null && ai != null ? contracted - ai : null;
  const savingsPct = savings != null && contracted > 0 ? (savings / contracted) * 100 : null;

  return (
    <div className="mt-3 grid grid-cols-2 gap-3 rounded-md bg-gray-50 p-3">
      <div>
        <p className="text-[11px] uppercase tracking-wide text-gray-400">
          Contracted rate (current LSP{shipment.current_lsp ? `: ${shipment.current_lsp}` : ''})
        </p>
        <p className="text-lg font-semibold text-gray-700">{fmtMoney(contracted)}</p>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-wide text-gray-400">AI marketplace rate</p>
        <p className={`text-lg font-semibold ${savings != null && savings > 0 ? 'text-green-700' : 'text-gray-900'}`}>
          {fmtMoney(ai)}
        </p>
      </div>
      {savings != null && (
        <p className="col-span-2 text-xs font-medium text-green-700">
          {savings >= 0
            ? `Our AI engine expects this load can be taken for ${savingsPct.toFixed(0)}% less than the current contracted rate — a saving of ${fmtMoney(savings)}.`
            : `Our AI engine expects this load will cost ${fmtMoney(Math.abs(savings))} more than the contracted rate on this lane.`}
        </p>
      )}
      {shipment.ai_rate_reasoning && <p className="col-span-2 text-xs italic text-gray-500">{shipment.ai_rate_reasoning}</p>}
    </div>
  );
}

function proximityColor(km) {
  if (km == null) return 'bg-gray-300';
  if (km <= 50) return 'bg-green-500';
  if (km <= 100) return 'bg-amber-500';
  return 'bg-red-500';
}

function LiveMatchesPanel({ candidates, checkedAt }) {
  if (candidates == null) {
    return <p className="mt-3 text-xs text-gray-400">Scanning live carrier availability…</p>;
  }

  return (
    <div className="mt-3 rounded-md border border-gray-100 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-700">
          <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-green-500 align-middle" />
          Potential matches — live from carrier availability
        </p>
        {checkedAt && <p className="text-[11px] text-gray-400">Checked {checkedAt.toLocaleTimeString()}</p>}
      </div>
      <p className="mt-0.5 text-[11px] text-gray-400">
        Only trucks within {MAX_PICKUP_DISTANCE_KM}km of pickup are eligible — a truck in Auckland can&rsquo;t take a
        load out of Wellington.
      </p>

      {candidates.length === 0 ? (
        <p className="mt-2 text-xs text-gray-500">No eligible trucks in range right now.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          {candidates.slice(0, 4).map((c) => (
            <div key={c.availabilityId} className="flex items-center gap-2 text-xs">
              <span className={`h-2 w-2 shrink-0 rounded-full ${proximityColor(c.availability.distanceKm)}`} />
              <span className="w-32 shrink-0 truncate font-medium">{c.carrier.companyName}</span>
              <span className="w-20 shrink-0 text-gray-500">
                {c.availability.distanceKm != null ? `${c.availability.distanceKm}km` : '—'}
              </span>
              <span className="w-24 shrink-0 text-gray-500">{c.availability.truckType}</span>
              <span className="ml-auto font-semibold">{c.scores.total}/100</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoreBar({ label, value }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-32 text-gray-500">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-gray-100">
        <div className="h-1.5 rounded-full bg-black" style={{ width: `${value}%` }} />
      </div>
      <span className="w-10 text-right text-gray-500">{value}</span>
    </div>
  );
}

export default function ShipmentsPage() {
  const router = useRouter();
  const tokenRef = useRef(null);
  const [shipments, setShipments] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [matchesByShipment, setMatchesByShipment] = useState({});
  const [matchLoadingId, setMatchLoadingId] = useState(null);
  const [requestingId, setRequestingId] = useState(null);
  const [requested, setRequested] = useState({});
  const [liveCandidates, setLiveCandidates] = useState({});
  const [liveCheckedAt, setLiveCheckedAt] = useState(null);
  const shipmentsRef = useRef([]);

  useEffect(() => {
    shipmentsRef.current = shipments;
  }, [shipments]);

  useEffect(() => {
    const tok = localStorage.getItem('fc_token');
    const role = localStorage.getItem('fc_role');
    if (!tok) {
      router.push('/login');
      return;
    }
    if (role !== 'shipper') {
      router.push('/dashboard');
      return;
    }
    tokenRef.current = tok;
    listShipments(tok)
      .then((data) => setShipments(data.shipments))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    async function pollLive() {
      const pending = shipmentsRef.current.filter((s) => s.status === 'pending');
      if (pending.length === 0) return;

      const entries = await Promise.all(
        pending.map((s) =>
          getLiveCandidates(tokenRef.current, s.id)
            .then((data) => [s.id, data.candidates])
            .catch(() => [s.id, null])
        )
      );
      if (!cancelled) {
        setLiveCandidates((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
        setLiveCheckedAt(new Date());
      }
    }

    pollLive();
    const interval = setInterval(pollLive, LIVE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [shipments]);

  async function handlePull() {
    setError('');
    setPulling(true);
    try {
      await pullMockShipments(tokenRef.current, 3);
      const data = await listShipments(tokenRef.current);
      setShipments(data.shipments);
    } catch (err) {
      setError(err.message);
    } finally {
      setPulling(false);
    }
  }

  async function handleRequestMatch(shipmentId) {
    setError('');
    setRequestingId(shipmentId);
    try {
      await requestMatch(tokenRef.current, shipmentId);
      setRequested((r) => ({ ...r, [shipmentId]: true }));
      const data = await listShipments(tokenRef.current);
      setShipments(data.shipments);
    } catch (err) {
      setError(err.message);
    } finally {
      setRequestingId(null);
    }
  }

  async function handleViewMatches(shipmentId) {
    setError('');
    setMatchLoadingId(shipmentId);
    try {
      const data = await getMatchCandidates(tokenRef.current, shipmentId);
      setMatchesByShipment((m) => ({ ...m, [shipmentId]: data.candidates }));
    } catch (err) {
      setError(err.message);
    } finally {
      setMatchLoadingId(null);
    }
  }

  if (loading) return <p className="p-8 text-sm text-gray-500">Loading…</p>;

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Shipments</h1>
        <a href="/dashboard" className="text-sm text-gray-500 underline">
          Back to dashboard
        </a>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Mocked OTM pulls stand in for a real TMS connection for the MVP.
      </p>

      <button
        onClick={handlePull}
        disabled={pulling}
        className="mt-6 rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pulling ? 'Pulling…' : 'Pull mock shipments'}
      </button>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-8 flex flex-col gap-4">
        {shipments.length === 0 && <p className="text-sm text-gray-500">No shipments yet.</p>}

        {shipments.map((s) => (
          <div key={s.id} className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-medium">
                  {s.origin_region} → {s.destination_region}
                  {s.distance_km != null && <span className="font-normal text-gray-400"> · {s.distance_km}km</span>}
                </p>
                <p className="text-xs text-gray-500">
                  {s.weight_kg}kg{s.pallet_count != null ? ` · ${s.pallet_count} pallets` : ''} · {s.truck_type_required} ·{' '}
                  {s.otm_shipment_ref} · status: {s.status}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {s.customer_name && <>Customer: {s.customer_name} · </>}
                  {s.lead_time_hours != null && <>Lead time: {Number(s.lead_time_hours).toFixed(0)}h · </>}
                  Loading: {fmtWindow(s.pickup_window_start, s.pickup_window_end)}
                </p>
                <p className="text-xs text-gray-500">Delivery: {fmtWindow(s.expected_delivery_start, s.expected_delivery_end)}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => handleViewMatches(s.id)}
                  disabled={matchLoadingId === s.id}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                >
                  {matchLoadingId === s.id ? 'Scoring…' : 'Preview matches'}
                </button>
                {s.status === 'pending' && !requested[s.id] && (
                  <button
                    onClick={() => handleRequestMatch(s.id)}
                    disabled={requestingId === s.id}
                    className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {requestingId === s.id ? 'Requesting…' : 'Request match'}
                  </button>
                )}
                {(s.status === 'awaiting_approval' || s.status === 'booked' || requested[s.id]) && (
                  <a
                    href="/dashboard/matches"
                    className="rounded-md bg-black px-3 py-1.5 text-xs font-medium text-white"
                  >
                    View in Matches
                  </a>
                )}
              </div>
            </div>

            <RateComparison shipment={s} />

            {s.status === 'pending' && (
              <LiveMatchesPanel candidates={liveCandidates[s.id]} checkedAt={liveCheckedAt} />
            )}

            {matchesByShipment[s.id] && (
              <div className="mt-4 flex flex-col gap-3 border-t border-gray-100 pt-4">
                {matchesByShipment[s.id].length === 0 ? (
                  <p className="text-sm text-gray-500">No eligible carrier availability found.</p>
                ) : (
                  matchesByShipment[s.id].map((c, idx) => (
                    <div key={c.availabilityId} className="rounded-md bg-gray-50 p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium">
                          #{idx + 1} {c.carrier.companyName}{' '}
                          <span className="font-normal text-gray-500">({c.availability.originRegion})</span>
                        </p>
                        <p className="text-sm font-semibold">{c.scores.total}/100</p>
                      </div>
                      <div className="mt-2 flex flex-col gap-1">
                        {Object.entries(SCORE_LABELS).map(([key, label]) => (
                          <ScoreBar key={key} label={label} value={c.scores[key]} />
                        ))}
                      </div>
                      {c.explanation && (
                        <p className="mt-3 text-xs italic text-gray-600">&ldquo;{c.explanation}&rdquo;</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
