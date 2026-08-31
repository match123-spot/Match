'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listShipments, pullMockShipments, getMatchCandidates, requestMatch } from '@/lib/api';

const SCORE_LABELS = {
  distance: 'Distance fit',
  timing: 'Timing overlap',
  utilization: 'Truck utilization',
  reliability: 'Reliability',
  acceptanceRate: 'Acceptance rate',
};

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
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">
                  {s.origin_region} → {s.destination_region}
                </p>
                <p className="text-xs text-gray-500">
                  {s.weight_kg}kg · {s.truck_type_required} · {s.otm_shipment_ref} · status: {s.status}
                </p>
              </div>
              <div className="flex gap-2">
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
