import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogPortal = RadixDialog.Portal;
export const DialogClose = RadixDialog.Close;

export function DialogOverlay({
  className = "",
  ...props
}: ComponentPropsWithoutRef<typeof RadixDialog.Overlay>) {
  return (
    <RadixDialog.Overlay
      className={`narra-dialog__overlay ${className}`.trim()}
      {...props}
    />
  );
}

export function DialogContent({
  className = "",
  children,
  showClose = true,
  ...props
}: ComponentPropsWithoutRef<typeof RadixDialog.Content> & {
  showClose?: boolean;
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <RadixDialog.Content
        className={`narra-dialog__content ${className}`.trim()}
        {...props}
      >
        {children}
        {showClose && (
          <RadixDialog.Close className="narra-dialog__close" aria-label="Đóng">
            <X size={16} />
          </RadixDialog.Close>
        )}
      </RadixDialog.Content>
    </DialogPortal>
  );
}

export function DialogHeader({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`narra-dialog__header ${className}`.trim()}>{children}</div>
  );
}

export function DialogTitle({
  className = "",
  ...props
}: ComponentPropsWithoutRef<typeof RadixDialog.Title>) {
  return (
    <RadixDialog.Title
      className={`narra-dialog__title ${className}`.trim()}
      {...props}
    />
  );
}

export function DialogDescription({
  className = "",
  ...props
}: ComponentPropsWithoutRef<typeof RadixDialog.Description>) {
  return (
    <RadixDialog.Description
      className={`narra-dialog__description ${className}`.trim()}
      {...props}
    />
  );
}

export function DialogFooter({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`narra-dialog__footer ${className}`.trim()}>{children}</div>
  );
}
