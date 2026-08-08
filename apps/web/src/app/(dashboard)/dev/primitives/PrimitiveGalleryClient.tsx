"use client";

import { useState } from "react";
import { Button, Dialog } from "@/components/primitives";

export function PrimitiveGalleryClient() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button id="gallery-open-dialog" onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog
        id="gallery-dialog"
        open={open}
        title="Sync Whoop now?"
        onClose={() => setOpen(false)}
        actions={(
          <>
            <Button id="gallery-dialog-cancel" variant="text" onClick={() => setOpen(false)}>Cancel</Button>
            <Button id="gallery-dialog-confirm" variant="primary" onClick={() => setOpen(false)}>Sync now</Button>
          </>
        )}
      >
        This demonstrates the one genuinely elevated primitive. Dialogs are the exception to the borderless resting-surface rule.
      </Dialog>
    </>
  );
}
