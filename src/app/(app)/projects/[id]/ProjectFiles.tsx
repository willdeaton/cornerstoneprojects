'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ProjectFile } from '@/lib/types';
import { dateTime } from '@/lib/format';
import {
  uploadProjectFileAction,
  deleteProjectFileAction,
  type FileUploadState,
} from '@/app/actions/files';

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Summarise the current selection for the drop zone's label. */
function describe(files: FileList | null): string {
  if (!files || files.length === 0) return '';
  if (files.length === 1) return files[0].name;
  return `${files.length} files selected`;
}

export function ProjectFiles({ projectId, files }: { projectId: number; files: ProjectFile[] }) {
  const [state, action, uploading] = useActionState<FileUploadState, FormData>(
    uploadProjectFileAction,
    {}
  );
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState('');
  // Drag events fire on child elements too, so count enter/leave pairs instead
  // of toggling a boolean — otherwise the highlight flickers as the pointer
  // moves across the zone's own text.
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const router = useRouter();

  // Refresh the list once an upload succeeds and reset the form. Depend on the
  // whole state object (a fresh reference per dispatch) so repeated uploads of a
  // file with the same name still trigger a refresh.
  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
      setLabel('');
      router.refresh();
    }
  }, [state, router]);

  function remove(fileId: number, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    start(async () => {
      await deleteProjectFileAction(fileId, projectId);
      router.refresh();
    });
  }

  function endDrag() {
    dragDepth.current = 0;
    setDragging(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    endDrag();
    if (uploading) return;
    const dropped = e.dataTransfer.files;
    if (!dropped || dropped.length === 0) return;
    // Hand the dropped files to the hidden input so the existing form action
    // uploads them, then submit straight away — a drop means "upload this".
    const input = inputRef.current;
    if (!input) return;
    input.files = dropped;
    setLabel(describe(dropped));
    formRef.current?.requestSubmit();
  }

  return (
    <div className="card p-5">
      <h2 className="brand-heading mb-4 text-sm text-brand-gray">
        Files <span className="text-brand-gray/70">({files.length})</span>
      </h2>

      <form ref={formRef} action={action} className="mb-4">
        <input type="hidden" name="project_id" value={projectId} />
        <label
          onDragEnter={(e) => {
            e.preventDefault();
            dragDepth.current += 1;
            setDragging(true);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => {
            e.preventDefault();
            dragDepth.current -= 1;
            if (dragDepth.current <= 0) endDrag();
          }}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
            dragging
              ? 'border-brand-green bg-brand-green/10'
              : 'border-black/15 bg-black/[0.02] hover:border-brand-green hover:bg-brand-green/5'
          }`}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#98C73A" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-sm font-semibold text-brand-ink">
            {dragging ? 'Drop to upload' : label || 'Drag & drop files here'}
          </span>
          <span className="text-xs text-brand-gray">
            or click to browse · documents, photos, PDFs · up to 10 MB each
          </span>
          <input
            ref={inputRef}
            type="file"
            name="file"
            multiple
            className="hidden"
            onChange={(e) => setLabel(describe(e.target.files))}
          />
        </label>
        {state.error && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
        )}
        <div className="mt-2 flex justify-end">
          <button type="submit" className="btn-primary" disabled={uploading || !label}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </form>

      {files.length === 0 ? (
        <p className="py-3 text-center text-sm text-brand-gray">No files uploaded yet.</p>
      ) : (
        <ul className="divide-y divide-black/5">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
              <div className="min-w-0">
                <a
                  href={`/api/files/${f.id}?download=1`}
                  className="block truncate font-medium text-brand-ink hover:text-brand-green-dark hover:underline"
                >
                  {f.filename}
                </a>
                <p className="text-xs text-brand-gray">
                  {fileSize(f.size)}
                  {f.uploader_name ? ` · ${f.uploader_name}` : ''} · {dateTime(f.created_at)}
                </p>
              </div>
              <button
                onClick={() => remove(f.id, f.filename)}
                disabled={pending}
                className="shrink-0 text-xs text-red-500 hover:underline disabled:opacity-50"
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
