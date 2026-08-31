'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { register } from '@/lib/api';

export default function SignupPage() {
  const router = useRouter();
  const [role, setRole] = useState('shipper');
  const [form, setForm] = useState({
    email: '',
    password: '',
    fullName: '',
    phone: '',
    companyName: '',
    baseLocation: '',
    fleetSize: 1,
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const profile =
        role === 'shipper'
          ? { companyName: form.companyName }
          : { companyName: form.companyName, baseLocation: form.baseLocation, fleetSize: Number(form.fleetSize) };

      const { token, user } = await register({
        email: form.email,
        password: form.password,
        fullName: form.fullName,
        phone: form.phone,
        role,
        profile,
      });

      localStorage.setItem('fc_token', token);
      localStorage.setItem('fc_role', user.role);
      router.push('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold">Create your FreightCopilot account</h1>
      <p className="mt-1 text-sm text-gray-500">AU/NZ freight matching, dual-sided onboarding.</p>

      <div className="mt-6 flex rounded-lg border border-gray-200 p-1">
        {['shipper', 'carrier'].map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={`flex-1 rounded-md py-2 text-sm font-medium capitalize transition ${
              role === r ? 'bg-black text-white' : 'text-gray-600'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <input
          required
          type="text"
          placeholder="Full name"
          value={form.fullName}
          onChange={update('fullName')}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          required
          type="email"
          placeholder="Email"
          value={form.email}
          onChange={update('email')}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          required
          type="password"
          placeholder="Password (min. 8 characters)"
          minLength={8}
          value={form.password}
          onChange={update('password')}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          type="tel"
          placeholder="Phone (optional)"
          value={form.phone}
          onChange={update('phone')}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <input
          required
          type="text"
          placeholder="Company name"
          value={form.companyName}
          onChange={update('companyName')}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm"
        />

        {role === 'carrier' && (
          <>
            <input
              required
              type="text"
              placeholder="Base location (e.g. Melbourne, VIC)"
              value={form.baseLocation}
              onChange={update('baseLocation')}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <input
              required
              type="number"
              min={1}
              placeholder="Fleet size"
              value={form.fleetSize}
              onChange={update('fleetSize')}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-2 rounded-md bg-black py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? 'Creating account…' : 'Sign up'}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-gray-500">
        Already have an account?{' '}
        <a href="/login" className="font-medium text-black underline">
          Log in
        </a>
      </p>
    </main>
  );
}
