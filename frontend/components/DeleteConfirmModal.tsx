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
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-sm w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-full">
              <Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              Delete Recipe
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Are you sure you want to delete{" "}
          <span className="font-semibold text-gray-900 dark:text-white">
            &ldquo;{recipeName}&rdquo;
          </span>
          ? This action cannot be undone.
        </p>

        <div className="flex gap-3">
          <button
            onClick={handleConfirm}
            className="flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors"
          >
            Delete
          </button>
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 px-4 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
