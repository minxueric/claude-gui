import { toast as sonner } from "sonner";

// Thin wrapper so callers don't depend on sonner directly.
export const toast = {
  success: (msg: string, opts?: { description?: string }) =>
    sonner.success(msg, opts),
  error: (msg: string, opts?: { description?: string }) =>
    sonner.error(msg, opts),
  info: (msg: string, opts?: { description?: string }) =>
    sonner.message(msg, opts),
  promise: sonner.promise,
};
