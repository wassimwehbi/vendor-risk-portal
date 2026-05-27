import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mocks are hoisted by Vitest above the imports below.
const getFlags = vi.fn();
const exposeExperiment = vi.fn().mockResolvedValue({ recorded: true });
vi.mock('../api/client', () => ({
  api: {
    getFlags: () => getFlags(),
    exposeExperiment: (key: string) => exposeExperiment(key),
  },
}));
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: { id: 1 }, activeTenantId: 1 }) }));

import { FlagsProvider, useFlag, useVariant } from './FlagsContext';

function Probe() {
  const enrolled = useVariant('exp-a'); // assigned 'treatment'
  const absent = useVariant('exp-x'); // not enrolled → falls back to control
  return (
    <div>
      variant:{enrolled}|absent:{absent}|flag:{String(useFlag('exp-a'))}
    </div>
  );
}

beforeEach(() => {
  sessionStorage.clear();
  getFlags.mockReset().mockResolvedValue({ 'exp-a': 'treatment' });
  exposeExperiment.mockClear();
});

describe('FlagsContext', () => {
  it('resolves the assigned variant, falls back to control, and beacons once for enrolled experiments', async () => {
    render(
      <FlagsProvider>
        <Probe />
      </FlagsProvider>,
    );

    await screen.findByText('variant:treatment|absent:control|flag:true');
    // Exposure fires only for the experiment the user is actually enrolled in.
    await waitFor(() => expect(exposeExperiment).toHaveBeenCalledWith('exp-a'));
    expect(exposeExperiment).toHaveBeenCalledTimes(1);
  });

  it('does not beacon when the user is enrolled in no experiments', async () => {
    getFlags.mockResolvedValue({});
    render(
      <FlagsProvider>
        <Probe />
      </FlagsProvider>,
    );
    await screen.findByText('variant:control|absent:control|flag:false');
    expect(exposeExperiment).not.toHaveBeenCalled();
  });
});
