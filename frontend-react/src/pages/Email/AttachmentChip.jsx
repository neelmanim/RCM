/**
 * AttachmentChip.jsx
 * Displays a downloadable attachment chip in email bubbles.
 */
import React from 'react';

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(contentType) {
  if (!contentType) return '📎';
  if (contentType.includes('pdf')) return '📄';
  if (contentType.includes('image')) return '🖼️';
  if (contentType.includes('sheet') || contentType.includes('excel')) return '📊';
  if (contentType.includes('word') || contentType.includes('document')) return '📝';
  if (contentType.includes('zip') || contentType.includes('compressed')) return '🗜️';
  return '📎';
}

export function AttachmentChip({ attachment, token, apiBase, messageId }) {
  const handleDownload = async (e) => {
    e.preventDefault();
    const base = apiBase || window.__CRM_API_BASE__ || '';
    const url  = `${base}/api/email/attachment/${attachment.id}/download?message_id=${messageId || ''}`;
    try {
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error('Download failed');
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = attachment.filename || 'attachment';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      alert('Could not download attachment. Please try again.');
    }
  };

  return (
    <a href="#" className="eh-attachment-chip" onClick={handleDownload} title={attachment.filename}>
      <span className="eh-attachment-icon">{fileIcon(attachment.content_type)}</span>
      <span className="eh-attachment-name">{attachment.filename || 'attachment'}</span>
      {attachment.size > 0 && (
        <span className="eh-attachment-size">{formatBytes(attachment.size)}</span>
      )}
    </a>
  );
}
