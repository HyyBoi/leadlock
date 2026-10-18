export default async function Denied({ searchParams }: { searchParams: Promise<{ perm?: string }> }) {
  const { perm } = await searchParams;
  return (
    <div className="card max-w-lg">
      <h1 className="text-xl font-bold">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-sm">It needs the <code>{perm}</code> permission. Ask your workspace Owner or Admin to grant it to your role.</p>
    </div>
  );
}
