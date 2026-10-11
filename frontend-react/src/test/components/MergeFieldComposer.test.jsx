import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MergeFieldComposer } from '../../components/ui/MergeFieldComposer';
import { LEAD_MERGE_FIELDS, applyMergeFields, SAMPLE_LEAD } from '../../utils/mergeFields';

// Tiptap needs a real editing surface; jsdom gives it enough to mount but
// driving its caret is not the point here. These cover the chip row and the
// subject-insertion path, which is plain DOM.
describe('MergeFieldComposer', () => {
  const setup = (props = {}) => {
    const onSubjectChange = vi.fn();
    const onBodyChange = vi.fn();
    render(
      <MergeFieldComposer
        subject="" onSubjectChange={onSubjectChange}
        body="" onBodyChange={onBodyChange}
        {...props}
      />
    );
    return { onSubjectChange, onBodyChange };
  };

  it('offers a chip for every supported merge field, so none has to be typed', () => {
    setup();
    LEAD_MERGE_FIELDS.forEach((field) => {
      expect(screen.getByText(`{{${field}}}`)).toBeInTheDocument();
    });
  });

  it('inserts into the subject at the caret once the subject is focused', () => {
    const { onSubjectChange } = setup({ subject: 'Hello  there' });
    const subject = screen.getByPlaceholderText('Subject');

    fireEvent.focus(subject);
    subject.setSelectionRange(6, 6); // between the two spaces
    fireEvent.select(subject);
    fireEvent.click(screen.getByText('{{first_name}}'));

    expect(onSubjectChange).toHaveBeenCalledWith('Hello {{first_name}} there');
  });

  it('appends to the subject when it was never clicked into, instead of prepending', () => {
    const { onSubjectChange } = setup({ subject: 'Quick note' });
    fireEvent.focus(screen.getByPlaceholderText('Subject'));
    fireEvent.click(screen.getByText('{{company}}'));
    expect(onSubjectChange).toHaveBeenCalledWith('Quick note{{company}}');
  });

  it('targets the body by default and says which field a chip will fill', () => {
    setup();
    expect(screen.getByText(/click to insert into the body/i)).toBeInTheDocument();

    fireEvent.focus(screen.getByPlaceholderText('Subject'));
    expect(screen.getByText(/click to insert into the subject/i)).toBeInTheDocument();
  });
});

describe('applyMergeFields', () => {
  it('substitutes known fields with the sample lead', () => {
    expect(applyMergeFields('Hi {{first_name}} at {{company}}'))
      .toBe(`Hi ${SAMPLE_LEAD.first_name} at ${SAMPLE_LEAD.company}`);
  });

  it('renders an unknown field blank, matching backend apply_merge_fields', () => {
    expect(applyMergeFields('a{{nope}}b')).toBe('ab');
  });

  it('tolerates whitespace inside the braces, like the backend regex does', () => {
    expect(applyMergeFields('{{ first_name }}')).toBe(SAMPLE_LEAD.first_name);
  });

  it('passes empty input straight through', () => {
    expect(applyMergeFields('')).toBe('');
    expect(applyMergeFields(undefined)).toBe('');
  });
});
