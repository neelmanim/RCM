import React from 'react';
import { Button } from '../../components/ui/Button';
import { RichTextEditor } from '../../components/ui/RichTextEditor';
import { EmailService } from '../../services/api';
import { toast } from './toast';

/**
 * Email-signature editor: the shared components/ui/RichTextEditor with its
 * opt-in image controls turned on (insert-by-URL plus a logo upload), since a
 * signature's whole point is often a company logo.
 *
 * The legacy page this replaces drove a contentEditable div with
 * document.execCommand. That is deliberately not carried over — the editor
 * here is the same Tiptap component the campaign and template composers use,
 * so all three behave identically and there is one editor to maintain.
 */
export function SignatureEditor({ initialHtml, onSaved }) {
  const [html, setHtml] = React.useState(initialHtml || '');
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  // Server value arrives after mount — adopt it until the user starts editing,
  // so a slow fetch can't blow away in-progress typing.
  React.useEffect(() => {
    if (!dirty) setHtml(initialHtml || '');
  }, [initialHtml, dirty]);

  const handleUploadLogo = async (file) => {
    try {
      const { url } = await EmailService.uploadSignatureLogo(file);
      return url;
    } catch (err) {
      toast(err.response?.data?.detail || 'Failed to upload logo.', 'error');
      return null;
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await EmailService.saveSignature(html);
      setDirty(false);
      toast('Signature saved.', 'success');
      onSaved?.();
    } catch (err) {
      toast(err.response?.data?.detail || 'Failed to save signature.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <RichTextEditor
        value={html}
        onChange={(next) => { setHtml(next); setDirty(true); }}
        placeholder="e.g. Cheers, Jane Doe · Account Executive"
        allowImages
        onUploadImage={handleUploadLogo}
      />
      <div className="flex justify-end mt-2.5">
        <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? 'Saving…' : dirty ? 'Save Signature' : 'Saved'}
        </Button>
      </div>
    </div>
  );
}
