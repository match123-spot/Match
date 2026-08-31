'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAutoApproveSettings, setShipperAutoApprove, setCarrierAutoApprove } from '@/lib/api';

export default function SettingsPage() {
  const router = useRouter();
  const tokenRef = useRef(null);
  const [role, setRole] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [threshold, setThreshold] = useState(1000);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const tok = localStorage.getItem('fc_token');
    const r = localStorage.getItem('fc_role');
    if (!tok) {
      router.push('/login');
      return;
    }
    tokenRef.current = tok;

    getAutoApproveSettings(tok)
      .then((data) => {
        setRole(r);
        const current = r === 'shipper' ? data.autoApproveMaxCost : data.autoApproveMinIncome;
        setEnabled(current != null);
        if (current != null) setThreshold(Number(current));
      })
      .catch((err) => {
        setRole(r);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSaved(false);
    setSaving(true);
    try {
      const value = enabled ? Number(threshold) : null;
      if (role === 'shipper') {
        await setShipperAutoApprove(tokenRef.current, value);
      } else {
        await setCarrierAutoApprove(tokenRef.current, value);
      }
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="p-8 text-sm text-gray-500">Loading…</p>;

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Auto-approval</h1>
        <a href="/dashboard" className="text-sm text-gray-500 underline">
          Back to dashboard
        </a>
      </div>

      {role === 'shipper' ? (
        <p className="mt-2 text-sm text-gray-500">
          Automatically approve a proposed match on your side the moment it&rsquo;s offered, as long as the quoted
          rate is at or below your limit. The carrier still has to approve separately, unless they&rsquo;ve also set
          an auto-approval limit that clears — in which case the shipment books itself with no clicks from either
          side.
        </p>
      ) : (
        <p className="mt-2 text-sm text-gray-500">
          Automatically approve a proposed match the moment it&rsquo;s offered, as long as the rate is at or above
          what you&rsquo;d otherwise earn versus leaving the truck idle. The shipper still has to approve separately,
          unless they&rsquo;ve also set an auto-approval limit that clears.
        </p>
      )}

      <form onSubmit={handleSave} className="mt-6 flex flex-col gap-4 rounded-lg border border-gray-200 p-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enable auto-approval
        </label>

        {enabled && (
          <label className="flex flex-col gap-1 text-sm">
            {role === 'shipper' ? 'Auto-approve if rate is at or below (AUD)' : 'Auto-approve if rate is at or above (AUD)'}
            <input
              type="number"
              min={0}
              step="0.01"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && <p className="text-sm text-green-700">Saved.</p>}

        <button
          type="submit"
          disabled={saving}
          className="self-start rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
    </main>
  );
}
