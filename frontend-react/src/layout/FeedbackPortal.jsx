import React, { useState, useEffect, useCallback } from 'react';
import { FeedbackModal } from './FeedbackModal';

export function FeedbackPortal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener('alternate:open-feedback', handleOpen);
    return () => window.removeEventListener('alternate:open-feedback', handleOpen);
  }, []);

  const close = useCallback(() => setOpen(false), []);
  return <FeedbackModal open={open} onClose={close} />;
}
