/**
 * useAttachments.js
 *
 * Manages the attachment list for a compose or reply form.
 * Scoped to the component instance — no global state.
 */
import { useState, useCallback } from 'react';

const MAX_FILE_SIZE_MB = 10;

export function useAttachments() {
  const [attachments, setAttachments] = useState([]); // Array<{ file: File, id: string }>

  const addFile = useCallback((file) => {
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      alert(`File "${file.name}" exceeds the ${MAX_FILE_SIZE_MB}MB limit.`);
      return false;
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setAttachments(prev => [...prev, { file, id }]);
    return true;
  }, []);

  const removeFile = useCallback((id) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const clear = useCallback(() => setAttachments([]), []);

  return { attachments, addFile, removeFile, clear };
}
