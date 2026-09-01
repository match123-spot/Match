'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getMe } from '@/lib/api';

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('fc_token');
    if (!token) {
      router.push('/login');
      return;
    }
    getMe(token)
      .then((data) => setUser(data.user))
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
    </main>
  );
}
