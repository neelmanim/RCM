// Keep Tab navigation in the dialog rather than cycling into browser chrome.
export function containDialogFocus(event) {
  if (event.key !== 'Tab') return;
  const dialog = event.currentTarget;
  const controls = [...dialog.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')]
    .filter(control => !control.matches(':disabled') && control.tabIndex >= 0 && control.getClientRects().length > 0);
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (!first) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const active = dialog.ownerDocument.activeElement;
  if (event.shiftKey ? active === first || !controls.includes(active) : active === last || !controls.includes(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}
