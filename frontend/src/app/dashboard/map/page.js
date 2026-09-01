'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { getAvailableCarriers, getAvailableShipments } from '@/lib/api';

const CarrierMap = dynamic(() => import('@/components/LiveMap').then((m) => m.CarrierMap), { ssr: false });
const ShipmentMap = dynamic(() => import('@/components/LiveMap').then((m) => m.ShipmentMap), { ssr: false });

const REFRESH_MS = 20000;

export default function MapPage() {
  const router = useRouter();
  const tokenRef = useRef(null);
  const [role, setRole] = useState(null);
  const [carriers, setCarriers] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const tok = localStorage.getItem('fc_token');
    const r = localStorage.getItem('fc_role');
    if (!tok) {
      router.push('/login');
      return;
    }
    tokenRef.current = tok;
    Promise.resolve(r).then(setRole);
  }, [router]);

  useEffect(() => {
    if (!role) return;

    let cancelled = false;

    async function refresh() {
      try {
        if (role === 'shipper') {
          const data = await getAvailableCarriers(tokenRef.current);
          if (!cancelled) setCarriers(data.carriers);
        } else {
          const data = await getAvailableShipments(tokenRef.current);
          if (!cancelled) setShipments(data.shipments);
        }
        if (!cancelled) setLastUpdated(new Date());
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [role]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {role === 'carrier' ? 'Available shipments' : 'Available carrier capacity'}
        </h1>
        <a href="/dashboard" className="text-sm text-gray-500 underline">
          Back to dashboard
        </a>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        {role === 'carrier'
          ? 'Open shipments looking for a truck, refreshed automatically.'
          : 'Open truck capacity across the network, refreshed automatically.'}
        {lastUpdated && <span className="ml-2 text-gray-400">Updated {lastUpdated.toLocaleTimeString()}</span>}
      </p>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <div className="mt-6 h-[600px] overflow-hidden rounded-lg border border-gray-200">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">Loading map…</div>
        ) : role === 'carrier' ? (
          shipments.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              No open shipments right now.
            </div>
          ) : (
            <ShipmentMap shipments={shipments} />
          )
        ) : carriers.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-500">
            No open carrier capacity right now.
          </div>
        ) : (
          <CarrierMap carriers={carriers} />
        )}
      </div>
    </main>
  );
}
