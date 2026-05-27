import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, setCsrfToken, setOnUnauthorized } from './client';

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response);
}

beforeEach(() => {
  setCsrfToken(null);
  setOnUnauthorized(null);
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('unwraps the { success, data } envelope on success', async () => {
    const fetchMock = mockFetch(200, { success: true, data: [{ id: 1 }] });
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.listAssessments();

    expect(result).toEqual([{ id: 1 }]);
    expect(fetchMock).toHaveBeenCalledWith('/api/assessments', expect.objectContaining({ credentials: 'include' }));
  });

  it('attaches the x-csrf-token header on mutations once a token is set', async () => {
    const fetchMock = mockFetch(201, { success: true, data: { id: 7 } });
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('tok-123');

    await api.createAssessment({ vendor_name: 'X', questionnaire_type: 'SIG', date_submitted: '2026-05-25' });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-csrf-token']).toBe('tok-123');
  });

  it('calls the unauthorized handler and throws on 401', async () => {
    const fetchMock = mockFetch(401, { success: false, error: 'nope' });
    vi.stubGlobal('fetch', fetchMock);
    const onUnauth = vi.fn();
    setOnUnauthorized(onUnauth);

    await expect(api.listAssessments()).rejects.toThrow(/session has expired/i);
    expect(onUnauth).toHaveBeenCalledOnce();
  });

  it('surfaces the server error message on a failed response', async () => {
    const fetchMock = mockFetch(400, { success: false, error: 'bad input' });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      api.createAssessment({ vendor_name: '', questionnaire_type: 'SIG', date_submitted: '2026-05-25' }),
    ).rejects.toThrow('bad input');
  });

  it('experiment endpoints hit the right routes (flags, expose, events)', async () => {
    const fetchMock = mockFetch(200, { success: true, data: { 'dashboard-cta': 'treatment' } });
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('tok-abc');

    await api.getFlags();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/flags', expect.objectContaining({ credentials: 'include' }));

    await api.exposeExperiment('dashboard-cta');
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/experiments/dashboard-cta/expose',
      expect.objectContaining({ method: 'POST' }),
    );

    await api.trackEvent('assessment_created');
    const calls = fetchMock.mock.calls;
    const [url, init] = calls[calls.length - 1];
    expect(url).toBe('/api/events');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ metric: 'assessment_created' });
  });
});
