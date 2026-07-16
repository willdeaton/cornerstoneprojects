'use client';

import { useState, useEffect, useActionState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadLogoAction, resetLogoAction, type LogoState } from '@/app/actions/branding';

export function LogoUpload({
  currentLogo,
  hasCustom,
}: {
  currentLogo: string | null;
  hasCustom: boolean;
}) {
  const [state, action, pending] = useActionState<LogoState, FormData>(uploadLogoAction, {});
  const [preview, setPreview] = useState<string | null>(null);
  const [resetting, startReset] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (state.success) {
      setPreview(null);
      router.refresh();
    }
  }, [state.success, router]);

  const shown = preview ?? currentLogo ?? '/logo-onblack.png';

  return (
    <div className="space-y-5">
      {/* Preview on the dark sidebar background */}
      <div>
        <p className="label">Preview</p>
        <div className="flex items-center justify-center rounded-xl bg-brand-ink p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown} alt="Logo preview" className="h-16 w-auto max-w-[280px] object-contain" />
        </div>
      </div>

      <form action={action} className="space-y-4">
        <div>
          <label className="label">Choose a logo image</label>
          <input
            type="file"
            name="logo"
            accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
            className="block w-full text-sm text-brand-gray file:mr-3 file:rounded-lg file:border-0 file:bg-brand-green file:px-4 file:py-2 file:text-sm file:font-semibold file:text-brand-ink hover:file:bg-brand-green-dark hover:file:text-white"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                const url = URL.createObjectURL(f);
                setPreview(url);
              }
            }}
          />
        </div>

        {state.error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
        )}
        {state.success && (
          <p className="rounded-lg bg-brand-green/15 px-3 py-2 text-sm text-brand-green-dark">
            {state.success}
          </p>
        )}

        <div className="flex items-center gap-2">
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? 'Uploading…' : 'Save Logo'}
          </button>
          {hasCustom && (
            <button
              type="button"
              className="btn-secondary"
              disabled={resetting}
              onClick={() =>
                startReset(async () => {
                  await resetLogoAction();
                  setPreview(null);
                  router.refresh();
                })
              }
            >
              {resetting ? '…' : 'Reset to Default'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
