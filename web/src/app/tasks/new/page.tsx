'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TaskForm, type TaskFormValues } from '@/components/TaskForm';
import { useUser } from '@/context/UserContext';
import { createDefinition } from '@/lib/api';

export default function NewTaskPage() {
  const router = useRouter();
  const { me, loading: userLoading } = useUser();

  async function submit(values: TaskFormValues) {
    await createDefinition({
      title: values.title,
      description: values.description || undefined,
      recurrence: values.recurrence,
      points: values.points,
      autoAssignableTo: values.autoAssignableTo,
      dueOffsetDays: values.dueOffsetDays,
      startDate: values.startDate,
    });
    router.push('/');
  }

  if (userLoading || !me) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-10">
        <p className="text-neutral-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <Link href="/" className="text-sm text-neutral-500 underline underline-offset-2 hover:text-neutral-800">
        ← Back to dashboard
      </Link>
      <h1 className="mt-2 text-xl font-bold">New task</h1>

      <div className="mt-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <TaskForm
          submitLabel="Create task"
          busyLabel="Creating…"
          onSubmit={submit}
          onCancel={() => router.push('/')}
          hint={
            <p className="text-xs text-neutral-500">
              Recurring tasks materialise automatically from the first occurrence date (a future date means nothing
              shows up until then); a one-off task is created for that date. Setting due-after to 2 means each
              occurrence is due two days after it appears.
            </p>
          }
        />
      </div>
    </main>
  );
}
