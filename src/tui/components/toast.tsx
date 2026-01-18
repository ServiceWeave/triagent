/* @jsxImportSource @opentui/solid */
import { Toaster, toast, useToasts } from "@opentui-ui/toast/solid";
import { TOAST_DURATION } from "@opentui-ui/toast";
import type { JSX } from "solid-js";
import { colors, spacing } from "../theme/index.js";

// Re-export toast function and duration constants for app-wide use
export { toast, TOAST_DURATION, useToasts };

export interface ToastProviderProps {
  children: JSX.Element;
}

/**
 * Toast provider component that wraps the application
 * Provides toast notifications positioned at the bottom-right
 */
export function ToastProvider(props: ToastProviderProps): JSX.Element {
  return (
    <>
      {props.children}
      <Toaster
        position="bottom-right"
        gap={1}
        maxWidth={50}
        closeButton={true}
        toastOptions={{
          duration: TOAST_DURATION.DEFAULT,
          style: {
            borderStyle: "single",
            borderColor: colors.border.default,
            backgroundColor: colors.background.primary,
            paddingLeft: spacing.xs,
            paddingRight: spacing.xs,
            paddingTop: 0,
            paddingBottom: 0,
          },
        }}
      />
    </>
  );
}

// Helper functions for common toast patterns

/**
 * Show a success toast notification
 */
export function toastSuccess(message: string, description?: string) {
  return toast.success(message, { description, duration: TOAST_DURATION.SHORT });
}

/**
 * Show an error toast notification
 */
export function toastError(message: string, description?: string) {
  return toast.error(message, { description, duration: TOAST_DURATION.LONG });
}

/**
 * Show a warning toast notification
 */
export function toastWarning(message: string, description?: string) {
  return toast.warning(message, { description, duration: TOAST_DURATION.LONG });
}

/**
 * Show an info toast notification
 */
export function toastInfo(message: string, description?: string) {
  return toast.info(message, { description, duration: TOAST_DURATION.DEFAULT });
}

/**
 * Show a loading toast that can be updated when operation completes
 */
export function toastLoading(message: string) {
  return toast.loading(message, { duration: TOAST_DURATION.PERSISTENT });
}

/**
 * Dismiss a specific toast or all toasts
 */
export function toastDismiss(id?: string | number) {
  if (id !== undefined) {
    toast.dismiss(id);
  } else {
    toast.dismiss();
  }
}

/**
 * Show toast with promise handling - loading, success, error states
 */
export function toastPromise<T>(
  promise: Promise<T>,
  messages: {
    loading?: string;
    success?: string | ((data: T) => string);
    error?: string | ((err: unknown) => string);
  }
) {
  return toast.promise(promise, messages);
}
