"use client";

import { Trash2, X } from "lucide-react";

interface DeleteConfirmModalProps {
  recipeName: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export default function DeleteConfirmModal({
  recipeName,
  onConfirm,
  onCancel,
}: DeleteConfirmModalProps) {
  const handleConfirm = async () => {
    await onConfirm();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-4xl border border-line bg-surface p-6 shadow-paw will-fetch animate-fetch-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-full bg-tomato/15">
              <Trash2 className="h-5 w-5 text-tomato" />
            </div>
            <h2 className="font-display text-lg font-bold text-fg">Delete recipe</h2>
          </div>
          <button
            onClick={onCancel}
            aria-label="Close"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-6 text-muted">
          Are you sure you want to delete{" "}
          <span className="font-semibold text-fg">&ldquo;{recipeName}&rdquo;</span>?
          SAM can&apos;t fetch this one back.
        </p>

        <div className="flex gap-3">
          <button
            onClick={handleConfirm}
            className="flex-1 cursor-pointer rounded-full bg-tomato py-3 px-4 font-display font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            Delete
          </button>
          <button
            onClick={onCancel}
            className="flex-1 cursor-pointer rounded-full border border-line py-3 px-4 font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
