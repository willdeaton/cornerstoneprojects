'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  uploadLogoAction,
  resetLogoAction,
  type LogoUploadState,
} from '@/app/actions/branding';
import type { LogoKind } from '@/lib/branding-store';

export interface BrandingValues {
  full: string;
  icon: string | null;
  estimate: string;
}

export function LogoSettings({ branding }: { branding: BrandingValues }) {
  return (
    <div className="space-y-6">
      <LogoUploader
        kind="full"
        title="App Logo"
        help="Wide logo shown in the sidebar and on the sign-in screen."
        current={branding.full}
        canReset
        dark
      />
      <LogoUploader
        kind="icon"
        title="App Icon"
        help="Square mark shown when the sidebar is collapsed. If left empty, a green “C” is used."
        current={branding.icon}
        canReset={!!branding.icon}
        square
        dark
      />
      <LogoUploader
        kind="estimate"
        title="Estimate PDF Logo"
        help="Logo printed on customer-facing quote / estimate PDFs. Defaults to the app logo."
        current={branding.estimate}
        canReset
      />
    </div>
  );
}

function LogoUploader({
  kind,
  title,
  help,
  current,
  canReset,
  square = false,
  dark = false,
}: {
  kind: LogoKind;
  title: string;
  help: string;
  current: string | null;
  canReset: boolean;
  square?: boolean;
  dark?: boolean;
}) {
  const [state, action, uploading] = useActionState<LogoUploadState, FormData>(
    uploadLogoAction,
    {}
  );
  const [pending, start] = useTransition();
  const [fileName, setFileName] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      setFileName('');
      router.refresh();
    }
  }, [state, router]);

  function reset() {
    if (!confirm(`Remove the uploaded ${title.toLowerCase()}?`)) return;
    start(async () => {
      await resetLogoAction(kind);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-black/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-brand-ink">{title}</h3>
          <p className="mt-0.5 text-xs text-brand-gray">{help}</p>
        </div>
        {canReset && (
          <button
            onClick={reset}
            disabled={pending}
            className="shrink-0 text-xs text-red-500 hover:underline disabled:opacity-50"
          >
            reset
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        {/* Current preview */}
        <div
          className={`flex items-center justify-center overflow-hidden rounded-lg border border-black/10 ${
            dark ? 'bg-black' : 'bg-white'
          } ${square ? 'h-16 w-16' : 'h-16 w-40'}`}
        >
          {current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={current} alt={title} className="max-h-full max-w-full object-contain p-1.5" />
          ) : (
            <span className="text-xs text-brand-gray">None</span>
          )}
        </div>

        <form ref={formRef} action={action} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="kind" value={kind} />
          <label className="btn-secondary cursor-pointer">
            {fileName || 'Choose image'}
            <input
              type="file"
              name="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="hidden"
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? '')}
            />
          </label>
          <button type="submit" className="btn-primary" disabled={uploading || !fileName}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </form>
      </div>

      <p className="mt-2 text-xs text-brand-gray">PNG, JPG, SVG or WebP · up to 3 MB.</p>

      {state.error && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}
      {state.success && (
        <p className="mt-2 rounded-lg bg-brand-green/15 px-3 py-2 text-sm text-brand-green-dark">
          {state.success}
        </p>
      )}
    </div>
  );
}
