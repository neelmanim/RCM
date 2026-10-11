import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewAsBanner } from '../../layout/ViewAsBanner';

describe('ViewAsBanner', () => {
  it('shows the impersonated user name and role, and calls onExit on click', () => {
    const onExit = vi.fn();
    const { container } = render(<ViewAsBanner userName="Dev Kapoor" userRole="SDR" onExit={onExit} />);

    expect(screen.getByText('Dev Kapoor')).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === 'Viewing as Dev Kapoor (SDR)')).toBeInTheDocument();

    // nh-viewas-banner is what nav-tailwind.css scopes its --tw-* custom
    // property/border reset to (this bundle skips @tailwind base) — without
    // it, bg-gradient-to-r and the button's border-reset silently fail
    // (confirmed live 2026-09-10). jsdom can't render CSS, so this can only
    // guard the class name staying on the root, not the visual result.
    expect(container.querySelector('.nh-viewas-banner')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Exit View-As/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('falls back to defaults when userName/userRole are missing', () => {
    render(<ViewAsBanner onExit={() => {}} />);
    expect(screen.getByText((_, node) => node?.textContent === 'Viewing as User (Unknown)')).toBeInTheDocument();
  });
});
