import { AlertTriangle, Check, Info, X } from "lucide-react";
import React, { useEffect, useState } from "react";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastOptions {
  id?: string;
  type?: ToastType;
  description?: React.ReactNode;
  duration?: number;
}

export interface ToastItem extends ToastOptions {
  id: string;
  type: ToastType;
  title: React.ReactNode;
  createdAt: number;
  isLeaving?: boolean;
}

type ToastListener = (toasts: ToastItem[]) => void;

class ToastStore {
  private toasts: ToastItem[] = [];
  private listeners: Set<ToastListener> = new Set();

  subscribe(listener: ToastListener) {
    this.listeners.add(listener);
    listener(this.toasts);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((listener) => listener([...this.toasts]));
  }

  show(title: React.ReactNode, options?: ToastOptions | ToastType) {
    const opts: ToastOptions =
      typeof options === "string" ? { type: options } : options || {};
    const id = opts.id || Math.random().toString(36).substring(2, 9);
    const type = opts.type || "info";
    const duration = opts.duration ?? 3500;

    const newItem: ToastItem = {
      id,
      type,
      title,
      description: opts.description,
      duration,
      createdAt: Date.now(),
    };

    this.toasts = [newItem, ...this.toasts.filter((t) => t.id !== id)].slice(0, 4);
    this.notify();

    if (duration > 0) {
      setTimeout(() => {
        this.dismiss(id);
      }, duration);
    }

    return id;
  }

  dismiss(id: string) {
    const target = this.toasts.find((t) => t.id === id);
    if (!target) return;

    target.isLeaving = true;
    this.notify();

    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.notify();
    }, 220);
  }

  clear() {
    this.toasts = [];
    this.notify();
  }
}

export const toastStore = new ToastStore();

export const toast = Object.assign(
  (title: React.ReactNode, options?: ToastOptions) =>
    toastStore.show(title, options),
  {
    success: (title: React.ReactNode, options?: Omit<ToastOptions, "type">) =>
      toastStore.show(title, { ...options, type: "success" }),
    error: (title: React.ReactNode, options?: Omit<ToastOptions, "type">) =>
      toastStore.show(title, { ...options, type: "error" }),
    info: (title: React.ReactNode, options?: Omit<ToastOptions, "type">) =>
      toastStore.show(title, { ...options, type: "info" }),
    warning: (title: React.ReactNode, options?: Omit<ToastOptions, "type">) =>
      toastStore.show(title, { ...options, type: "warning" }),
    dismiss: (id: string) => toastStore.dismiss(id),
    clear: () => toastStore.clear(),
  }
);

export function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    return toastStore.subscribe((nextToasts) => {
      setToasts(nextToasts);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="narra-toast-container" aria-live="polite" role="region">
      {toasts.map((item) => {
        const Icon =
          item.type === "success"
            ? Check
            : item.type === "error"
              ? X
              : item.type === "warning"
                ? AlertTriangle
                : Info;

        return (
          <div
            key={item.id}
            className={`narra-toast-item narra-toast-item--${item.type} ${
              item.isLeaving ? "is-leaving" : ""
            }`}
            role="alert"
          >
            <div className={`narra-toast-icon-wrap narra-toast-icon--${item.type}`}>
              <Icon size={13} strokeWidth={3} aria-hidden="true" />
            </div>
            <div className="narra-toast-content">
              <div className="narra-toast-title">{item.title}</div>
              {item.description && (
                <div className="narra-toast-desc">{item.description}</div>
              )}
            </div>
            <div className="narra-toast-progress-track">
              <div
                className={`narra-toast-progress-bar narra-toast-progress--${item.type}`}
                style={{ animationDuration: `${item.duration ?? 3500}ms` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
