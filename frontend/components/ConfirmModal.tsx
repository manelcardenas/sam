"use client";

import { useState } from "react";
import { Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n/LocaleProvider";

interface ConfirmModalProps {
  title: string;
  message: React.ReactNode;
  /** Defaults to the translated "Delete". */
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export default function ConfirmModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useI18n();
  // Guard against double-fire: a second click while the async confirm is in
  // flight would repeat the action (e.g. a DELETE that then 404s).
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
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
            <h2 className="font-display text-lg font-bold text-fg">{title}</h2>
          </div>
          <button
            onClick={onCancel}
            aria-label={t("common.close")}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-6 text-muted">{message}</div>

        <div className="flex gap-3">
          <button
            onClick={handleConfirm}
            disabled={busy}
            className="flex-1 cursor-pointer rounded-full bg-tomato py-3 px-4 font-display font-semibold text-white shadow-pop transition-all hover:bg-tomato-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            {busy ? t("common.working") : (confirmLabel ?? t("common.delete"))}
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 cursor-pointer rounded-full border border-line py-3 px-4 font-semibold text-fg transition-colors hover:border-tomato/40 hover:text-tomato disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato/50"
          >
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
