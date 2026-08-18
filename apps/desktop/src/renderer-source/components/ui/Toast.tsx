import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";

export const toast = sonnerToast;

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        className: "narra-toast",
        duration: 4000,
      }}
    />
  );
}
