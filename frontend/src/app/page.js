export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">FreightCopilot</h1>
      <p className="max-w-md text-gray-500">
        Real-time AI freight optimization matching shipper demand with carrier capacity, AU/NZ.
      </p>
      <div className="flex gap-4 text-sm font-medium">
        <a href="/signup" className="rounded-md bg-black px-5 py-2.5 text-white">
          Sign up
        </a>
        <a href="/login" className="rounded-md border border-gray-300 px-5 py-2.5">
          Log in
        </a>
      </div>
    </main>
  );
}
