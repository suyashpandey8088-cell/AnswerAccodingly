import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button, cn } from "./ui";

export function Dialog({ open, onOpenChange, title, description, children, wide }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-50 bg-slate-950/30 backdrop-blur-[2px] data-[state=open]:animate-in" />
      <RadixDialog.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-white/20 bg-white shadow-dialog focus:outline-none", wide ? "max-w-4xl" : "max-w-lg")}>
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div><RadixDialog.Title className="text-base font-semibold tracking-[-0.02em] text-slate-900">{title}</RadixDialog.Title>{description && <RadixDialog.Description className="mt-1.5 max-w-xl text-xs leading-5 text-slate-500">{description}</RadixDialog.Description>}</div>
          <RadixDialog.Close className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-accent-500" aria-label="Close dialog"><X size={17} /></RadixDialog.Close>
        </div>
        <div className="max-h-[calc(90vh-86px)] overflow-y-auto">{children}</div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  </RadixDialog.Root>;
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, dangerous, loading }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  dangerous?: boolean;
  loading?: boolean;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange} title={title} description={description}>
    <div className="flex justify-end gap-2 px-6 py-5"><Button variant="secondary" onClick={() => onOpenChange(false)}>Go back</Button><Button variant={dangerous ? "danger" : "primary"} loading={loading} onClick={onConfirm}>{confirmLabel}</Button></div>
  </Dialog>;
}
