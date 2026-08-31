'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listAvailability, createAvailability, deleteAvailability } from '@/lib/api';

const TRUCK_TYPES = ['semi', 'B-double', 'rigid', 'refrigerated'];

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

export default function AvailabilityPage() {
  const router = useRouter();
  const tokenRef = useRef(null);
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const now = new Date();
  const oneDay = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const [form, setForm] = useState({
    availableDate: now.toISOString().slice(0, 10),
    truckType: TRUCK_TYPES[0],
    truckCapacityKg: 10000,
    originRegion: '',
    windowStart: toLocalInputValue(now),
    windowEnd: toLocalInputValue(oneDay),
  });

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function refresh(tok) {
    try {
      const data = await listAvailability(tok);
      setEntries(data.availability);
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
    if (role !== 'carrier') {
      router.push('/dashboard');
      return;
    }
    tokenRef.current = tok;
    listAvailability(tok)
      .then((data) => setEntries(data.availability))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await createAvailability(tokenRef.current, {
        ...form,
        truckCapacityKg: Number(form.truckCapacityKg),
        windowStart: new Date(form.windowStart).toISOString(),
        windowEnd: new Date(form.windowEnd).toISOString(),
      });
      await refresh(tokenRef.current);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id) {
    setError('');
    try {
      await deleteAvailability(tokenRef.current, id);
      await refresh(tokenRef.current);
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <p className="p-8 text-sm text-gray-500">Loading…</p>;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Truck availability</h1>
        <a href="/dashboard" className="text-sm text-gray-500 underline">
          Back to dashboard
        </a>
      </div>
      <p className="mt-1 text-sm text-gray-500">Enter your daily truck availability manually.</p>

      <form onSubmit={handleSubmit} className="mt-6 grid grid-cols-2 gap-4 rounded-lg border border-gray-200 p-6">
        <label className="flex flex-col gap-1 text-sm">
          Available date
          <input
            required
            type="date"
            value={form.availableDate}
            onChange={update('availableDate')}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Truck type
          <select
            value={form.truckType}
            onChange={update('truckType')}
            className="rounded-md border border-gray-300 px-3 py-2"
          >
            {TRUCK_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Capacity (kg)
          <input
            required
            type="number"
            min={1}
            value={form.truckCapacityKg}
            onChange={update('truckCapacityKg')}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Origin region
          <input
            required
            type="text"
            placeholder="e.g. Melbourne, VIC"
            value={form.originRegion}
            onChange={update('originRegion')}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Window start
          <input
            required
            type="datetime-local"
            value={form.windowStart}
            onChange={update('windowStart')}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Window end
          <input
            required
            type="datetime-local"
            value={form.windowEnd}
            onChange={update('windowEnd')}
            className="rounded-md border border-gray-300 px-3 py-2"
          />
        </label>

        {error && <p className="col-span-2 text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="col-span-2 mt-2 rounded-md bg-black py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add availability'}
        </button>
      </form>

      <h2 className="mt-10 font-medium">Your upcoming availability</h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-gray-500">No availability entered yet.</p>
      ) : (
        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500">
              <th className="py-2">Date</th>
              <th>Truck</th>
              <th>Capacity</th>
              <th>Origin</th>
              <th>Window</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-gray-100">
                <td className="py-2">{e.available_date?.slice(0, 10)}</td>
                <td>{e.truck_type}</td>
                <td>{e.truck_capacity_kg} kg</td>
                <td>{e.origin_region}</td>
                <td>
                  {new Date(e.window_start).toLocaleString()} – {new Date(e.window_end).toLocaleTimeString()}
                </td>
                <td>{e.is_booked ? 'Booked' : 'Open'}</td>
                <td>
                  {!e.is_booked && (
                    <button onClick={() => handleDelete(e.id)} className="text-red-600 underline">
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
